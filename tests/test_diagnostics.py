"""Comprehensive test suite for Data Rewind Diagnostics and Earliest Observable Divergence (EOD) Engine.

Conforms strictly to Section 2 of SPEC-MOD-04 and Section 4 of SPEC-MOD-01.
"""

from __future__ import annotations

import duckdb

from data_rewind.comparator.engine import TabularComparator
from data_rewind.comparator.models import (
    ComparisonConfig,
    DatasetFingerprint,
    DiffCategory,
    RowDiff,
    SchemaDiff,
    TabularDiffResult,
    ValueDiff,
)
from data_rewind.diagnostics.eod import EODDetector
from data_rewind.diagnostics.models import (
    DiagnosticRuleID,
    EODStatus,
    EvidenceTier,
    StepDiagnosticContext,
)
from data_rewind.diagnostics.rules import DiagnosticRuleEngine


def _make_dummy_fingerprint(row_count: int) -> DatasetFingerprint:
    return DatasetFingerprint(
        schema_hash="0" * 64,
        multiset_hash="1" * 64,
        row_count=row_count,
        fingerprint_hash="2" * 64,
    )


# ---------------------------------------------------------------------------
# Diagnostic Rule DR-01: Upstream Input Data Drift
# ---------------------------------------------------------------------------
def test_dr_01_upstream_input_data_drift() -> None:
    ctx = StepDiagnosticContext(
        step_id="step_1_cleanse",
        operation="INGEST",
        is_ingestion_node=True,
        input_dataset_name="customers.csv",
        baseline_input_hashes=["aaaa" * 16],
        target_input_hashes=["bbbb" * 16],  # Hash changed
        baseline_parameters={"format": "csv"},
        target_parameters={"format": "csv"},
        baseline_output_hash="cccc" * 16,
        target_output_hash="dddd" * 16,
    )
    findings = DiagnosticRuleEngine.evaluate_step(ctx)

    dr01 = next(
        (f for f in findings if f.rule_id == DiagnosticRuleID.DR_01_UPSTREAM_INPUT_DATA_DRIFT), None
    )
    assert dr01 is not None
    assert dr01.evidence_tier == EvidenceTier.CAUSAL_HYPOTHESIS_INPUT_DRIFT
    assert "customers.csv" in dr01.message


# ---------------------------------------------------------------------------
# Diagnostic Rule DR-02: Arithmetic Expression Mutation
# ---------------------------------------------------------------------------
def test_dr_02_arithmetic_expression_mutation() -> None:
    fp = _make_dummy_fingerprint(100)
    diff = TabularDiffResult(
        is_equal=False,
        case_classifications=[],
        schema_diff=SchemaDiff(common_columns=["score"]),
        baseline_fingerprint=fp,
        target_fingerprint=fp,
        identical_count=80,
        modified_count=20,
        added_count=0,
        removed_count=0,
        baseline_row_count=100,
        target_row_count=100,
        sample_row_diffs=[
            RowDiff(
                category=DiffCategory.MODIFIED,
                field_diffs=[ValueDiff(column="score", baseline_value=10.0, target_value=20.0)],
            )
        ],
    )

    ctx = StepDiagnosticContext(
        step_id="step_2_tax",
        operation="CALCULATE",
        baseline_input_hashes=["aaaa" * 16],
        target_input_hashes=["aaaa" * 16],  # Inputs identical
        baseline_parameters={"expression": "gross_amount * 0.18"},
        target_parameters={"expression": "gross_amount * 0.05"},  # Formula changed
        baseline_output_hash="1111" * 16,
        target_output_hash="2222" * 16,
        diff_result=diff,
    )
    findings = DiagnosticRuleEngine.evaluate_step(ctx)

    dr02 = next(
        (f for f in findings if f.rule_id == DiagnosticRuleID.DR_02_ARITHMETIC_EXPRESSION_MUTATION),
        None,
    )
    assert dr02 is not None
    assert dr02.evidence_tier == EvidenceTier.CAUSAL_HYPOTHESIS_DIRECT_CODE_DIFF
    assert "gross_amount * 0.18" in dr02.message
    assert "gross_amount * 0.05" in dr02.message
    assert "score" in dr02.affected_columns


