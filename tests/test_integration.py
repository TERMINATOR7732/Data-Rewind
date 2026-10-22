"""End-to-end integration and determinism verification tests for Data Rewind core engine."""

from __future__ import annotations

from pathlib import Path
from uuid import uuid4

from data_rewind.core.dag.validator import DAGValidator
from data_rewind.core.db.duckdb_runtime import DuckDBConfig, DuckDBRuntime
from data_rewind.core.domain.lifecycle import LifecycleStateMachine
from data_rewind.core.domain.models import (
    OperationType,
    PipelineRun,
    RunLifecycle,
    RunType,
    TransformationStep,
)
from data_rewind.core.expr.evaluator import ASTEvaluator
from data_rewind.core.integrity.hashing import (
    compute_content_hash,
    compute_multiset_hash,
)
from data_rewind.core.integrity.manifest import (
    ManifestInput,
    ManifestStepSnapshot,
    ReplayManifest,
)
from data_rewind.core.integrity.storage import ArtifactStorageVault


def test_end_to_end_pipeline_execution_and_determinism(temp_workspace: Path) -> None:
    """Verify that running a complete pipeline produces deterministic artifacts, hashes, and manifests."""
    vault = ArtifactStorageVault(temp_workspace)

    # 1. Define multi-step DAG
    steps = [
        TransformationStep(
            step_id="step_clean_orders",
            operation_type=OperationType.FILTER_ROWS,
            input_step_ids=["raw_orders"],
            parameters={"predicate": "amount > 0 and status == 'COMPLETED'"},
        ),
        TransformationStep(
            step_id="step_compute_tax",
            operation_type=OperationType.DERIVE_COLUMN,
            input_step_ids=["step_clean_orders"],
            parameters={"expression": "amount * 1.18"},
        ),
    ]

    # 2. Validate DAG and get execution order
    order = DAGValidator.validate_and_order(steps, registered_inputs=["raw_orders"])
    assert order == ["step_clean_orders", "step_compute_tax"]

    # 3. Simulate two consecutive runs with identical raw inputs
    def execute_pipeline(run_id: str) -> tuple[str, str, ReplayManifest]:
        run = PipelineRun(
            run_id=uuid4(),
            pipeline_version_id=uuid4(),
            run_type=RunType.BASELINE,
            lifecycle_status=RunLifecycle.PENDING,
        )
        run_running = LifecycleStateMachine.transition(run, RunLifecycle.RUNNING)

        # Raw records
        raw_rows = [
            {"id": 101, "amount": 100.0, "status": "COMPLETED"},
            {"id": 102, "amount": -50.0, "status": "REFUNDED"},
            {"id": 103, "amount": 250.0, "status": "COMPLETED"},
        ]

        # Step 1: Filter
        eval_filter = ASTEvaluator.compile_expression("amount > 0 and status == 'COMPLETED'")
        step1_rows = [r for r in raw_rows if eval_filter.evaluate(r)]
        assert len(step1_rows) == 2

        # Step 2: Derive tax
        eval_tax = ASTEvaluator.compile_expression("amount * 1.18")
        step2_rows = []
        for r in step1_rows:
            taxed = dict(r)
            taxed["total_with_tax"] = eval_tax.evaluate(r)
            step2_rows.append(taxed)

        # DuckDB checkpoint
        db_config = DuckDBConfig(database_path=":memory:")
        with DuckDBRuntime(db_config) as runtime:
            runtime.execute_statement(
                "CREATE TABLE output_step2 (id INTEGER, amount DOUBLE, status VARCHAR, total_with_tax DOUBLE)"
            )
            for r in step2_rows:
                runtime.execute_statement(
                    "INSERT INTO output_step2 VALUES (?, ?, ?, ?)",
                    [r["id"], r["amount"], r["status"], r["total_with_tax"]],
                )
            queried = runtime.execute_query_dicts("SELECT * FROM output_step2 ORDER BY id")

        # Canonical multiset hash of final table
        multiset_digest = compute_multiset_hash(queried)

        # Publish artifact
        synthetic_parquet_bytes = f"PARQUET_ROWS_{multiset_digest}".encode()
        published_path, content_digest = vault.publish_bytes_atomic(
            synthetic_parquet_bytes, prefix=f"run_{run_id}"
        )

        # Generate ReplayManifest
        manifest = ReplayManifest.create(
            run_id=run.run_id,
            pipeline_version_id=run.pipeline_version_id,
            pipeline_definition_hash="e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            inputs=[
                ManifestInput(
                    input_id="raw_orders",
                    version_id=uuid4(),
                    content_hash=compute_content_hash(b"RAW_CSV_SOURCE_BYTES"),
                    multiset_hash=compute_multiset_hash(raw_rows),
                    row_count=len(raw_rows),
                    byte_size=100,
                )
            ],
            steps_snapshot=[
                ManifestStepSnapshot(
                    step_id="step_clean_orders",
                    operation="filter_rows",
                    parameters={"predicate": "amount > 0 and status == 'COMPLETED'"},
                ),
                ManifestStepSnapshot(
                    step_id="step_compute_tax",
                    operation="derive_column",
                    parameters={"expression": "amount * 1.18"},
                ),
            ],
        )

        LifecycleStateMachine.transition(run_running, RunLifecycle.COMPLETED)
        return multiset_digest, content_digest, manifest

    # Run 1
    m1, c1, man1 = execute_pipeline("run_1")
    # Run 2
    m2, c2, man2 = execute_pipeline("run_2")

    # Invariant: Output multiset hashes and content hashes are 100% identical
    assert m1 == m2
    assert c1 == c2
    assert len(m1) == 64
    assert len(c1) == 64

    # Manifest snapshots match
    assert man1.pipeline_definition_hash == man2.pipeline_definition_hash
    assert len(man1.steps_snapshot) == len(man2.steps_snapshot)
    assert man1.inputs[0].multiset_hash == man2.inputs[0].multiset_hash
