"""Data Rewind canonical cryptographic hashing and multiset fingerprinting.

Conforms strictly to Section 2 of SPEC-MOD-02.
Implements:
- Single-row SHA-256 hash: h(r) = SHA-256(C(r))
- Order-independent multiset hash with multiplicity:
    H_multiset(D) = ( sum_{r in D} int(h(r)) ) mod 2^256
- Chunked content hashing for file payloads.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from data_rewind.core.domain.errors import ArtifactIntegrityError, DomainValidationError
from data_rewind.core.integrity.serialization import canonical_row_bytes

TWO_TO_256 = 1 << 256
CHUNK_SIZE_BYTES = 65_536  # 64 KB streaming buffer


def hash_canonical_row(row: dict[str, Any], columns: list[str] | None = None) -> str:
    """Compute 64-character SHA-256 hex digest for a single row: h(r)."""
    raw_bytes = canonical_row_bytes(row, columns)
    return hashlib.sha256(raw_bytes).hexdigest()


def compute_multiset_hash(
    rows: list[dict[str, Any]],
    columns: list[str] | None = None,
) -> str:
    """Compute order-independent multiset hash H_multiset(D) with row multiplicity.

    Guarantees:
    - Invariant under row permutation: H_multiset(shuffle(D)) == H_multiset(D).
    - Multiplicity preserved: duplicate rows contribute k * int(h(r)).
    - Returns 64-character lowercase hex string.
    """
    if not rows:
        return "0" * 64

    total_sum = 0
    # If columns is None, infer unified schema column keys across all rows
    if columns is not None:
        resolved_cols = sorted(columns)
    else:
        all_keys: set[str] = set()
        for r in rows:
            all_keys.update(r.keys())
        resolved_cols = sorted(all_keys)

    for row in rows:
        row_digest = hash_canonical_row(row, resolved_cols)
        row_int = int(row_digest, 16)
        total_sum = (total_sum + row_int) % TWO_TO_256

    return f"{total_sum:064x}"


def compute_content_hash(target: bytes | Path) -> str:
    """Compute SHA-256 hex digest of in-memory bytes or on-disk file."""
    hasher = hashlib.sha256()

    if isinstance(target, bytes):
        hasher.update(target)
        return hasher.hexdigest()

    path = Path(target)
    if not path.is_file():
        raise DomainValidationError(
            f"Cannot compute content hash: path does not exist or is not a file: {path}",
            code="FILE_NOT_FOUND",
        )

    with path.open("rb") as f:
        while chunk := f.read(CHUNK_SIZE_BYTES):
            hasher.update(chunk)

    return hasher.hexdigest()


def verify_content_integrity(path: Path, expected_hash: str) -> None:
    """Verify that file on disk matches expected SHA-256 digest.

    Raises:
        ArtifactIntegrityError: If checksum does not match.
    """
    cleaned_expected = expected_hash.strip().lower()
    actual_hash = compute_content_hash(path)
    if actual_hash != cleaned_expected:
        raise ArtifactIntegrityError(
            f"Artifact integrity verification failed for {path.name}: "
            f"expected {cleaned_expected}, observed {actual_hash}",
            code="CORRUPTED_ARTIFACT_ERROR",
            details={
                "file": str(path),
                "expected_hash": cleaned_expected,
                "actual_hash": actual_hash,
            },
        )


def compute_pipeline_definition_hash(
    steps: Sequence[Any],
) -> str:
    """Compute deterministic SHA-256 digest of serialized canonical DAG steps and configs.

    Conforms to SPEC-MOD-02 Section 2 and SPEC-MOD-03 Section 3.4.
    """
    serialized: list[dict[str, Any]] = []
    for s in steps:
        if hasattr(s, "operation_type"):
            op = (
                s.operation_type.value
                if hasattr(s.operation_type, "value")
                else str(s.operation_type)
            )
        elif hasattr(s, "operation"):
            op = str(s.operation)
        else:
            op = ""

        step_id = getattr(s, "step_id", "")
        input_step_ids = list(getattr(s, "input_step_ids", []))
        parameters = dict(getattr(s, "parameters", {}))

        serialized.append(
            {
                "step_id": step_id,
                "operation": op,
                "input_step_ids": input_step_ids,
                "parameters": parameters,
            }
        )

    payload = json.dumps(serialized, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()