# ---------------------------------------------------------------------------
# Diagnostic Rule DR-03: Unmatched Join Drop
# ---------------------------------------------------------------------------
def test_dr_03_unmatched_join_drop() -> None:
    fp = _make_dummy_fingerprint(10_000)
    diff = TabularDiffResult(
        is_equal=False,
        case_classifications=[],
        schema_diff=SchemaDiff(common_columns=["id", "val"]),
        baseline_fingerprint=fp,
        target_fingerprint=fp,
        identical_count=6_000,
        modified_count=0,
        added_count=0,
        removed_count=4_000,
        baseline_row_count=10_000,
        target_row_count=6_000,  # 40% drop
    )

    ctx = StepDiagnosticContext(
        step_id="step_3_join",
        operation="INNER_JOIN",
        baseline_output_hash="aaaa" * 16,
        target_output_hash="bbbb" * 16,
        diff_result=diff,
    )
    findings = DiagnosticRuleEngine.evaluate_step(ctx)

    dr03 = next(
        (f for f in findings if f.rule_id == DiagnosticRuleID.DR_03_UNMATCHED_JOIN_DROP), None
    )
    assert dr03 is not None
    assert dr03.evidence_tier == EvidenceTier.PROVEN_OBSERVATION
    assert "40.0%" in dr03.message


# ---------------------------------------------------------------------------
# Diagnostic Rule DR-04: Duplication / Cardinality Burst
# ---------------------------------------------------------------------------
def test_dr_04_cardinality_burst() -> None:
    fp = _make_dummy_fingerprint(1_000)
    diff = TabularDiffResult(
        is_equal=False,
        case_classifications=[],
        schema_diff=SchemaDiff(),
        baseline_fingerprint=fp,
        target_fingerprint=fp,
        identical_count=1_000,
        modified_count=0,
        added_count=2_000,
        removed_count=0,
        baseline_row_count=1_000,
        target_row_count=3_000,  # 200% inflation
        duplicate_keys_detected=[101, 102],
    )

    ctx = StepDiagnosticContext(
        step_id="step_4_expand",
        operation="JOIN",
        baseline_output_hash="aaaa" * 16,
        target_output_hash="bbbb" * 16,
        diff_result=diff,
    )
    findings = DiagnosticRuleEngine.evaluate_step(ctx)

    dr04 = next(
        (f for f in findings if f.rule_id == DiagnosticRuleID.DR_04_DUPLICATION_CARDINALITY_BURST),
        None,
    )
    assert dr04 is not None
    assert dr04.evidence_tier == EvidenceTier.PROVEN_OBSERVATION
    assert "200.0%" in dr04.message


# ---------------------------------------------------------------------------
# Diagnostic Rule DR-05: Null / Sentinel Surge
# ---------------------------------------------------------------------------
def test_dr_05_null_sentinel_surge() -> None:
    fp = _make_dummy_fingerprint(100)
    sample_diffs = [
        RowDiff(
            category=DiffCategory.MODIFIED,
            field_diffs=[
                ValueDiff(
                    column="postal_code",
                    baseline_value="90210",
                    target_value=None,
                    is_null_transition=True,
                )
            ],
        )
    ]

    diff = TabularDiffResult(
        is_equal=False,
        case_classifications=[],
        schema_diff=SchemaDiff(common_columns=["postal_code"]),
        baseline_fingerprint=fp,
        target_fingerprint=fp,
        identical_count=99,
        modified_count=1,
        added_count=0,
        removed_count=0,
        baseline_row_count=100,
        target_row_count=100,
        sample_row_diffs=sample_diffs,
    )

    ctx = StepDiagnosticContext(
        step_id="step_5_nulls",
        operation="CLEANSE",
        baseline_output_hash="aaaa" * 16,
        target_output_hash="bbbb" * 16,
        diff_result=diff,
    )
    findings = DiagnosticRuleEngine.evaluate_step(ctx)

    dr05 = next(
        (f for f in findings if f.rule_id == DiagnosticRuleID.DR_05_NULL_SENTINEL_SURGE), None
    )
    assert dr05 is not None
    assert dr05.evidence_tier == EvidenceTier.PROVEN_OBSERVATION
    assert "postal_code" in dr05.affected_columns


