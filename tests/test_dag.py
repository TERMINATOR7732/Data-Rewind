"""Tests for Data Rewind DAG validation, cycle detection, and Kahn's ordering."""

from __future__ import annotations

import random

import pytest

from data_rewind.core.dag.validator import DAGValidator
from data_rewind.core.domain.errors import (
    CyclicDependencyError,
    DanglingReferenceError,
    GraphValidationError,
)
from data_rewind.core.domain.models import OperationType, TransformationStep


def test_linear_dag_ordering() -> None:
    """Test standard linear pipeline ordering."""
    steps = [
        TransformationStep(
            step_id="step_c",
            operation_type=OperationType.AGGREGATE_GROUP_BY,
            input_step_ids=["step_b"],
        ),
        TransformationStep(
            step_id="step_a",
            operation_type=OperationType.FILTER_ROWS,
            input_step_ids=["raw_input"],
        ),
        TransformationStep(
            step_id="step_b",
            operation_type=OperationType.DERIVE_COLUMN,
            input_step_ids=["step_a"],
        ),
    ]

    order = DAGValidator.validate_and_order(steps, registered_inputs=["raw_input"])
    assert order == ["step_a", "step_b", "step_c"]


def test_diamond_dag_ordering(diamond_dag_steps: list[TransformationStep]) -> None:
    """Test diamond topology ordering with merge join."""
    order = DAGValidator.validate_and_order(diamond_dag_steps, registered_inputs=["raw_input"])
    assert order[0] == "step_source"
    # step_left and step_right can be in either order topologically, but tie-breaking puts 'step_left' first
    assert order[1] == "step_left"
    assert order[2] == "step_right"
    assert order[3] == "step_join"


def test_deterministic_tie_breaking_invariant(diamond_dag_steps: list[TransformationStep]) -> None:
    """Test that ordering is strictly deterministic across arbitrary input orderings."""
    expected_order = DAGValidator.validate_and_order(
        diamond_dag_steps, registered_inputs=["raw_input"]
    )

    # Shuffle the input steps 20 times and assert identical topological order every time
    shuffled = list(diamond_dag_steps)
    for _ in range(20):
        random.shuffle(shuffled)
        order = DAGValidator.validate_and_order(shuffled, registered_inputs=["raw_input"])
        assert order == expected_order


def test_disconnected_subgraphs_ordering() -> None:
    """Test that independent parallel pipelines are ordered deterministically by step_id."""
    steps = [
        TransformationStep(
            step_id="pipe2_step",
            operation_type=OperationType.FILTER_ROWS,
            input_step_ids=["raw_2"],
        ),
        TransformationStep(
            step_id="pipe1_step",
            operation_type=OperationType.FILTER_ROWS,
            input_step_ids=["raw_1"],
        ),
    ]
    order = DAGValidator.validate_and_order(steps, registered_inputs=["raw_1", "raw_2"])
    # Lexicographical tie-breaking prioritizes 'pipe1_step' before 'pipe2_step'
    assert order == ["pipe1_step", "pipe2_step"]


def test_self_dependency_rejected() -> None:
    """Test step depending directly on itself."""
    step = TransformationStep(
        step_id="step_self",
        operation_type=OperationType.FILTER_ROWS,
        input_step_ids=["step_self"],
    )
    with pytest.raises(CyclicDependencyError) as exc_info:
        DAGValidator.validate_and_order([step])
    assert "depends directly on itself" in exc_info.value.message
    assert exc_info.value.code == "CYCLIC_DEPENDENCY_ERROR"


def test_transitive_cycle_detection_with_path() -> None:
    """Test multi-node cycle detection and path reporting: A -> B -> C -> A."""
    steps = [
        TransformationStep(
            step_id="step_a",
            operation_type=OperationType.FILTER_ROWS,
            input_step_ids=["step_c"],
        ),
        TransformationStep(
            step_id="step_b",
            operation_type=OperationType.FILTER_ROWS,
            input_step_ids=["step_a"],
        ),
        TransformationStep(
            step_id="step_c",
            operation_type=OperationType.FILTER_ROWS,
            input_step_ids=["step_b"],
        ),
    ]
    with pytest.raises(CyclicDependencyError) as exc_info:
        DAGValidator.validate_and_order(steps)

    cycle = exc_info.value.details.get("cycle", [])
    assert len(cycle) >= 3
    # Cycle should return to start
    assert cycle[0] == cycle[-1]


def test_dangling_reference_rejected() -> None:
    """Test step referencing a non-existent step or unregistered input."""
    step = TransformationStep(
        step_id="step_a",
        operation_type=OperationType.FILTER_ROWS,
        input_step_ids=["phantom_dataset"],
    )
    with pytest.raises(DanglingReferenceError) as exc_info:
        DAGValidator.validate_and_order([step], registered_inputs=["real_input"])
    assert exc_info.value.code == "DANGLING_REFERENCE_ERROR"
    assert "unknown dependency 'phantom_dataset'" in exc_info.value.message


def test_duplicate_step_id_rejected() -> None:
    """Test duplicate step identifiers are rejected immediately."""
    s1 = TransformationStep(
        step_id="step_dup",
        operation_type=OperationType.FILTER_ROWS,
        input_step_ids=["raw_input"],
    )
    s2 = TransformationStep(
        step_id="step_dup",
        operation_type=OperationType.FILTER_ROWS,
        input_step_ids=["raw_input"],
    )
    with pytest.raises(GraphValidationError, match="Duplicate step identifier"):
        DAGValidator.validate_and_order([s1, s2], registered_inputs=["raw_input"])


def test_empty_pipeline_rejected() -> None:
    """Test empty pipeline raises GraphValidationError."""
    with pytest.raises(GraphValidationError, match="at least one transformation step"):
        DAGValidator.validate_and_order([])


def test_operation_cardinality_validation() -> None:
    """Test input cardinality verification for single vs dual input operations."""
    # Join with only 1 input
    bad_join = TransformationStep(
        step_id="step_bad_join",
        operation_type=OperationType.JOIN_DATASETS,
        input_step_ids=["step_1"],
    )
    with pytest.raises(GraphValidationError, match="requires exactly 2 input dependencies"):
        DAGValidator.validate_and_order([bad_join], registered_inputs=["step_1"])

    # Filter with 2 inputs
    bad_filter = TransformationStep(
        step_id="step_bad_filter",
        operation_type=OperationType.FILTER_ROWS,
        input_step_ids=["step_1", "step_2"],
    )
    with pytest.raises(GraphValidationError, match="requires exactly 1 input dependency"):
        DAGValidator.validate_and_order([bad_filter], registered_inputs=["step_1", "step_2"])


def test_descendants_blast_radius_computation(diamond_dag_steps: list[TransformationStep]) -> None:
    """Test blast radius / descendant traversal on diamond graph."""
    # Descendants of source: left, right, join
    desc_source = DAGValidator.get_descendants("step_source", diamond_dag_steps)
    assert desc_source == {"step_left", "step_right", "step_join"}

    # Descendants of left: join
    desc_left = DAGValidator.get_descendants("step_left", diamond_dag_steps)
    assert desc_left == {"step_join"}

    # Descendants of terminal join: empty
    desc_join = DAGValidator.get_descendants("step_join", diamond_dag_steps)
    assert desc_join == set()
