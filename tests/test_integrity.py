"""Tests for canonical serialization, hashing, ReplayManifest, and storage vault."""

from __future__ import annotations

import random
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

import pytest

from data_rewind.core.domain.errors import (
    ArtifactIntegrityError,
    ArtifactNotFoundError,
    DomainValidationError,
    PathTraversalError,
)
from data_rewind.core.integrity.hashing import (
    compute_content_hash,
    compute_multiset_hash,
    verify_content_integrity,
)
from data_rewind.core.integrity.manifest import (
    ManifestInput,
    ManifestStepSnapshot,
    ReplayManifest,
    validate_sha256_hex,
)
from data_rewind.core.integrity.serialization import (
    NAN_SENTINEL,
    NEG_INF_SENTINEL,
    NULL_SENTINEL,
    POS_INF_SENTINEL,
    canonical_row_bytes,
    normalize_value,
)
from data_rewind.core.integrity.storage import (
    ArtifactStorageVault,
    validate_safe_path,
)


def test_normalize_value_data_types() -> None:
    """Test S(v) canonical normalizer across all primitive types."""
    # Null
    assert normalize_value(None) == NULL_SENTINEL

    # Booleans
    assert normalize_value(True) == "TRUE"
    assert normalize_value(False) == "FALSE"

    # Integers
    assert normalize_value(42) == "42"
    assert normalize_value(-100) == "-100"

    # Floats (fixed 6 decimal places per SPEC-MOD-02)
    assert normalize_value(3.14159265) == "3.141593"
    assert normalize_value(10.5) == "10.500000"
    assert normalize_value(-0.0) == "0.000000"
    assert normalize_value(float("nan")) == NAN_SENTINEL
    assert normalize_value(float("inf")) == POS_INF_SENTINEL
    assert normalize_value(float("-inf")) == NEG_INF_SENTINEL

    # Strings (NFC normalized)
    assert normalize_value("hello world") == "hello world"

    # Dates and Timestamps
    dt = datetime(2026, 10, 22, 12, 0, 0, tzinfo=UTC)
    assert normalize_value(dt) == "2026-10-22T12:00:00.000000Z"
    d = date(2026, 10, 22)
    assert normalize_value(d) == "2026-10-22"


def test_canonical_row_bytes_sorted_keys() -> None:
    """Test that canonical row bytes sort keys deterministically."""
    # Keys provided out of order
    row = {"z_col": 10, "a_col": "first", "m_col": 3.5}
    b = canonical_row_bytes(row)
    expected_str = "a_col=first|m_col=3.500000|z_col=10|"
    assert b.decode("utf-8") == expected_str


def test_multiset_hash_invariance_and_multiplicity() -> None:
    """Test multiset hash mathematical properties (invariance under permutation & duplicate multiplicity)."""
    r1 = {"id": 1, "val": 10.0}
    r2 = {"id": 2, "val": 20.0}
    r3 = {"id": 3, "val": 30.0}

    base_dataset = [r1, r2, r3]
    h_base = compute_multiset_hash(base_dataset)

    # 1. Permutation invariance: test multiple shuffles
    shuffled = list(base_dataset)
    for _ in range(10):
        random.shuffle(shuffled)
        assert compute_multiset_hash(shuffled) == h_base

    # 2. Multiplicity sensitivity: adding duplicate row changes hash
    dataset_with_dup = [r1, r2, r3, r1]
    h_dup = compute_multiset_hash(dataset_with_dup)
    assert h_dup != h_base

    # 3. Value sensitivity: modifying 1 float value changes hash
    modified_dataset = [{"id": 1, "val": 10.0001}, r2, r3]
    h_mod = compute_multiset_hash(modified_dataset)
    assert h_mod != h_base

    # 4. Empty dataset
    assert compute_multiset_hash([]) == "0" * 64


def test_content_hashing_and_verification(temp_workspace: Path) -> None:
    """Test chunked file content hashing and corruption detection."""
    test_file = temp_workspace / "sample_data.bin"
    test_bytes = b"REPRODUCIBLE_DATA_REWIND_TEST_BYTES"
    test_file.write_bytes(test_bytes)

    sha = compute_content_hash(test_file)
    assert len(sha) == 64

    # Verification passes
    verify_content_integrity(test_file, sha)

    # Verification fails on mismatch
    corrupted_hash = "f" * 64
    with pytest.raises(ArtifactIntegrityError) as exc_info:
        verify_content_integrity(test_file, corrupted_hash)
    assert exc_info.value.code == "CORRUPTED_ARTIFACT_ERROR"


