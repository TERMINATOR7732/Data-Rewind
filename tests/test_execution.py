"""Tests for Pipeline Step Executor and Checkpoint Materialization.

Conforms to Section 1.2 of SPEC-MOD-03.
"""

from __future__ import annotations

import csv
from pathlib import Path

import duckdb
import pytest

from data_rewind.core.domain.models import (
    OperationType,
    RunLifecycle,
    StepStatus,
    TransformationStep,
)
from data_rewind.execution.engine import PipelineExecutor
from data_rewind.execution.models import ExecutionOptions


@pytest.fixture
def temp_workspace(tmp_path: Path) -> Path:
    ws = tmp_path / "workspace"
    ws.mkdir()
    return ws


def test_pipeline_executor_all_seven_operations(temp_workspace: Path) -> None:
    """Verify deterministic execution and Parquet materialization for all 7 operations."""
    steps = [
        # 1. filter_rows
        TransformationStep(
            step_id="step_filter",
            operation_type=OperationType.FILTER_ROWS,
            input_step_ids=["raw_orders"],
            parameters={"predicate": "amount > 50 and status == 'OK'"},
        ),
        # 2. derive_column
        TransformationStep(
            step_id="step_derive",
            operation_type=OperationType.DERIVE_COLUMN,
            input_step_ids=["step_filter"],
            parameters={"target_column": "tax", "expression": "amount * 0.1"},
        ),
        # 3. join_datasets
        TransformationStep(
            step_id="step_join",
            operation_type=OperationType.JOIN_DATASETS,
            input_step_ids=["step_derive", "raw_customers"],
            parameters={"join_type": "inner", "join_keys": ["cust_id"]},
        ),
        # 4. deduplicate_rows
        TransformationStep(
            step_id="step_dedup",
            operation_type=OperationType.DEDUPLICATE_ROWS,
            input_step_ids=["step_join"],
            parameters={"subset_columns": ["order_id"]},
        ),
        # 5. cast_columns
        TransformationStep(
            step_id="step_cast",
            operation_type=OperationType.CAST_COLUMNS,
            input_step_ids=["step_dedup"],
            parameters={"target_types": {"tax": "DOUBLE"}},
        ),
        # 6. sort_rows
        TransformationStep(
            step_id="step_sort",
            operation_type=OperationType.SORT_ROWS,
            input_step_ids=["step_cast"],
            parameters={"sort_columns": [{"column": "order_id", "ascending": True}]},
        ),
        # 7. aggregate_group_by
        TransformationStep(
            step_id="step_agg",
            operation_type=OperationType.AGGREGATE_GROUP_BY,
            input_step_ids=["step_sort"],
            parameters={
                "group_by_columns": ["country"],
                "aggregations": {"total_tax": "SUM(tax)", "orders_cnt": "COUNT(*)"},
            },
        ),
    ]

    orders = [
        {"order_id": 1, "cust_id": 100, "amount": 100.0, "status": "OK"},
        {"order_id": 2, "cust_id": 200, "amount": 30.0, "status": "OK"},  # Filtered out by amount
        {
            "order_id": 3,
            "cust_id": 100,
            "amount": 200.0,
            "status": "PENDING",
        },  # Filtered out by status
        {"order_id": 4, "cust_id": 200, "amount": 150.0, "status": "OK"},
        {"order_id": 4, "cust_id": 200, "amount": 150.0, "status": "OK"},  # Duplicate row
    ]

    customers = [
        {"cust_id": 100, "country": "US"},
        {"cust_id": 200, "country": "EU"},
    ]

    options = ExecutionOptions(
        workspace_root=temp_workspace,
        fail_fast=True,
        export_intermediate_checkpoints=True,
    )

    res = PipelineExecutor.execute_pipeline(
        steps=steps,
        inputs={"raw_orders": orders, "raw_customers": customers},
        options=options,
    )

    assert res.status == RunLifecycle.COMPLETED
    assert res.failed_step_id is None
    assert len(res.step_results) == 7

    for sid in [
        "step_filter",
        "step_derive",
        "step_join",
        "step_dedup",
        "step_cast",
        "step_sort",
        "step_agg",
    ]:
        sr = res.step_results[sid]
        assert sr.status == StepStatus.SUCCESS
        assert sr.parquet_path is not None
        assert sr.parquet_path.exists()
        assert sr.content_hash is not None and len(sr.content_hash) == 64
        assert sr.multiset_hash is not None and len(sr.multiset_hash) == 64
        assert sr.row_count > 0

    # Verify final aggregation output content
    final_parquet = res.step_results["step_agg"].parquet_path
    assert final_parquet is not None
    conn = duckdb.connect()
    agg_rows = conn.execute(
        f"SELECT * FROM read_parquet('{final_parquet.as_posix()}') ORDER BY country"
    ).fetchall()
    conn.close()

    # country, total_tax, orders_cnt
    assert len(agg_rows) == 2
    # EU: order 4 (tax = 15.0), orders_cnt = 1
    assert agg_rows[0][0] == "EU"
    assert agg_rows[0][1] == pytest.approx(15.0)
    assert agg_rows[0][2] == 1
    # US: order 1 (tax = 10.0), orders_cnt = 1
    assert agg_rows[1][0] == "US"
    assert agg_rows[1][1] == pytest.approx(10.0)
    assert agg_rows[1][2] == 1


