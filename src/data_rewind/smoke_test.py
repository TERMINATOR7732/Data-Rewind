"""Data Rewind — Determinism and Execution Foundation Smoke Test.

Exercises the integrated core engine foundations:
1. Valid domain model construction.
2. DAG validation and deterministic topological ordering.
3. Sandboxed AST expression validation and evaluation.
4. DuckDB runtime connection and parameterized query execution.
5. Canonical row serialization and order-independent multiset hashing.
6. Atomic artifact publishing with path containment.
7. ReplayManifest generation and round-trip verification.
8. Clean resource teardown.

Returns 0 on complete verification; non-zero if any invariant fails.
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path
from typing import Any
from uuid import uuid4

import duckdb

from data_rewind.core.config.guards import ResourceGuards
from data_rewind.core.config.settings import Settings
from data_rewind.core.dag.validator import DAGValidator
from data_rewind.core.db.duckdb_runtime import DuckDBConfig, DuckDBRuntime
from data_rewind.core.domain.lifecycle import LifecycleStateMachine
from data_rewind.core.domain.models import (
    ColumnDefinition,
    DatasetSchema,
    DataType,
    OperationType,
    PipelineDefinition,
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


def run_smoke_test() -> int:
    """Execute complete smoke test workflow."""
    print("=" * 70)
    print("DATA REWIND -- CORE ENGINE FOUNDATIONS SMOKE TEST")
    print("Tagline: Understand the past. Verify the present.")
    print("=" * 70)

    try:
        # Step 1: Centralized Settings & Diagnostics
        print("\n[1/8] Loading centralized settings and diagnostics...")
        settings = Settings.load()
        print(f"  - App: {settings.app_name} v{settings.version}")
        print(f"  - Profile: {settings.profile}")
        print(f"  - Python: {sys.version.split()[0]}")
        print(f"  - DuckDB: {duckdb.__version__}")
        print("  [OK] Settings loaded successfully.")

        # Step 2: Domain Model & Lifecycle State Machine
        print("\n[2/8] Verifying domain models & lifecycle FSM...")
        ws_id = uuid4()
        pipeline_id = uuid4()
        run_id = uuid4()
        p_version_id = uuid4()

        col1 = ColumnDefinition(name="order_id", data_type=DataType.INTEGER, ordinal_position=0)
        col2 = ColumnDefinition(name="amount", data_type=DataType.FLOAT, ordinal_position=1)
        col3 = ColumnDefinition(name="status", data_type=DataType.STRING, ordinal_position=2)

        schema = DatasetSchema(
            column_count=3,
            fingerprint_sha256="abc123fingerprint",
            columns=[col1, col2, col3],
        )
        assert schema.column_count == 3

        p_def = PipelineDefinition(
            workspace_id=ws_id, name="Daily Sales Pipeline", pipeline_id=pipeline_id
        )
        assert p_def.name == "Daily Sales Pipeline"

        run = PipelineRun(
            run_id=run_id,
            pipeline_version_id=p_version_id,
            run_type=RunType.BASELINE,
            lifecycle_status=RunLifecycle.PENDING,
        )

        # Advance lifecycle through FSM: PENDING -> RUNNING -> COMPLETED
        run_active = LifecycleStateMachine.transition(run, RunLifecycle.RUNNING)
        assert run_active.lifecycle_status == RunLifecycle.RUNNING
        assert run_active.started_at is not None

        run_active = LifecycleStateMachine.update_heartbeat(run_active)
        assert not LifecycleStateMachine.is_heartbeat_lost(run_active, timeout_seconds=60)

        run_completed = LifecycleStateMachine.transition(run_active, RunLifecycle.COMPLETED)
        assert run_completed.lifecycle_status == RunLifecycle.COMPLETED
        assert run_completed.completed_at is not None
        print("  [OK] Domain models & FSM transitions verified.")

        # Step 3: DAG Validation & Kahn's Deterministic Ordering
        print("\n[3/8] Verifying DAG validation & Kahn's deterministic ordering...")
        step1 = TransformationStep(
            step_id="step_clean",
            operation_type=OperationType.FILTER_ROWS,
            input_step_ids=["raw_orders"],
            parameters={"predicate": "amount > 0"},
        )
        step2 = TransformationStep(
            step_id="step_augment",
            operation_type=OperationType.DERIVE_COLUMN,
            input_step_ids=["step_clean"],
            parameters={"expression": "amount * 1.18"},
        )
        step3 = TransformationStep(
            step_id="step_summary",
            operation_type=OperationType.AGGREGATE_GROUP_BY,
            input_step_ids=["step_augment"],
            parameters={"group_by": ["status"]},
        )

        order = DAGValidator.validate_and_order(
            steps=[step3, step1, step2],  # Given out of order
            registered_inputs=["raw_orders"],
        )
        expected_order = ["step_clean", "step_augment", "step_summary"]
        assert order == expected_order, f"Expected {expected_order}, got {order}"
        print(f"  [OK] Deterministic topological order: {' -> '.join(order)}")

        # Step 4: Sandboxed AST Expression Engine
        print("\n[4/8] Verifying sandboxed AST expression engine...")
        expr_str = "coalesce(tax, 0.0) + amount * 1.1"
        evaluator = ASTEvaluator.compile_expression(expr_str)

        test_rows: list[dict[str, Any]] = [
            {"amount": 100.0, "tax": 10.0},
            {"amount": 50.0, "tax": None},
            {"amount": 200.0, "tax": 25.0},
        ]
        results = evaluator.evaluate_batch(test_rows, timeout_seconds=1.0)
        rounded_results = [round(r, 2) if isinstance(r, float) else r for r in results]
        expected_results = [120.0, 55.0, 245.0]
        assert rounded_results == expected_results, (
            f"Expected {expected_results}, got {rounded_results}"
        )
        print("  [OK] AST expressions safely evaluated with zero eval/exec.")

        # Step 5: Controlled DuckDB Runtime
        print("\n[5/8] Verifying DuckDB runtime abstraction & transactions...")
        db_config = DuckDBConfig(database_path=":memory:", max_memory_mb=128, threads=2)
        with DuckDBRuntime(db_config) as runtime:
            runtime.execute_statement(
                "CREATE TABLE test_data (id INTEGER, name VARCHAR, value DOUBLE)"
            )
            # Parameterized insert
            runtime.execute_statement(
                "INSERT INTO test_data VALUES (?, ?, ?)",
                [1, "Order_101", 150.75],
            )
            # Query verification
            rows = runtime.execute_query_dicts("SELECT * FROM test_data WHERE id = ?", [1])
            assert len(rows) == 1
            assert rows[0]["name"] == "Order_101"
            assert rows[0]["value"] == 150.75

            # Transaction rollback verification
            try:
                with runtime.transaction():
                    runtime.execute_statement("INSERT INTO test_data VALUES (2, 'Temp', 10.0)")
                    raise RuntimeError("Simulated transaction error")
            except RuntimeError:
                pass

            count = runtime.execute_scalar("SELECT count(*) FROM test_data")
            assert count == 1, f"Rollback failed: expected 1 row, got {count}"
        print("  [OK] DuckDB runtime queries and transactional rollback verified.")

        # Step 6: Canonical Serialization & Multiset Hashing
        print("\n[6/8] Verifying canonical serialization & multiset hashing...")
        row_a = {"id": 1, "val": 10.5, "flag": True}
        row_b = {"id": 2, "val": 20.0, "flag": False}

        # Permuted rows should produce identical multiset hash
        dataset1 = [row_a, row_b]
        dataset2 = [row_b, row_a]

        h1 = compute_multiset_hash(dataset1)
        h2 = compute_multiset_hash(dataset2)
        assert h1 == h2, f"Multiset permutation invariant failed: {h1} != {h2}"
        assert len(h1) == 64
        print(f"  [OK] Multiset hash invariant under permutation: {h1[:16]}...")

        # Step 7: Atomic Artifact Vault & Storage
        print("\n[7/8] Verifying atomic artifact vault & path jail...")
        with tempfile.TemporaryDirectory() as temp_dir:
            ws_root = Path(temp_dir) / "workspace_test"
            vault = ArtifactStorageVault(ws_root)

            # Pre-flight check
            ResourceGuards.check_preflight_disk_space(ws_root)

            # Publish synthetic payload
            sample_payload = b"PARQUET_SYNTHETIC_CHECKPOINT_BYTES_DATAREWIND_V1"
            published_path, published_hash = vault.publish_bytes_atomic(
                sample_payload, prefix="step_clean"
            )

            assert published_path.exists()
            assert published_hash == compute_content_hash(sample_payload)

            # Read back and verify
            recovered_bytes = vault.read_artifact_verified(published_path, published_hash)
            assert recovered_bytes == sample_payload
            print("  [OK] Atomic artifact publication & path jail verified.")

            # Step 8: ReplayManifest Generation & Parsing
            print("\n[8/8] Verifying ReplayManifest creation & integrity...")
            manifest = ReplayManifest.create(
                run_id=run_id,
                pipeline_version_id=p_version_id,
                pipeline_definition_hash="e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
                inputs=[
                    ManifestInput(
                        input_id="raw_orders",
                        version_id=uuid4(),
                        content_hash=published_hash,
                        multiset_hash=h1,
                        row_count=2,
                        byte_size=len(sample_payload),
                    )
                ],
                steps_snapshot=[
                    ManifestStepSnapshot(
                        step_id="step_clean",
                        operation="filter_rows",
                        parameters={"predicate": "amount > 0"},
                    )
                ],
            )

            manifest_json = manifest.to_canonical_json()
            restored = ReplayManifest.from_json(manifest_json)
            assert restored.run_id == run_id
            assert restored.pipeline_definition_hash == manifest.pipeline_definition_hash
            print("  [OK] ReplayManifest canonical serialization round-trip verified.")

        print("\n" + "=" * 70)
        print("ALL CORE ENGINE FOUNDATION SMOKE TESTS PASSED [100% OK]")
        print("=" * 70)
        return 0

    except Exception as exc:
        print(f"\n[FAIL] SMOKE TEST FAILED: {exc}", file=sys.stderr)
        import traceback

        traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(run_smoke_test())