def test_replay_manifest_roundtrip() -> None:
    """Test ReplayManifest creation, serialization, and round-trip parsing."""
    run_id = uuid4()
    p_ver_id = uuid4()
    def_hash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"

    manifest = ReplayManifest.create(
        run_id=run_id,
        pipeline_version_id=p_ver_id,
        pipeline_definition_hash=def_hash,
        inputs=[
            ManifestInput(
                input_id="in_1",
                version_id=uuid4(),
                content_hash="a" * 64,
                multiset_hash="b" * 64,
                row_count=50,
                byte_size=1024,
            )
        ],
        steps_snapshot=[
            ManifestStepSnapshot(
                step_id="step_filter",
                operation="filter_rows",
                parameters={"cutoff": 100},
            )
        ],
    )

    json_str = manifest.to_canonical_json()
    restored = ReplayManifest.from_json(json_str)

    assert restored.run_id == run_id
    assert restored.pipeline_definition_hash == def_hash
    assert len(restored.inputs) == 1
    assert restored.inputs[0].row_count == 50
    assert restored.engine.name == "DataRewind-Engine"

    # Malformed JSON raises DomainValidationError
    with pytest.raises(DomainValidationError, match="Failed to parse"):
        ReplayManifest.from_json("INVALID_NOT_JSON")


def test_artifact_storage_vault_lifecycle(storage_vault: ArtifactStorageVault) -> None:
    """Test atomic publication and verified retrieval in storage vault."""
    payload = b"PARQUET_ENCODED_SAMPLE_TABLE_DATA"
    target_path, content_hash = storage_vault.publish_bytes_atomic(payload, prefix="step_out")

    assert target_path.exists()
    assert target_path.name == f"{content_hash}.parquet"

    # Read back verified
    read_bytes = storage_vault.read_artifact_verified(target_path, content_hash)
    assert read_bytes == payload

    # Missing file raises ArtifactNotFoundError
    non_existent = storage_vault.artifacts_dir / "nonexistent.parquet"
    with pytest.raises(ArtifactNotFoundError):
        storage_vault.read_artifact_verified(non_existent, "0" * 64)


def test_path_jail_blocks_directory_traversal(temp_workspace: Path) -> None:
    """Test path sanitization blocks traversal outside workspace root."""
    inside_path = temp_workspace / "artifacts" / "test.parquet"
    safe_resolved = validate_safe_path(inside_path, temp_workspace)
    assert safe_resolved.is_relative_to(temp_workspace.resolve())

    # Path traversal attack
    outside_path = temp_workspace / ".." / "escaped_secret.txt"
    with pytest.raises(PathTraversalError) as exc_info:
        validate_safe_path(outside_path, temp_workspace)
    assert exc_info.value.code == "PATH_TRAVERSAL_BLOCKED"


