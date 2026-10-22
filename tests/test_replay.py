"""Tests for Historical Replay and Reproducibility Verification Engine.

Conforms strictly to Section 3 of SPEC-MOD-03.
"""

from __future__ import annotations

import csv
from pathlib import Path
from uuid import uuid4

import pytest

from data_rewind.core.domain.models import OperationType, TransformationStep
from data_rewind.core.integrity.hashing import compute_content_hash, compute_multiset_hash
from data_rewind.core.integrity.manifest import ManifestInput
from data_rewind.replay.manifest_generator import generate_replay_manifest
from data_rewind.replay.models import ReplayOutcome
from data_rewind.replay.replayer import HistoricalReplayer


@pytest.fixture
def replay_workspace(tmp_path: Path) -> Path:
    ws = tmp_path / "replay_ws"
    ws.mkdir()
    (ws / "raw_inputs").mkdir()
    (ws / "artifacts").mkdir()
    return ws


def test_replay_outcome_reproducible(replay_workspace: Path) -> None:
    # Prepare input CSV
    raw_dir = replay_workspace / "raw_inputs"
    orders_csv = raw_dir / "orders.csv"
    orders = [
        {"order_id": 1, "status": "COMPLETED", "amount": 100.0},
        {"order_id": 2, "status": "PENDING", "amount": 50.0},
    ]
    with open(orders_csv, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["order_id", "status", "amount"])
        writer.writeheader()
        writer.writerows(orders)

    c_hash = compute_content_hash(orders_csv)
    m_hash = compute_multiset_hash(orders)

    # Pin file with content_hash name
    pinned_csv = raw_dir / f"{c_hash}.csv"
    orders_csv.replace(pinned_csv)

    steps = [
        TransformationStep(
            step_id="filter_step",
            operation_type=OperationType.FILTER_ROWS,
            input_step_ids=["raw_orders"],
            parameters={"predicate": "status == 'COMPLETED'"},
        )
    ]

    manifest = generate_replay_manifest(
        run_id=uuid4(),
        pipeline_version_id=uuid4(),
        pipeline_definition_hash="0" * 64,
        inputs=[
            ManifestInput(
                input_id="raw_orders",
                version_id=uuid4(),
                content_hash=c_hash,
                multiset_hash=m_hash,
                row_count=2,
                byte_size=pinned_csv.stat().st_size,
            )
        ],
        steps=steps,
    )

    # Historical hash of filtered step (order 1 only)
    expected_step_hash = compute_multiset_hash(
        [{"order_id": 1, "status": "COMPLETED", "amount": 100.0}]
    )

    result = HistoricalReplayer.replay_run(
        manifest=manifest,
        workspace_root=replay_workspace,
        historical_step_hashes={"filter_step": expected_step_hash},
    )

    assert result.outcome == ReplayOutcome.REPRODUCIBLE
    assert "100% mathematical equivalence" in result.explanation
    assert result.step_verifications["filter_step"].is_matched is True
    assert result.late_divergence_step_id is None


def test_replay_outcome_blocked_missing_artifacts(replay_workspace: Path) -> None:
    # Manifest references non-existent hash
    missing_hash = "f" * 64
    manifest = generate_replay_manifest(
        run_id=uuid4(),
        pipeline_version_id=uuid4(),
        pipeline_definition_hash="0" * 64,
        inputs=[
            ManifestInput(
                input_id="purged_dataset",
                version_id=uuid4(),
                content_hash=missing_hash,
                multiset_hash="0" * 64,
                row_count=100,
                byte_size=5000,
            )
        ],
        steps=[
            TransformationStep(
                step_id="step_1",
                operation_type=OperationType.FILTER_ROWS,
                input_step_ids=["purged_dataset"],
                parameters={"predicate": "id > 0"},
            )
        ],
    )

    result = HistoricalReplayer.replay_run(
        manifest=manifest,
        workspace_root=replay_workspace,
    )

    assert result.outcome == ReplayOutcome.BLOCKED_MISSING_ARTIFACTS
    assert "no longer retained in workspace storage" in result.explanation
    assert len(result.missing_artifacts) == 1
    assert "purged_dataset" in result.missing_artifacts[0]