# ---------------------------------------------------------------------------
# Diagnostic Rule DR-06: Non-Deterministic Transformation
# ---------------------------------------------------------------------------
def test_dr_06_nondeterministic_transformation() -> None:
    ctx = StepDiagnosticContext(
        step_id="step_6_random",
        operation="SAMPLE",
        baseline_input_hashes=["aaaa" * 16],
        target_input_hashes=["aaaa" * 16],  # Identical inputs
        baseline_parameters={"rate": 0.8},
        target_parameters={"rate": 0.8},  # Identical parameters
        baseline_output_hash="1111" * 16,
        target_output_hash="2222" * 16,  # Different outputs!
    )
    findings = DiagnosticRuleEngine.evaluate_step(ctx)

    dr06 = next(
        (
            f
            for f in findings
            if f.rule_id == DiagnosticRuleID.DR_06_NONDETERMINISTIC_TRANSFORMATION
        ),
        None,
    )
    assert dr06 is not None
    assert dr06.evidence_tier == EvidenceTier.PROVEN_OBSERVATION
    assert "divergent outputs" in dr06.message


# ---------------------------------------------------------------------------
# EOD Detection: Standard Topological Earliest Divergence
# ---------------------------------------------------------------------------
def test_eod_topological_detection() -> None:
    # DAG: A -> B -> C
    # A matches, B diverges, C diverges
    topo = ["A", "B", "C"]
    deps = {"B": ["A"], "C": ["B"]}

    ctx_a = StepDiagnosticContext(
        step_id="A", operation="INGEST", baseline_output_hash="1111", target_output_hash="1111"
    )
    ctx_b = StepDiagnosticContext(
        step_id="B", operation="TRANSFORM", baseline_output_hash="2222", target_output_hash="9999"
    )
    ctx_c = StepDiagnosticContext(
        step_id="C", operation="EXPORT", baseline_output_hash="3333", target_output_hash="8888"
    )

    res = EODDetector.detect_eod(
        topological_order=topo,
        step_contexts={"A": ctx_a, "B": ctx_b, "C": ctx_c},
        step_dependencies=deps,
    )

    assert res.status == EODStatus.EXACT_EOD
    assert res.primary_eod_step == "B"
    assert res.divergent_step_ids == ["B"]


# ---------------------------------------------------------------------------
# EOD Edge Case 1: Missing Intermediate Checkpoints (Coarse Grained)
# ---------------------------------------------------------------------------
def test_eod_missing_intermediate_checkpoints() -> None:
    topo = ["A", "B", "C"]
    ctx_c = StepDiagnosticContext(
        step_id="C", operation="EXPORT", baseline_output_hash="3333", target_output_hash="8888"
    )

    res = EODDetector.detect_eod(
        topological_order=topo,
        step_contexts={"C": ctx_c},
        terminal_step_ids=["C"],
        has_unmaterialized_intermediates=True,
    )

    assert res.status == EODStatus.COARSE_GRAINED_EOD
    assert res.primary_eod_step == "C"
    assert res.is_coarse_grained
    assert "Intermediates not materialized" in res.summary


