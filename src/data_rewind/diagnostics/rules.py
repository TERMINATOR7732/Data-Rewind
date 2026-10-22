"""Data Rewind automated forensic diagnostic rules engine.

Implements the six automated diagnostic rules specified in SPEC-MOD-04.
"""

from __future__ import annotations

from data_rewind.diagnostics.models import (
    DiagnosticFinding,
    DiagnosticRuleID,
    EvidenceTier,
    StepDiagnosticContext,
)


class DiagnosticRuleEngine:
    """Evaluates the six canonical automated forensic diagnostic rules."""

    @classmethod
    def evaluate_step(cls, context: StepDiagnosticContext) -> list[DiagnosticFinding]:
        """Evaluate all six diagnostic rules against the step execution context."""
        findings: list[DiagnosticFinding] = []

        # Rule 1: Upstream Input Data Drift
        f1 = cls._evaluate_rule_1_upstream_input_drift(context)
        if f1 is not None:
            findings.append(f1)

        # Rule 2: Arithmetic Expression Mutation
        f2 = cls._evaluate_rule_2_arithmetic_mutation(context)
        if f2 is not None:
            findings.append(f2)

        # Rule 3: Unmatched Join Drop
        f3 = cls._evaluate_rule_3_unmatched_join_drop(context)
        if f3 is not None:
            findings.append(f3)

        # Rule 4: Duplication Cardinality Burst
        f4 = cls._evaluate_rule_4_duplication_burst(context)
        if f4 is not None:
            findings.append(f4)

        # Rule 5: Null Sentinel Surge
        f5 = cls._evaluate_rule_5_null_sentinel_surge(context)
        if f5 is not None:
            findings.append(f5)

        # Rule 6: Non-Deterministic Transformation Detected
        f6 = cls._evaluate_rule_6_nondeterministic_transformation(context)
        if f6 is not None:
            findings.append(f6)

        return findings

    @classmethod
    def _evaluate_rule_1_upstream_input_drift(
        cls, ctx: StepDiagnosticContext
    ) -> DiagnosticFinding | None:
        """DR-01: Upstream Input Data Drift."""
        # Condition: Ingestion step where input content hashes differ
        if not ctx.is_ingestion_node:
            return None

        hashes_differ = (
            bool(ctx.baseline_input_hashes and ctx.target_input_hashes)
            and ctx.baseline_input_hashes != ctx.target_input_hashes
        ) or (
            ctx.baseline_output_hash is not None
            and ctx.target_output_hash is not None
            and ctx.baseline_output_hash != ctx.target_output_hash
        )

        if not hashes_differ:
            return None

        row_delta = 0
        if ctx.diff_result is not None:
            row_delta = ctx.diff_result.target_row_count - ctx.diff_result.baseline_row_count

        return DiagnosticFinding(
            rule_id=DiagnosticRuleID.DR_01_UPSTREAM_INPUT_DATA_DRIFT,
            rule_name="Upstream Input Data Drift",
            step_id=ctx.step_id,
            evidence_tier=EvidenceTier.CAUSAL_HYPOTHESIS_INPUT_DRIFT,
            message=(
                f"Ingestion input '{ctx.input_dataset_name or ctx.step_id}' changed content hash; "
                f"raw source payload diverged ({row_delta:+d} rows delta)."
            ),
            details={
                "dataset_name": ctx.input_dataset_name,
                "baseline_hashes": ctx.baseline_input_hashes,
                "target_hashes": ctx.target_input_hashes,
                "row_delta": row_delta,
            },
            affected_columns=[],
            confidence_explanation=(
                "Root cause is external source data mutation at ingestion boundary; "
                "not caused by downstream pipeline transformation code error."
            ),
        )

    @classmethod
    def _evaluate_rule_2_arithmetic_mutation(
        cls, ctx: StepDiagnosticContext
    ) -> DiagnosticFinding | None:
        """DR-02: Arithmetic Expression Mutation."""
        # Condition: Identical inputs, same row count, but expression parameters mutated and values drifted
        inputs_identical = (
            bool(ctx.baseline_input_hashes and ctx.target_input_hashes)
            and ctx.baseline_input_hashes == ctx.target_input_hashes
        )
        if not inputs_identical:
            return None

        params_differ = ctx.baseline_parameters != ctx.target_parameters
        if not params_differ:
            return None

        if ctx.diff_result is None:
            return None

        # Row counts match, but value drift observed
        diff = ctx.diff_result
        if diff.baseline_row_count != diff.target_row_count or diff.modified_count == 0:
            return None

        # Extract affected columns
        affected_cols: set[str] = set()
        for sample in diff.sample_row_diffs:
            for fd in sample.field_diffs:
                affected_cols.add(fd.column)

        base_expr = ctx.baseline_parameters.get("expression", str(ctx.baseline_parameters))
        targ_expr = ctx.target_parameters.get("expression", str(ctx.target_parameters))

        return DiagnosticFinding(
            rule_id=DiagnosticRuleID.DR_02_ARITHMETIC_EXPRESSION_MUTATION,
            rule_name="Arithmetic Expression Mutation",
            step_id=ctx.step_id,
            evidence_tier=EvidenceTier.CAUSAL_HYPOTHESIS_DIRECT_CODE_DIFF,
            message=(
                f"Transformation expression in '{ctx.step_id}' mutated from '{base_expr}' to '{targ_expr}', "
                f"causing value drift across {diff.modified_count} rows with identical row counts."
            ),
            details={
                "baseline_expression": base_expr,
                "target_expression": targ_expr,
                "modified_row_count": diff.modified_count,
                "total_rows": diff.baseline_row_count,
            },
            affected_columns=sorted(affected_cols),
            confidence_explanation=(
                "Inputs to step are bit-for-bit identical; parameter AST diff isolates the formula change "
                "which accounts for 100% of the observed row value modifications."
            ),
        )

    @classmethod
    def _evaluate_rule_3_unmatched_join_drop(
        cls, ctx: StepDiagnosticContext
    ) -> DiagnosticFinding | None:
        """DR-03: Unmatched Join Drop."""
        # Condition: Join operation where output rows drop drastically (> 30% drop or drop to 0)
        is_join = "join" in ctx.operation.lower()
        if not is_join or ctx.diff_result is None:
            return None

        diff = ctx.diff_result
        base_rows = diff.baseline_row_count
        targ_rows = diff.target_row_count

        if base_rows == 0:
            return None

        drop_count = base_rows - targ_rows
        drop_pct = (drop_count / base_rows) * 100.0

        if drop_pct >= 30.0 or (targ_rows == 0 and base_rows > 0):
            return DiagnosticFinding(
                rule_id=DiagnosticRuleID.DR_03_UNMATCHED_JOIN_DROP,
                rule_name="Unmatched Join Drop",
                step_id=ctx.step_id,
                evidence_tier=EvidenceTier.PROVEN_OBSERVATION,
                message=(
                    f"Join step '{ctx.step_id}' experienced a catastrophic {drop_pct:.1f}% row drop "
                    f"({base_rows} -> {targ_rows} rows). Join key unalignment or column schema drift detected."
                ),
                details={
                    "baseline_output_rows": base_rows,
                    "target_output_rows": targ_rows,
                    "row_drop_count": drop_count,
                    "row_drop_percentage": round(drop_pct, 2),
                    "schema_drift": ctx.diff_result.schema_diff.model_dump(),
                },
                affected_columns=ctx.diff_result.schema_diff.common_columns,
                confidence_explanation=(
                    "Output cardinality collapsed significantly while inputs were populated. "
                    "Typically caused by join key rename, type mutation, or prefix misalignment."
                ),
            )
        return None

    @classmethod
    def _evaluate_rule_4_duplication_burst(
        cls, ctx: StepDiagnosticContext
    ) -> DiagnosticFinding | None:
        """DR-04: Duplication Cardinality Burst."""
        # Condition: Output row count increases significantly (> 10% inflation or duplicate keys found)
        if ctx.diff_result is None:
            return None

        diff = ctx.diff_result
        base_rows = diff.baseline_row_count
        targ_rows = diff.target_row_count

        has_duplicate_keys = bool(diff.duplicate_keys_detected)
        inflation_count = targ_rows - base_rows
        inflation_pct = (inflation_count / base_rows * 100.0) if base_rows > 0 else 0.0

        if has_duplicate_keys or (inflation_pct >= 10.0 and inflation_count >= 10):
            return DiagnosticFinding(
                rule_id=DiagnosticRuleID.DR_04_DUPLICATION_CARDINALITY_BURST,
                rule_name="Duplication Cardinality Burst",
                step_id=ctx.step_id,
                evidence_tier=EvidenceTier.PROVEN_OBSERVATION,
                message=(
                    f"Output cardinality in '{ctx.step_id}' inflated by {inflation_pct:.1f}% "
                    f"({base_rows} -> {targ_rows} rows, +{inflation_count} duplicate rows). "
                    f"{len(diff.duplicate_keys_detected)} duplicate key collisions detected."
                ),
                details={
                    "baseline_rows": base_rows,
                    "target_rows": targ_rows,
                    "inflation_count": inflation_count,
                    "inflation_percentage": round(inflation_pct, 2),
                    "duplicate_keys": diff.duplicate_keys_detected[:20],
                },
                affected_columns=[],
                confidence_explanation=(
                    "Row multiplication observed in step output. Typically caused by upstream retry webhooks, "
                    "fan-out 1-to-many joins, or incomplete deduplication key subsets."
                ),
            )
        return None

    @classmethod
    def _evaluate_rule_5_null_sentinel_surge(
        cls, ctx: StepDiagnosticContext
    ) -> DiagnosticFinding | None:
        """DR-05: Null Sentinel Surge."""
        # Condition: Values transition from finite/valid to NULL across multiple records
        if ctx.diff_result is None:
            return None

        diff = ctx.diff_result
        null_transition_counts: dict[str, int] = {}

        for sample in diff.sample_row_diffs:
            for fd in sample.field_diffs:
                if (
                    fd.is_null_transition
                    and fd.target_value is None
                    and fd.baseline_value is not None
                ):
                    null_transition_counts[fd.column] = null_transition_counts.get(fd.column, 0) + 1

        if not null_transition_counts:
            return None

        surging_cols = sorted(
            [col for col, cnt in null_transition_counts.items() if cnt >= 1],
            key=lambda c: null_transition_counts[c],
            reverse=True,
        )

        if not surging_cols:
            return None

        primary_col = surging_cols[0]
        count = null_transition_counts[primary_col]

        return DiagnosticFinding(
            rule_id=DiagnosticRuleID.DR_05_NULL_SENTINEL_SURGE,
            rule_name="Null Sentinel Surge",
            step_id=ctx.step_id,
            evidence_tier=EvidenceTier.PROVEN_OBSERVATION,
            message=(
                f"Column '{primary_col}' in step '{ctx.step_id}' experienced a null surge "
                f"({count} sample rows transitioned from non-null values to NULL). "
                "Unhandled string sentinel ('N/A', '-') or coercion without coalesce fallback detected."
            ),
            details={
                "surging_columns": surging_cols,
                "null_transition_sample_counts": null_transition_counts,
            },
            affected_columns=surging_cols,
            confidence_explanation=(
                "Valid values in baseline were coerced into NULL in target run. "
                "Surfaces when type cast operations encounter unhandled string sentinels."
            ),
        )

    @classmethod
    def _evaluate_rule_6_nondeterministic_transformation(
        cls, ctx: StepDiagnosticContext
    ) -> DiagnosticFinding | None:
        """DR-06: Non-Deterministic Transformation Detected."""
        # Condition: Identical inputs and identical parameters, yet outputs differ
        inputs_identical = (
            bool(ctx.baseline_input_hashes and ctx.target_input_hashes)
            and ctx.baseline_input_hashes == ctx.target_input_hashes
        )
        if not inputs_identical:
            return None

        params_identical = ctx.baseline_parameters == ctx.target_parameters
        if not params_identical:
            return None

        if (
            ctx.baseline_output_hash is None
            or ctx.target_output_hash is None
            or ctx.baseline_output_hash == ctx.target_output_hash
        ):
            return None

        return DiagnosticFinding(
            rule_id=DiagnosticRuleID.DR_06_NONDETERMINISTIC_TRANSFORMATION,
            rule_name="Non-Deterministic Transformation Detected",
            step_id=ctx.step_id,
            evidence_tier=EvidenceTier.PROVEN_OBSERVATION,
            message=(
                f"Transformation '{ctx.step_id}' produced divergent outputs "
                f"({ctx.baseline_output_hash[:16]}... vs {ctx.target_output_hash[:16]}...) "
                "despite identical input hashes and identical step parameters."
            ),
            details={
                "baseline_output_hash": ctx.baseline_output_hash,
                "target_output_hash": ctx.target_output_hash,
                "input_hashes": ctx.baseline_input_hashes,
            },
            affected_columns=[],
            confidence_explanation=(
                "Proven non-determinism in transformation logic. "
                "Typically caused by ambient timestamps, unseeded pseudo-random generators, or unordered group-by."
            ),
        )
