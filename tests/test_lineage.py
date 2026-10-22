"""Tests for Lineage Traversal, Downstream Taint Tracking, and Blast Radius calculation.

Conforms to Section 2 of SPEC-MOD-03 and Section 2.1 of SPEC-MOD-04.
"""

from __future__ import annotations

import pytest

from data_rewind.core.domain.models import OperationType, TransformationStep
from data_rewind.lineage.engine import LineageEngine
from data_rewind.lineage.models import TaintStatus


@pytest.fixture
def sample_dag_steps() -> list[TransformationStep]:
    r"""Create a diamond + branch DAG:
    ingest (input)
       |
     clean
     /   \
    f1    f2 (masked)
    |     |
    m1    m2
     \   /
      join
       |
     publish
    """
    return [
        TransformationStep(
            step_id="step_clean",
            operation_type=OperationType.FILTER_ROWS,
            input_step_ids=["raw_input"],
            parameters={"predicate": "id > 0"},
        ),
        TransformationStep(
            step_id="step_f1",
            operation_type=OperationType.DERIVE_COLUMN,
            input_step_ids=["step_clean"],
            parameters={"target_column": "x", "expression": "id * 2"},
        ),
        TransformationStep(
            step_id="step_f2",
            operation_type=OperationType.FILTER_ROWS,
            input_step_ids=["step_clean"],
            parameters={"predicate": "id > 100"},
        ),
        TransformationStep(
            step_id="step_m1",
            operation_type=OperationType.AGGREGATE_GROUP_BY,
            input_step_ids=["step_f1"],
            parameters={"group_by_columns": ["x"], "aggregations": {"c": "count(*)"}},
        ),
        TransformationStep(
            step_id="step_m2",
            operation_type=OperationType.AGGREGATE_GROUP_BY,
            input_step_ids=["step_f2"],
            parameters={"group_by_columns": ["id"], "aggregations": {"c": "count(*)"}},
        ),
        TransformationStep(
            step_id="step_join",
            operation_type=OperationType.JOIN_DATASETS,
            input_step_ids=["step_m1", "step_m2"],
            parameters={"join_type": "inner", "join_keys": ["c"]},
        ),
        TransformationStep(
            step_id="step_publish",
            operation_type=OperationType.FILTER_ROWS,
            input_step_ids=["step_join"],
            parameters={"predicate": "c > 0"},
        ),
        TransformationStep(
            step_id="step_independent",
            operation_type=OperationType.FILTER_ROWS,
            input_step_ids=["other_input"],
            parameters={"predicate": "val > 0"},
        ),
    ]


def test_build_adjacency(sample_dag_steps: list[TransformationStep]) -> None:
    forward, backward, steps_map = LineageEngine.build_adjacency(sample_dag_steps)

    assert "step_f1" in forward["step_clean"]
    assert "step_f2" in forward["step_clean"]
    assert backward["step_f1"] == ["step_clean"]
    assert sorted(backward["step_join"]) == ["step_m1", "step_m2"]
    assert forward["step_publish"] == []
    assert len(steps_map) == len(sample_dag_steps)


def test_find_descendants(sample_dag_steps: list[TransformationStep]) -> None:
    forward, _, _ = LineageEngine.build_adjacency(sample_dag_steps)

    descendants = LineageEngine.find_descendants(forward, ["step_f1"])
    assert "step_m1" in descendants
    assert "step_join" in descendants
    assert "step_publish" in descendants
    assert "step_f2" not in descendants
    assert "step_m2" not in descendants
    assert "step_independent" not in descendants