def test_storage_vault_cleanup_on_failure(
    temp_workspace: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Verify that temporary files are cleaned up if an error occurs during publish."""
    vault = ArtifactStorageVault(temp_workspace)

    def failing_hash(_target: bytes | Path) -> str:
        raise OSError("Simulated disk error during hashing")

    monkeypatch.setattr("data_rewind.core.integrity.storage.compute_content_hash", failing_hash)

    with pytest.raises(OSError, match="Simulated disk error"):
        vault.publish_bytes_atomic(b"PAYLOAD", prefix="fail_test")

    # Verify no orphan .tmp files remain in vault.tmp_dir
    tmp_files = list(vault.tmp_dir.glob("*.tmp"))
    assert len(tmp_files) == 0


def test_multiset_hash_heterogeneous_keyless_records() -> None:
    """Test multiset hashing with heterogeneous key sets across records (P1-02)."""
    # 1. Homogeneous baseline produces deterministic result
    homo_1 = [{"id": 1, "val": 10.0}, {"id": 2, "val": 20.0}]
    h_homo = compute_multiset_hash(homo_1)
    assert len(h_homo) == 64
    assert h_homo == compute_multiset_hash([{"id": 2, "val": 20.0}, {"id": 1, "val": 10.0}])

    # 2. Heterogeneous records where keys appear in later rows
    r1 = {"id": 1, "col_a": "alpha"}
    r2 = {"id": 2, "col_b": "beta"}
    r3 = {"id": 3, "col_a": "gamma", "col_c": 99.0}

    # Under new implementation, all keys {'id', 'col_a', 'col_b', 'col_c'} are inferred
    h_123 = compute_multiset_hash([r1, r2, r3])
    h_321 = compute_multiset_hash([r3, r2, r1])
    h_213 = compute_multiset_hash([r2, r1, r3])

    # 3. Permutation invariance strictly holds across heterogeneous records
    assert h_123 == h_321
    assert h_123 == h_213

    # 4. Dictionary insertion order independence
    r1_alt = {"col_a": "alpha", "id": 1}
    r2_alt = {"col_b": "beta", "id": 2}
    assert compute_multiset_hash([r1_alt, r2_alt]) == compute_multiset_hash([r1, r2])

    # 5. Empty input
    assert compute_multiset_hash([]) == "0" * 64

    # 6. Explicit columns argument preserves schema and ignores unlisted keys
    h_explicit = compute_multiset_hash([r1, r2, r3], columns=["id", "col_a"])
    # r2 has no col_a (becomes NULL_SENTINEL), r3 has col_c which is ignored
    h_expected_explicit = compute_multiset_hash(
        [
            {"id": 1, "col_a": "alpha"},
            {"id": 2, "col_a": None},
            {"id": 3, "col_a": "gamma"},
        ],
        columns=["id", "col_a"],
    )
    assert h_explicit == h_expected_explicit

    # 7. Regression demonstration: old first-row-only logic would have produced different hashes
    # Under old logic: columns inferred for [r1, r2] was sorted(r1.keys()) = ['col_a', 'id']
    # while for [r2, r1] was sorted(r2.keys()) = ['col_b', 'id']
    old_sim_12 = compute_multiset_hash([r1, r2], columns=sorted(r1.keys()))
    old_sim_21 = compute_multiset_hash([r2, r1], columns=sorted(r2.keys()))
    assert old_sim_12 != old_sim_21  # Proves the old approach failed permutation invariance
    # But new approach succeeds:
    assert compute_multiset_hash([r1, r2]) == compute_multiset_hash([r2, r1])


def test_manifest_input_sha256_validation() -> None:
    """Test SHA-256 hexadecimal format validation in ManifestInput (P2-03)."""
    valid_lower = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    valid_upper = valid_lower.upper()
    uid = uuid4()

    # 1. Valid lowercase SHA-256
    inp = ManifestInput(
        input_id="in_1",
        version_id=uid,
        content_hash=valid_lower,
        multiset_hash=valid_lower,
        row_count=100,
        byte_size=4096,
    )
    assert inp.content_hash == valid_lower
    assert inp.multiset_hash == valid_lower

    # 2. Valid uppercase SHA-256 accepted without silent mutation
    inp_upper = ManifestInput(
        input_id="in_2",
        version_id=uid,
        content_hash=valid_upper,
        multiset_hash=valid_upper,
        row_count=50,
        byte_size=2048,
    )
    assert inp_upper.content_hash == valid_upper

    # 3. Too short value
    with pytest.raises(DomainValidationError, match="must be exactly 64 hexadecimal") as exc1:
        ManifestInput(
            input_id="in_err",
            version_id=uid,
            content_hash=valid_lower[:63],
            multiset_hash=valid_lower,
            row_count=10,
            byte_size=100,
        )
    assert exc1.value.code == "INVALID_HASH_LENGTH"

    # 4. Too long value
    with pytest.raises(DomainValidationError, match="must be exactly 64 hexadecimal") as exc2:
        ManifestInput(
            input_id="in_err",
            version_id=uid,
            content_hash=valid_lower + "a",
            multiset_hash=valid_lower,
            row_count=10,
            byte_size=100,
        )
    assert exc2.value.code == "INVALID_HASH_LENGTH"

    # 5. Invalid hexadecimal characters
    with pytest.raises(DomainValidationError, match="must contain only hexadecimal") as exc3:
        ManifestInput(
            input_id="in_err",
            version_id=uid,
            content_hash="z" * 64,
            multiset_hash=valid_lower,
            row_count=10,
            byte_size=100,
        )
    assert exc3.value.code == "INVALID_HASH_CHARACTERS"

    # 6. Empty value
    with pytest.raises(DomainValidationError, match="must be exactly 64 hexadecimal") as exc4:
        ManifestInput(
            input_id="in_err",
            version_id=uid,
            content_hash="",
            multiset_hash=valid_lower,
            row_count=10,
            byte_size=100,
        )
    assert exc4.value.code == "INVALID_HASH_LENGTH"

    # 7. Leading / trailing whitespace and whitespace-only
    with pytest.raises(DomainValidationError) as exc5:
        ManifestInput(
            input_id="in_err",
            version_id=uid,
            content_hash=" " + valid_lower[:63],  # 64 chars with leading space
            multiset_hash=valid_lower,
            row_count=10,
            byte_size=100,
        )
    assert exc5.value.code == "INVALID_HASH_CHARACTERS"

    with pytest.raises(DomainValidationError) as exc6:
        ManifestInput(
            input_id="in_err",
            version_id=uid,
            content_hash=valid_lower + " ",  # 65 chars
            multiset_hash=valid_lower,
            row_count=10,
            byte_size=100,
        )
    assert exc6.value.code == "INVALID_HASH_LENGTH"

    with pytest.raises(DomainValidationError) as exc7:
        ManifestInput(
            input_id="in_err",
            version_id=uid,
            content_hash=" " * 64,  # 64 spaces
            multiset_hash=valid_lower,
            row_count=10,
            byte_size=100,
        )
    assert exc7.value.code == "INVALID_HASH_CHARACTERS"

    # 8. Non-string type rejected
    with pytest.raises(DomainValidationError, match="must be a string") as exc8:
        bad_val: Any = 12345
        validate_sha256_hex(bad_val, "content_hash")
    assert exc8.value.code == "INVALID_HASH_TYPE"

    # 9. Other ManifestInput fields remain unaffected
    inp_fields = ManifestInput(
        input_id="source_orders_2026",
        version_id=uid,
        content_hash=valid_lower,
        multiset_hash=valid_lower,
        row_count=12345,
        byte_size=987654,
    )
    assert inp_fields.input_id == "source_orders_2026"
    assert inp_fields.version_id == uid
    assert inp_fields.row_count == 12345
    assert inp_fields.byte_size == 987654