# ---------------------------------------------------------------------------
# EOD Edge Case 2: Concurrent Divergence Points
# ---------------------------------------------------------------------------
def test_eod_concurrent_divergence_points() -> None:
    # Branch DAG:
    #      A
    #     / \
    #    B   C
    topo = ["A", "B", "C"]
    deps = {"B": ["A"], "C": ["A"]}

    ctx_a = StepDiagnosticContext(
        step_id="A", operation="INGEST", baseline_output_hash="1000", target_output_hash="1000"
    )
    ctx_b = StepDiagnosticContext(
        step_id="B", operation="TRANSFORM_1", baseline_output_hash="2000", target_output_hash="2999"
    )
    ctx_c = StepDiagnosticContext(
        step_id="C", operation="TRANSFORM_2", baseline_output_hash="3000", target_output_hash="3999"
    )

    res = EODDetector.detect_eod(
        topological_order=topo,
        step_contexts={"A": ctx_a, "B": ctx_b, "C": ctx_c},
        step_dependencies=deps,
    )

    assert res.status == EODStatus.CONCURRENT_DIVERGENCE_POINTS
    assert "B" in res.divergent_step_ids
    assert "C" in res.divergent_step_ids
    assert len(res.divergent_step_ids) == 2


# ---------------------------------------------------------------------------
# EOD Edge Case 3: Upstream Input Drift at Step 1
# ---------------------------------------------------------------------------
def test_eod_upstream_input_drift() -> None:
    topo = ["step_1_ingest", "step_2_calc"]
    deps = {"step_2_calc": ["step_1_ingest"]}

    ctx_1 = StepDiagnosticContext(
        step_id="step_1_ingest",
        operation="INGEST",
        is_ingestion_node=True,
        baseline_input_hashes=["1111"],
        target_input_hashes=["9999"],
        baseline_output_hash="1111",
        target_output_hash="9999",
    )
    ctx_2 = StepDiagnosticContext(
        step_id="step_2_calc",
        operation="TRANSFORM",
        baseline_output_hash="2222",
        target_output_hash="8888",
    )

    res = EODDetector.detect_eod(
        topological_order=topo,
        step_contexts={"step_1_ingest": ctx_1, "step_2_calc": ctx_2},
        step_dependencies=deps,
    )

    assert res.status == EODStatus.UPSTREAM_INPUT_DATA_DRIFT
    assert res.primary_eod_step == "step_1_ingest"
    assert "Upstream input file changed content hash" in res.summary


# ---------------------------------------------------------------------------
# EOD Edge Case: Identical Pipeline Executions
# ---------------------------------------------------------------------------
def test_eod_no_divergence() -> None:
    topo = ["A", "B", "C"]
    deps = {"B": ["A"], "C": ["B"]}

    ctx_a = StepDiagnosticContext(
        step_id="A", operation="INGEST", baseline_output_hash="1111", target_output_hash="1111"
    )
    ctx_b = StepDiagnosticContext(
        step_id="B", operation="TRANSFORM", baseline_output_hash="2222", target_output_hash="2222"
    )
    ctx_c = StepDiagnosticContext(
        step_id="C", operation="EXPORT", baseline_output_hash="3333", target_output_hash="3333"
    )

    res = EODDetector.detect_eod(
        topological_order=topo,
        step_contexts={"A": ctx_a, "B": ctx_b, "C": ctx_c},
        step_dependencies=deps,
    )

    assert res.status == EODStatus.NO_DIVERGENCE
    assert res.primary_eod_step is None
    assert len(res.divergent_step_ids) == 0