def test_blast_radius_and_taint_classification(sample_dag_steps: list[TransformationStep]) -> None:
    # Origin divergence at step_clean
    origin_ids = ["step_clean"]

    # Baseline and target hashes:
    # step_clean diverged (origin)
    # step_f1 diverged
    # step_f2 has IDENTICAL hashes (masked descendant)
    # step_m1 diverged
    # step_m2 has IDENTICAL hashes (masked)
    # step_join diverged
    # step_publish diverged
    # step_independent is clean outside blast radius
    baseline_hashes = {
        "step_clean": "hash_clean_base",
        "step_f1": "hash_f1_base",
        "step_f2": "hash_f2_same",
        "step_m1": "hash_m1_base",
        "step_m2": "hash_m2_same",
        "step_join": "hash_join_base",
        "step_publish": "hash_pub_base",
        "step_independent": "hash_indep_base",
    }
    target_hashes = {
        "step_clean": "hash_clean_target",
        "step_f1": "hash_f1_target",
        "step_f2": "hash_f2_same",  # Masked!
        "step_m1": "hash_m1_target",
        "step_m2": "hash_m2_same",  # Masked!
        "step_join": "hash_join_target",
        "step_publish": "hash_pub_target",
        "step_independent": "hash_indep_base",
    }

    report = LineageEngine.compute_downstream_blast_radius(
        steps=sample_dag_steps,
        origin_step_ids=origin_ids,
        baseline_hashes=baseline_hashes,
        target_hashes=target_hashes,
    )

    assert report.total_nodes_count == 8
    # Tainted: step_clean (origin) + step_f1 + step_f2 + step_m1 + step_m2 + step_join + step_publish = 7
    assert report.tainted_nodes_count == 7
    # Confirmed affected: clean (origin) + f1 + m1 + join + publish = 5
    assert report.confirmed_affected_count == 5
    # Masked: f2, m2 = 2
    assert report.masked_count == 2
    # Untainted: independent = 1
    assert report.untainted_count == 1

    # Ratios
    assert report.blast_radius_ratio == pytest.approx(7 / 8, abs=1e-3)
    assert report.confirmed_divergence_ratio == pytest.approx(5 / 8, abs=1e-3)

    # Node status assertions
    assert report.nodes["step_clean"].taint_status == TaintStatus.CONFIRMED_AFFECTED
    assert report.nodes["step_clean"].is_origin is True

    assert report.nodes["step_f1"].taint_status == TaintStatus.CONFIRMED_AFFECTED
    assert report.nodes["step_f2"].taint_status == TaintStatus.MASKED_UNAFFECTED
    assert "masked" in report.nodes["step_f2"].explanation.lower()

    assert report.nodes["step_independent"].taint_status == TaintStatus.UNTAINTED

    # Terminal sinks: step_publish and step_independent have no successors
    # step_publish is in blast radius
    assert "step_publish" in report.affected_terminal_sinks
    assert "step_independent" not in report.affected_terminal_sinks


def test_unmaterialized_checkpoint_is_potentially_affected(
    sample_dag_steps: list[TransformationStep],
) -> None:
    # If target hash is missing, status is POTENTIALLY_AFFECTED
    baseline_hashes = {"step_clean": "b1", "step_f1": "b2"}
    target_hashes = {"step_clean": "t1"}  # step_f1 omitted

    report = LineageEngine.compute_downstream_blast_radius(
        steps=sample_dag_steps,
        origin_step_ids=["step_clean"],
        baseline_hashes=baseline_hashes,
        target_hashes=target_hashes,
    )

    assert report.nodes["step_f1"].taint_status == TaintStatus.POTENTIALLY_AFFECTED


def test_path_tracing(sample_dag_steps: list[TransformationStep]) -> None:
    # Upstream paths to step_join
    upstream_paths = LineageEngine.trace_upstream_paths(sample_dag_steps, "step_join")
    assert len(upstream_paths) == 2
    assert ["step_clean", "step_f1", "step_m1", "step_join"] in upstream_paths
    assert ["step_clean", "step_f2", "step_m2", "step_join"] in upstream_paths

    # Downstream paths from step_clean
    downstream_paths = LineageEngine.trace_downstream_paths(sample_dag_steps, "step_clean")
    assert len(downstream_paths) == 2
    assert ["step_clean", "step_f1", "step_m1", "step_join", "step_publish"] in downstream_paths
    assert ["step_clean", "step_f2", "step_m2", "step_join", "step_publish"] in downstream_paths
