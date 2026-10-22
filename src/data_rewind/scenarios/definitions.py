"""Data Rewind canonical demonstration scenarios (SCN-01 through SCN-04).

Conforms to Decision D-04 and SPEC-MOD-01/04.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict

from data_rewind.core.domain.models import OperationType, TransformationStep
from data_rewind.diagnostics.models import DiagnosticRuleID


class ScenarioDefinition(BaseModel):
    """Specification of a deterministic demo scenario."""

    model_config = ConfigDict(frozen=True)

    scenario_id: str
    title: str
    description: str
    expected_eod_step: str
    expected_rule_id: DiagnosticRuleID
    steps: list[TransformationStep]
    target_steps: list[TransformationStep] | None = None
    baseline_inputs: dict[str, list[dict[str, Any]]]
    target_inputs: dict[str, list[dict[str, Any]]]
    primary_keys_by_step: dict[str, list[str]] = {}


def get_scenario_scn01() -> ScenarioDefinition:
    """SCN-01: Upstream Vendor Schema / Input Data Drift."""
    steps = [
        TransformationStep(
            step_id="ingest_orders",
            operation_type=OperationType.FILTER_ROWS,
            input_step_ids=["raw_orders"],
            parameters={"predicate": "order_id > 0"},
        ),
        TransformationStep(
            step_id="filter_completed",
            operation_type=OperationType.FILTER_ROWS,
            input_step_ids=["ingest_orders"],
            parameters={"predicate": "status == 'COMPLETED'"},
        ),
        TransformationStep(
            step_id="aggregate_revenue",
            operation_type=OperationType.AGGREGATE_GROUP_BY,
            input_step_ids=["filter_completed"],
            parameters={
                "group_by_columns": ["region"],
                "aggregations": {"total_revenue": "SUM(amount)"},
            },
        ),
    ]

    baseline_orders = [
        {"order_id": 1, "region": "NORTH", "amount": 100.0, "status": "COMPLETED"},
        {"order_id": 2, "region": "SOUTH", "amount": 150.0, "status": "COMPLETED"},
        {"order_id": 3, "region": "NORTH", "amount": 200.0, "status": "PENDING"},
        {"order_id": 4, "region": "EAST", "amount": 80.0, "status": "COMPLETED"},
    ]

    # Target: upstream source vendor mutated records at ingestion boundary (amount changed & extra row)
    target_orders = [
        {"order_id": 1, "region": "NORTH", "amount": 120.0, "status": "COMPLETED"},
        {"order_id": 2, "region": "SOUTH", "amount": 150.0, "status": "COMPLETED"},
        {"order_id": 3, "region": "NORTH", "amount": 200.0, "status": "PENDING"},
        {"order_id": 4, "region": "EAST", "amount": 80.0, "status": "COMPLETED"},
        {"order_id": 5, "region": "WEST", "amount": 300.0, "status": "COMPLETED"},
    ]

    return ScenarioDefinition(
        scenario_id="scn01",
        title="SCN-01: Upstream Vendor Input Data Drift",
        description="External source vendor mutated ingestion payload, producing upstream data drift.",
        expected_eod_step="ingest_orders",
        expected_rule_id=DiagnosticRuleID.DR_01_UPSTREAM_INPUT_DATA_DRIFT,
        steps=steps,
        baseline_inputs={"raw_orders": baseline_orders},
        target_inputs={"raw_orders": target_orders},
        primary_keys_by_step={"ingest_orders": ["order_id"], "filter_completed": ["order_id"]},
    )


def get_scenario_scn02() -> ScenarioDefinition:
    """SCN-02: Arithmetic Expression Mutation (Formula Drift)."""
    # Baseline pipeline has fee = amount * 0.10
    # Target pipeline mutates step 2 to fee = amount * 0.20
    steps_base = [
        TransformationStep(
            step_id="ingest_transactions",
            operation_type=OperationType.FILTER_ROWS,
            input_step_ids=["raw_txns"],
            parameters={"predicate": "txn_id > 0"},
        ),
        TransformationStep(
            step_id="compute_fee",
            operation_type=OperationType.DERIVE_COLUMN,
            input_step_ids=["ingest_transactions"],
            parameters={"target_column": "fee", "expression": "amount * 0.1"},
        ),
        TransformationStep(
            step_id="mart_revenue",
            operation_type=OperationType.AGGREGATE_GROUP_BY,
            input_step_ids=["compute_fee"],
            parameters={
                "group_by_columns": ["currency"],
                "aggregations": {"total_fee": "SUM(fee)"},
            },
        ),
    ]

    steps_target = [
        TransformationStep(
            step_id="ingest_transactions",
            operation_type=OperationType.FILTER_ROWS,
            input_step_ids=["raw_txns"],
            parameters={"predicate": "txn_id > 0"},
        ),
        TransformationStep(
            step_id="compute_fee",
            operation_type=OperationType.DERIVE_COLUMN,
            input_step_ids=["ingest_transactions"],
            parameters={"target_column": "fee", "expression": "amount * 0.2"},
        ),
        TransformationStep(
            step_id="mart_revenue",
            operation_type=OperationType.AGGREGATE_GROUP_BY,
            input_step_ids=["compute_fee"],
            parameters={
                "group_by_columns": ["currency"],
                "aggregations": {"total_fee": "SUM(fee)"},
            },
        ),
    ]

    txns = [
        {"txn_id": 101, "currency": "USD", "amount": 1000.0},
        {"txn_id": 102, "currency": "EUR", "amount": 500.0},
        {"txn_id": 103, "currency": "USD", "amount": 2500.0},
    ]

    return ScenarioDefinition(
        scenario_id="scn02",
        title="SCN-02: Arithmetic Expression Mutation",
        description="Downstream fee calculation formula mutated, altering values across rows.",
        expected_eod_step="compute_fee",
        expected_rule_id=DiagnosticRuleID.DR_02_ARITHMETIC_EXPRESSION_MUTATION,
        steps=steps_base,
        target_steps=steps_target,
        baseline_inputs={"raw_txns": txns},
        target_inputs={"raw_txns": txns},
        primary_keys_by_step={"ingest_transactions": ["txn_id"], "compute_fee": ["txn_id"]},
    )


def get_scenario_scn03() -> ScenarioDefinition:
    """SCN-03: Unmatched Join Drop."""
    steps_base = [
        TransformationStep(
            step_id="ingest_orders",
            operation_type=OperationType.FILTER_ROWS,
            input_step_ids=["raw_orders"],
            parameters={"predicate": "order_id > 0"},
        ),
        TransformationStep(
            step_id="ingest_customers",
            operation_type=OperationType.FILTER_ROWS,
            input_step_ids=["raw_customers"],
            parameters={"predicate": "customer_id > 0"},
        ),
        TransformationStep(
            step_id="join_orders_customers",
            operation_type=OperationType.JOIN_DATASETS,
            input_step_ids=["ingest_orders", "ingest_customers"],
            parameters={"join_type": "inner", "join_keys": ["customer_id"]},
        ),
    ]

    steps_target = [
        TransformationStep(
            step_id="ingest_orders",
            operation_type=OperationType.FILTER_ROWS,
            input_step_ids=["raw_orders"],
            parameters={"predicate": "order_id > 0"},
        ),
        TransformationStep(
            step_id="ingest_customers",
            operation_type=OperationType.FILTER_ROWS,
            input_step_ids=["raw_customers"],
            parameters={"predicate": "customer_id > 0"},
        ),
        TransformationStep(
            step_id="join_orders_customers",
            operation_type=OperationType.JOIN_DATASETS,
            input_step_ids=["ingest_orders", "ingest_customers"],
            parameters={
                "join_type": "inner",
                "on": "t1.customer_id = t2.customer_id AND t2.name = 'Alice'",
            },
        ),
    ]

    orders = [
        {"order_id": 1, "customer_id": 10, "amount": 50.0},
        {"order_id": 2, "customer_id": 20, "amount": 75.0},
        {"order_id": 3, "customer_id": 30, "amount": 100.0},
        {"order_id": 4, "customer_id": 40, "amount": 125.0},
    ]

    customers = [
        {"customer_id": 10, "name": "Alice"},
        {"customer_id": 20, "name": "Bob"},
        {"customer_id": 30, "name": "Charlie"},
        {"customer_id": 40, "name": "Diana"},
    ]

    return ScenarioDefinition(
        scenario_id="scn03",
        title="SCN-03: Unmatched Join Drop",
        description="Join predicate mutation caused catastrophic 75% row drop during join.",
        expected_eod_step="join_orders_customers",
        expected_rule_id=DiagnosticRuleID.DR_03_UNMATCHED_JOIN_DROP,
        steps=steps_base,
        target_steps=steps_target,
        baseline_inputs={"raw_orders": orders, "raw_customers": customers},
        target_inputs={"raw_orders": orders, "raw_customers": customers},
        primary_keys_by_step={"join_orders_customers": ["order_id"]},
    )


def get_scenario_scn04() -> ScenarioDefinition:
    """SCN-04: Null Sentinel Surge."""
    steps_base = [
        TransformationStep(
            step_id="ingest_metrics",
            operation_type=OperationType.FILTER_ROWS,
            input_step_ids=["raw_metrics"],
            parameters={"predicate": "metric_id > 0"},
        ),
        TransformationStep(
            step_id="clean_data",
            operation_type=OperationType.DERIVE_COLUMN,
            input_step_ids=["ingest_metrics"],
            parameters={"target_column": "score", "expression": "raw_score * 1.0"},
        ),
    ]

    steps_target = [
        TransformationStep(
            step_id="ingest_metrics",
            operation_type=OperationType.FILTER_ROWS,
            input_step_ids=["raw_metrics"],
            parameters={"predicate": "metric_id > 0"},
        ),
        TransformationStep(
            step_id="clean_data",
            operation_type=OperationType.DERIVE_COLUMN,
            input_step_ids=["ingest_metrics"],
            parameters={"target_column": "score", "expression": "None"},
        ),
    ]

    metrics = [
        {"metric_id": 1, "raw_score": 95.5, "status": "ACTIVE"},
        {"metric_id": 2, "raw_score": 88.0, "status": "ACTIVE"},
        {"metric_id": 3, "raw_score": 72.3, "status": "INACTIVE"},
    ]

    return ScenarioDefinition(
        scenario_id="scn04",
        title="SCN-04: Null Sentinel Surge",
        description="Coercion failure or missing string sentinels caused valid scores to become NULL.",
        expected_eod_step="clean_data",
        expected_rule_id=DiagnosticRuleID.DR_05_NULL_SENTINEL_SURGE,
        steps=steps_base,
        target_steps=steps_target,
        baseline_inputs={"raw_metrics": metrics},
        target_inputs={"raw_metrics": metrics},
        primary_keys_by_step={"ingest_metrics": ["metric_id"], "clean_data": ["metric_id"]},
    )


SCENARIO_REGISTRY: dict[str, ScenarioDefinition] = {
    "scn01": get_scenario_scn01(),
    "scn02": get_scenario_scn02(),
    "scn03": get_scenario_scn03(),
    "scn04": get_scenario_scn04(),
}