def test_replay_outcome_divergent(replay_workspace: Path) -> None:
    raw_dir = replay_workspace / "raw_inputs"
    csv_file = raw_dir / "input.csv"
    with open(csv_file, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["id", "val"])
        writer.writeheader()
        writer.writerow({"id": 1, "val": 10.0})

    c_hash = compute_content_hash(csv_file)
    pinned_csv = raw_dir / f"{c_hash}.csv"
    csv_file.replace(pinned_csv)

    steps = [
        TransformationStep(
            step_id="step_a",
            operation_type=OperationType.FILTER_ROWS,
            input_step_ids=["raw_data"],
            parameters={"predicate": "id > 0"},
        ),
        TransformationStep(
            step_id="step_b",
            operation_type=OperationType.DERIVE_COLUMN,
            input_step_ids=["step_a"],
            parameters={"target_column": "bonus", "expression": "val * 2"},
        ),
    ]

    manifest = generate_replay_manifest(
        run_id=uuid4(),
        pipeline_version_id=uuid4(),
        pipeline_definition_hash="0" * 64,
        inputs=[
            ManifestInput(
                input_id="raw_data",
                version_id=uuid4(),
                content_hash=c_hash,
                multiset_hash="0" * 64,
                row_count=1,
                byte_size=pinned_csv.stat().st_size,
            )
        ],
        steps=steps,
    )

    # step_a matches, but step_b historical record expected a different hash
    step_a_hash = compute_multiset_hash([{"id": 1, "val": 10.0}])
    fake_step_b_hash = "e" * 64

    result = HistoricalReplayer.replay_run(
        manifest=manifest,
        workspace_root=replay_workspace,
        historical_step_hashes={
            "step_a": step_a_hash,
            "step_b": fake_step_b_hash,
        },
    )

    assert result.outcome == ReplayOutcome.DIVERGENT
    assert "starting at step 'step_b'" in result.explanation
    assert result.late_divergence_step_id == "step_b"
    assert result.step_verifications["step_a"].is_matched is True
    assert result.step_verifications["step_b"].is_matched is False
    assert result.step_verifications["step_b"].is_late_divergence_point is True


def test_replay_outcome_failed_verification(replay_workspace: Path) -> None:
    raw_dir = replay_workspace / "raw_inputs"
    csv_file = raw_dir / "input.csv"
    with open(csv_file, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["id"])
        writer.writeheader()
        writer.writerow({"id": 1})

    c_hash = compute_content_hash(csv_file)
    pinned_csv = raw_dir / f"{c_hash}.csv"
    csv_file.replace(pinned_csv)

    # Step has invalid expression referencing missing column causing failure during evaluation
    steps = [
        TransformationStep(
            step_id="step_bad",
            operation_type=OperationType.DERIVE_COLUMN,
            input_step_ids=["raw_data"],
            parameters={"target_column": "x", "expression": "missing_col + 1"},
        )
    ]

    manifest = generate_replay_manifest(
        run_id=uuid4(),
        pipeline_version_id=uuid4(),
        pipeline_definition_hash="0" * 64,
        inputs=[
            ManifestInput(
                input_id="raw_data",
                version_id=uuid4(),
                content_hash=c_hash,
                multiset_hash="0" * 64,
                row_count=1,
                byte_size=pinned_csv.stat().st_size,
            )
        ],
        steps=steps,
    )

    result = HistoricalReplayer.replay_run(
        manifest=manifest,
        workspace_root=replay_workspace,
    )

    assert result.outcome == ReplayOutcome.FAILED_VERIFICATION
    assert "failed during evaluation" in result.explanation
