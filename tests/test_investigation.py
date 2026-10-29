"""Tests for Forensic Investigation Orchestration and SQLite Persistence.

Conforms to SPEC-MOD-01, SPEC-MOD-04, and SPEC-MOD-07.
"""

from __future__ import annotations

from pathlib import Path
from uuid import uuid4

import pytest

from data_rewind.core.domain.models import OperationType, TransformationStep
from data_rewind.diagnostics.models import DiagnosticRuleID, EODStatus
from data_rewind.investigation.orchestrator import InvestigationOrchestrator
from data_rewind.investigation.persistence import InvestigationRepository


@pytest.fixture
def repo(tmp_path: Path) -> InvestigationRepository:
    db_file = tmp_path / "test_investigations.db"
    return InvestigationRepository(db_file)


def test_investigation_orchestration_end_to_end(repo: InvestigationRepository) -> None:
    steps = [
        TransformationStep(
            step_id="step_ingest",
            operation_type=OperationType.FILTER_ROWS,
            input_step_ids=["raw_data"],
            parameters={"predicate": "id > 0"},
        ),
        TransformationStep(
            step_id="step_transform",
            operation_type=OperationType.DERIVE_COLUMN,
            input_step_ids=["step_ingest"],
            parameters={"target_column": "tax", "expression": "val * 0.1"},
        ),
    ]

    # Baseline data
    base_ingest = [{"id": 1, "val": 100.0}, {"id": 2, "val": 200.0}]
    base_transform = [{"id": 1, "val": 100.0, "tax": 10.0}, {"id": 2, "val": 200.0, "tax": 20.0}]

    # Target data (mutated formula in transform: tax = 20.0, 40.0)
    targ_ingest = [{"id": 1, "val": 100.0}, {"id": 2, "val": 200.0}]
    targ_transform = [{"id": 1, "val": 100.0, "tax": 20.0}, {"id": 2, "val": 200.0, "tax": 40.0}]

    target_steps = [
        TransformationStep(
            step_id="step_ingest",
            operation_type=OperationType.FILTER_ROWS,
            input_step_ids=["raw_data"],
            parameters={"predicate": "id > 0"},
        ),
        TransformationStep(
            step_id="step_transform",
            operation_type=OperationType.DERIVE_COLUMN,
            input_step_ids=["step_ingest"],
            parameters={"target_column": "tax", "expression": "val * 0.2"},
        ),
    ]

    inv = InvestigationOrchestrator.investigate_runs(
        title="Formula Regression Investigation",
        baseline_run_id=uuid4(),
        target_run_id=uuid4(),
        steps=steps,
        target_steps=target_steps,
        baseline_step_data={"step_ingest": base_ingest, "step_transform": base_transform},
        target_step_data={"step_ingest": targ_ingest, "step_transform": targ_transform},
        primary_keys_by_step={"step_ingest": ["id"], "step_transform": ["id"]},
        repository=repo,
    )

    # Ingestion step is identical
    assert inv.step_comparisons["step_ingest"].is_equal is True

    # Transform step diverged
    assert inv.step_comparisons["step_transform"].is_equal is False
    assert inv.eod_result.primary_eod_step == "step_transform"
    assert inv.eod_result.status == EODStatus.EXACT_EOD

    # Diagnostic rule DR-02 fired
    finding_rule_ids = [f.rule_id for f in inv.eod_result.findings]
    assert DiagnosticRuleID.DR_02_ARITHMETIC_EXPRESSION_MUTATION in finding_rule_ids

    # Blast radius: 1/2 nodes tainted
    assert inv.blast_radius.total_nodes_count == 2
    assert inv.blast_radius.tainted_nodes_count == 1
    assert inv.blast_radius.blast_radius_ratio == 0.5
    assert "step_transform" in inv.blast_radius.affected_terminal_sinks

    # Persistence verification: loaded from repo
    loaded = repo.get(inv.investigation_id)
    assert loaded is not None
    assert loaded.investigation_id == inv.investigation_id
    assert loaded.title == inv.title
    assert loaded.eod_result.primary_eod_step == "step_transform"


def test_investigation_repository_crud(repo: InvestigationRepository) -> None:
    # List empty initially
    assert repo.list() == []

    # Create dummy investigation
    steps = [
        TransformationStep(
            step_id="s1",
            operation_type=OperationType.FILTER_ROWS,
            input_step_ids=["raw"],
            parameters={"predicate": "id > 0"},
        )
    ]
    inv = InvestigationOrchestrator.investigate_runs(
        title="Test Investigation",
        baseline_run_id=uuid4(),
        target_run_id=uuid4(),
        steps=steps,
        baseline_step_data={"s1": [{"id": 1}]},
        target_step_data={"s1": [{"id": 1}]},
        repository=repo,
    )

    summaries = repo.list()
    assert len(summaries) == 1
    assert summaries[0].investigation_id == inv.investigation_id
    assert summaries[0].title == "Test Investigation"

    # Delete
    deleted = repo.delete(inv.investigation_id)
    assert deleted is True
    assert repo.get(inv.investigation_id) is None
    assert repo.list() == []


def test_investigation_repository_wal_mode_and_busy_timeout(tmp_path: Path) -> None:
    db_file = tmp_path / "wal_test.db"
    repo = InvestigationRepository(db_file)
    with repo._connect() as conn:
        journal_mode = conn.execute("PRAGMA journal_mode;").fetchone()[0]
        busy_timeout = conn.execute("PRAGMA busy_timeout;").fetchone()[0]
    assert journal_mode.lower() == "wal"
    assert busy_timeout == 5000