def test_eod_with_causal_code_mutation_tier() -> None:
    fp = _make_dummy_fingerprint(10)
    diff = TabularDiffResult(
        is_equal=False,
        case_classifications=[],
        schema_diff=SchemaDiff(common_columns=["val"]),
        baseline_fingerprint=fp,
        target_fingerprint=fp,
        identical_count=8,
        modified_count=2,
        added_count=0,
        removed_count=0,
        baseline_row_count=10,
        target_row_count=10,
        sample_row_diffs=[
            RowDiff(
                category=DiffCategory.MODIFIED,
                field_diffs=[ValueDiff(column="val", baseline_value=1, target_value=2)],
            )
        ],
    )
    ctx_a = StepDiagnosticContext(
        step_id="A", operation="INGEST", baseline_output_hash="1111", target_output_hash="1111"
    )
    ctx_b = StepDiagnosticContext(
        step_id="B",
        operation="TRANSFORM",
        baseline_input_hashes=["1111"],
        target_input_hashes=["1111"],
        baseline_parameters={"expression": "x * 2"},
        target_parameters={"expression": "x * 3"},
        baseline_output_hash="2222",
        target_output_hash="9999",
        diff_result=diff,
    )

    res = EODDetector.detect_eod(
        topological_order=["A", "B"],
        step_contexts={"A": ctx_a, "B": ctx_b},
        step_dependencies={"B": ["A"]},
    )

    assert res.status == EODStatus.EXACT_EOD
    assert res.primary_eod_step == "B"
    assert res.evidence_tier == EvidenceTier.CAUSAL_HYPOTHESIS_DIRECT_CODE_DIFF
    assert len(res.findings) >= 1


# ---------------------------------------------------------------------------
# Milestone 2.0.2 Regression Tests (P2-02, P2-03)
# ---------------------------------------------------------------------------
def test_dr_05_triggered_by_compare_tables_duckdb() -> None:
    """Verify DR-05 triggers on TabularDiffResult generated by DuckDB compare_tables (P2-02)."""
    conn = duckdb.connect(":memory:")
    conn.execute("CREATE TABLE b_table (id BIGINT, age INT)")
    conn.execute("CREATE TABLE t_table (id BIGINT, age INT)")

    # Insert 10 rows: 5 transition from valid age to NULL
    conn.execute(
        "INSERT INTO b_table VALUES (1, 20), (2, 25), (3, 30), (4, 35), (5, 40), (6, 45), (7, 50), (8, 55), (9, 60), (10, 65)"
    )
    conn.execute(
        "INSERT INTO t_table VALUES (1, NULL), (2, NULL), (3, NULL), (4, NULL), (5, NULL), (6, 45), (7, 50), (8, 55), (9, 60), (10, 65)"
    )

    diff = TabularComparator.compare_tables(
        conn, "b_table", "t_table", ComparisonConfig(primary_key=["id"])
    )
    assert diff.modified_count == 5
    assert len(diff.sample_row_diffs) == 5

    ctx = StepDiagnosticContext(
        step_id="cleanse_age",
        operation="TRANSFORM",
        diff_result=diff,
    )
    findings = DiagnosticRuleEngine.evaluate_step(ctx)
    dr05 = next(
        (f for f in findings if f.rule_id == DiagnosticRuleID.DR_05_NULL_SENTINEL_SURGE), None
    )

    assert dr05 is not None
    assert dr05.evidence_tier == EvidenceTier.PROVEN_OBSERVATION
    assert "age" in dr05.affected_columns
    assert "experienced a null surge" in dr05.message


def test_eod_with_omitted_step_dependencies_linear_dag() -> None:
    """Verify omitting step_dependencies infers linear DAG and identifies single EOD root (P2-03)."""
    topo = ["A", "B", "C"]
    ctx_a = StepDiagnosticContext(
        step_id="A", operation="INGEST", baseline_output_hash="1111", target_output_hash="1111"
    )
    ctx_b = StepDiagnosticContext(
        step_id="B", operation="TRANSFORM", baseline_output_hash="2222", target_output_hash="9999"
    )
    ctx_c = StepDiagnosticContext(
        step_id="C", operation="EXPORT", baseline_output_hash="3333", target_output_hash="8888"
    )

    # step_dependencies is intentionally omitted (None)
    res = EODDetector.detect_eod(
        topological_order=topo,
        step_contexts={"A": ctx_a, "B": ctx_b, "C": ctx_c},
        step_dependencies=None,
    )

    # Must NOT report CONCURRENT_DIVERGENCE_POINTS
    assert res.status == EODStatus.EXACT_EOD
    assert res.primary_eod_step == "B"
    assert res.divergent_step_ids == ["B"]