def test_pipeline_executor_csv_input_file(temp_workspace: Path) -> None:
    csv_file = temp_workspace / "input.csv"
    with open(csv_file, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["id", "val"])
        writer.writeheader()
        writer.writerow({"id": 1, "val": 10.5})
        writer.writerow({"id": 2, "val": 20.5})

    steps = [
        TransformationStep(
            step_id="step_1",
            operation_type=OperationType.FILTER_ROWS,
            input_step_ids=["raw_data"],
            parameters={"predicate": "id == 1"},
        )
    ]

    res = PipelineExecutor.execute_pipeline(
        steps=steps,
        inputs={"raw_data": csv_file},
        options=ExecutionOptions(workspace_root=temp_workspace),
    )

    assert res.status == RunLifecycle.COMPLETED
    assert res.step_results["step_1"].row_count == 1


def test_pipeline_executor_fail_fast_on_error(temp_workspace: Path) -> None:
    steps = [
        TransformationStep(
            step_id="step_ok",
            operation_type=OperationType.FILTER_ROWS,
            input_step_ids=["raw_data"],
            parameters={"predicate": "id > 0"},
        ),
        TransformationStep(
            step_id="step_bad",
            operation_type=OperationType.DERIVE_COLUMN,
            input_step_ids=["step_ok"],
            parameters={"target_column": "x", "expression": "non_existent_column + 1"},
        ),
        TransformationStep(
            step_id="step_downstream",
            operation_type=OperationType.FILTER_ROWS,
            input_step_ids=["step_bad"],
            parameters={"predicate": "x > 0"},
        ),
    ]

    res = PipelineExecutor.execute_pipeline(
        steps=steps,
        inputs={"raw_data": [{"id": 1}]},
        options=ExecutionOptions(workspace_root=temp_workspace, fail_fast=True),
    )

    assert res.status == RunLifecycle.FAILED
    assert res.failed_step_id == "step_bad"

    # Upstream completed checkpoint is saved and valid
    assert res.step_results["step_ok"].status == StepStatus.SUCCESS
    assert res.step_results["step_ok"].parquet_path is not None
    assert res.step_results["step_ok"].parquet_path.exists()

    # Failing step is FAILED
    assert res.step_results["step_bad"].status == StepStatus.FAILED
    assert res.step_results["step_bad"].error_message is not None

    # Downstream step is SKIPPED
    assert res.step_results["step_downstream"].status == StepStatus.SKIPPED


def test_pipeline_executor_rejects_unsafe_expression(temp_workspace: Path) -> None:
    steps = [
        TransformationStep(
            step_id="step_unsafe",
            operation_type=OperationType.FILTER_ROWS,
            input_step_ids=["raw_data"],
            parameters={"predicate": "__import__('os').system('dir')"},
        )
    ]

    res = PipelineExecutor.execute_pipeline(
        steps=steps,
        inputs={"raw_data": [{"id": 1}]},
        options=ExecutionOptions(workspace_root=temp_workspace),
    )

    assert res.status == RunLifecycle.FAILED
    assert res.failed_step_id == "step_unsafe"
    err = str(res.error_message).lower()
    assert "prohibited" in err or "disallowed" in err
