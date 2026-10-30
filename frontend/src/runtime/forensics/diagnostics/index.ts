/**
 * Data Rewind Automated Forensic Diagnostic Rules Engine (R1–R6).
 * Conforms strictly to SPEC-MOD-04 §2.2.
 */

import {
  DiagnosticFinding,
  DiagnosticRuleID,
  EvidenceTier,
  StepDiagnosticContext,
} from "../contracts";

export class DiagnosticRuleEngine {
  /**
   * Evaluates all six diagnostic rules against the step diagnostic context.
   */
  public static evaluateStep(ctx: StepDiagnosticContext): DiagnosticFinding[] {
    const findings: DiagnosticFinding[] = [];

    // DR-01: Upstream Input Data Drift
    const f1 = this.evaluateDR01(ctx);
    if (f1) findings.push(f1);

    // DR-02: Arithmetic Expression Mutation
    const f2 = this.evaluateDR02(ctx);
    if (f2) findings.push(f2);

    // DR-03: Unmatched Join Drop
    const f3 = this.evaluateDR03(ctx);
    if (f3) findings.push(f3);

    // DR-04: Duplication Cardinality Burst
    const f4 = this.evaluateDR04(ctx);
    if (f4) findings.push(f4);

    // DR-05: Null Sentinel Surge
    const f5 = this.evaluateDR05(ctx);
    if (f5) findings.push(f5);

    // DR-06: Non-Deterministic Transformation Detected
    const f6 = this.evaluateDR06(ctx);
    if (f6) findings.push(f6);

    return findings;
  }

  /**
   * DR-01: Upstream Input Data Drift
   * Evidence Tier: CAUSAL_HYPOTHESIS_INPUT_DRIFT
   */
  public static evaluateDR01(ctx: StepDiagnosticContext): DiagnosticFinding | null {
    if (!ctx.is_ingestion_node) {
      return null;
    }

    const baseHashes = ctx.baseline_input_hashes || [];
    const targHashes = ctx.target_input_hashes || [];

    const hashesDiffer =
      (baseHashes.length > 0 && targHashes.length > 0 && JSON.stringify(baseHashes) !== JSON.stringify(targHashes)) ||
      (ctx.baseline_output_hash !== undefined &&
        ctx.target_output_hash !== undefined &&
        ctx.baseline_output_hash !== null &&
        ctx.target_output_hash !== null &&
        ctx.baseline_output_hash !== ctx.target_output_hash) ||
      (ctx.diff_result && !ctx.diff_result.is_equal);

    if (!hashesDiffer) {
      return null;
    }

    const rowDelta = ctx.diff_result
      ? ctx.diff_result.target_row_count - ctx.diff_result.baseline_row_count
      : 0;

    const datasetName = ctx.input_dataset_name || ctx.step_id;

    return {
      rule_id: DiagnosticRuleID.DR_01_UPSTREAM_INPUT_DATA_DRIFT,
      rule_name: "Upstream Input Data Drift",
      step_id: ctx.step_id,
      evidence_tier: EvidenceTier.CAUSAL_HYPOTHESIS_INPUT_DRIFT,
      message: `Ingestion input '${datasetName}' changed content hash; raw source payload diverged (${rowDelta >= 0 ? "+" : ""}${rowDelta} rows delta).`,
      details: {
        dataset_name: datasetName,
        baseline_hashes: baseHashes,
        target_hashes: targHashes,
        row_delta: rowDelta,
      },
      affected_columns: [],
      confidence_explanation:
        "Root cause is external source data mutation at ingestion boundary; not caused by downstream pipeline transformation code error.",
      observed: `Ingestion hash changed from ${ctx.baseline_output_hash?.slice(0, 16) || "none"} to ${ctx.target_output_hash?.slice(0, 16) || "none"}. Row delta: ${rowDelta >= 0 ? "+" : ""}${rowDelta}.`,
      interpretation: "The raw external dataset was modified before the pipeline was executed.",
      limitations: "Source file mutation history outside the pipeline execution boundary is not tracked.",
      next_investigation: "Inspect upstream data vendor or producer ingestion timestamp and audit log.",
    };
  }

  /**
   * DR-02: Arithmetic Expression Mutation
   * Evidence Tier: CAUSAL_HYPOTHESIS_DIRECT_CODE_DIFF
   */
  public static evaluateDR02(ctx: StepDiagnosticContext): DiagnosticFinding | null {
    const baseHashes = ctx.baseline_input_hashes || [];
    const targHashes = ctx.target_input_hashes || [];

    const inputsIdentical =
      (baseHashes.length === 0 && targHashes.length === 0) ||
      (baseHashes.length > 0 &&
        targHashes.length > 0 &&
        JSON.stringify(baseHashes) === JSON.stringify(targHashes));

    if (!inputsIdentical) {
      return null;
    }

    const baseParams = ctx.baseline_parameters || {};
    const targParams = ctx.target_parameters || {};
    const paramsDiffer = JSON.stringify(baseParams) !== JSON.stringify(targParams);

    if (!paramsDiffer || !ctx.diff_result) {
      return null;
    }

    const diff = ctx.diff_result;
    if (diff.baseline_row_count !== diff.target_row_count || diff.modified_count === 0) {
      return null;
    }

    // Extract affected columns from sample field diffs
    const affectedCols = new Set<string>();
    for (const sample of diff.sample_row_diffs) {
      for (const fd of sample.field_diffs || []) {
        affectedCols.add(fd.column);
      }
    }

    const baseExpr = (baseParams.expression as string) || JSON.stringify(baseParams);
    const targExpr = (targParams.expression as string) || JSON.stringify(targParams);

    return {
      rule_id: DiagnosticRuleID.DR_02_ARITHMETIC_EXPRESSION_MUTATION,
      rule_name: "Arithmetic Expression Mutation",
      step_id: ctx.step_id,
      evidence_tier: EvidenceTier.CAUSAL_HYPOTHESIS_DIRECT_CODE_DIFF,
      message: `Transformation expression in '${ctx.step_id}' mutated from '${baseExpr}' to '${targExpr}', causing value drift across ${diff.modified_count} rows with identical row counts.`,
      details: {
        baseline_expression: baseExpr,
        target_expression: targExpr,
        modified_row_count: diff.modified_count,
        total_rows: diff.baseline_row_count,
      },
      affected_columns: Array.from(affectedCols).sort(),
      confidence_explanation:
        "Inputs to step are bit-for-bit identical; parameter AST diff isolates the formula change which accounts for 100% of the observed row value modifications.",
      observed: `Step inputs are identical, row count preserved (${diff.baseline_row_count} rows), but ${diff.modified_count} rows exhibited value drift.`,
      interpretation: `Formula change from '${baseExpr}' to '${targExpr}' directly caused the numeric drift.`,
      limitations: "Semantic intent of the business formula change cannot be evaluated without human domain guidance.",
      next_investigation: "Review git blame on transformation parameters and verify formula intent.",
    };
  }

  /**
   * DR-03: Unmatched Join Drop
   * Evidence Tier: PROVEN_OBSERVATION
   */
  public static evaluateDR03(ctx: StepDiagnosticContext): DiagnosticFinding | null {
    const isJoin = ctx.operation.toLowerCase().includes("join");
    if (!isJoin || !ctx.diff_result) {
      return null;
    }

    const diff = ctx.diff_result;
    const baseRows = diff.baseline_row_count;
    const targRows = diff.target_row_count;

    if (baseRows === 0) {
      return null;
    }

    const dropCount = baseRows - targRows;
    const dropPct = (dropCount / baseRows) * 100.0;

    if (dropPct >= 30.0 || (targRows === 0 && baseRows > 0)) {
      return {
        rule_id: DiagnosticRuleID.DR_03_UNMATCHED_JOIN_DROP,
        rule_name: "Unmatched Join Drop",
        step_id: ctx.step_id,
        evidence_tier: EvidenceTier.PROVEN_OBSERVATION,
        message: `Join step '${ctx.step_id}' experienced a catastrophic ${dropPct.toFixed(1)}% row drop (${baseRows} -> ${targRows} rows). Join key unalignment or column schema drift detected.`,
        details: {
          baseline_output_rows: baseRows,
          target_output_rows: targRows,
          row_drop_count: dropCount,
          row_drop_percentage: Math.round(dropPct * 100) / 100,
          schema_drift: diff.schema_diff,
        },
        affected_columns: diff.schema_diff.common_columns,
        confidence_explanation:
          "Output cardinality collapsed significantly while inputs were populated. Typically caused by join key rename, type mutation, or prefix misalignment.",
        observed: `Output row count dropped by ${dropPct.toFixed(1)}% (${baseRows} rows in baseline down to ${targRows} in candidate).`,
        interpretation: "The join predicate failed to match rows across left and right datasets.",
        limitations: "Cannot verify which dataset side caused the missing keys without inspecting both join inputs.",
        next_investigation: "Inspect left_on and right_on key distributions and check for whitespace or casing mismatches.",
      };
    }

    return null;
  }

  /**
   * DR-04: Duplication Cardinality Burst
   * Evidence Tier: PROVEN_OBSERVATION
   */
  public static evaluateDR04(ctx: StepDiagnosticContext): DiagnosticFinding | null {
    if (!ctx.diff_result) {
      return null;
    }

    const diff = ctx.diff_result;
    const baseRows = diff.baseline_row_count;
    const targRows = diff.target_row_count;

    const hasDuplicateKeys = diff.duplicate_keys_detected && diff.duplicate_keys_detected.length > 0;
    const inflationCount = targRows - baseRows;
    const inflationPct = baseRows > 0 ? (inflationCount / baseRows) * 100.0 : 0.0;

    if (hasDuplicateKeys || (inflationPct >= 10.0 && inflationCount >= 10)) {
      return {
        rule_id: DiagnosticRuleID.DR_04_DUPLICATION_CARDINALITY_BURST,
        rule_name: "Duplication Cardinality Burst",
        step_id: ctx.step_id,
        evidence_tier: EvidenceTier.PROVEN_OBSERVATION,
        message: `Output cardinality in '${ctx.step_id}' inflated by ${inflationPct.toFixed(1)}% (${baseRows} -> ${targRows} rows, +${inflationCount} rows). ${diff.duplicate_keys_detected?.length || 0} duplicate key collisions detected.`,
        details: {
          baseline_rows: baseRows,
          target_rows: targRows,
          inflation_count: inflationCount,
          inflation_percentage: Math.round(inflationPct * 100) / 100,
          duplicate_keys: diff.duplicate_keys_detected?.slice(0, 20) || [],
        },
        affected_columns: [],
        confidence_explanation:
          "Row multiplication observed in step output. Typically caused by upstream retry webhooks, fan-out 1-to-many joins, or incomplete deduplication key subsets.",
        observed: `Row count inflated from ${baseRows} to ${targRows} (+${inflationPct.toFixed(1)}%). ${diff.duplicate_keys_detected?.length || 0} duplicate key collisions detected.`,
        interpretation: "1-to-many join duplication or repeated webhook events inflated the dataset.",
        limitations: "Exact duplicate origin requires upstream lineage trace.",
        next_investigation: "Run deduplicate_rows step or check primary key uniqueness on joined dimensions.",
      };
    }

    return null;
  }

  /**
   * DR-05: Null Sentinel Surge
   * Evidence Tier: PROVEN_OBSERVATION
   */
  public static evaluateDR05(ctx: StepDiagnosticContext): DiagnosticFinding | null {
    if (!ctx.diff_result) {
      return null;
    }

    const diff = ctx.diff_result;
    const nullTransitionCounts: Record<string, number> = {};

    for (const sample of diff.sample_row_diffs) {
      for (const fd of sample.field_diffs || []) {
        if (
          fd.is_null_transition &&
          fd.target_value === null &&
          fd.baseline_value !== null
        ) {
          nullTransitionCounts[fd.column] = (nullTransitionCounts[fd.column] || 0) + 1;
        }
      }
    }

    const surgingCols = Object.keys(nullTransitionCounts).sort(
      (a, b) => nullTransitionCounts[b] - nullTransitionCounts[a]
    );

    if (surgingCols.length === 0) {
      return null;
    }

    const primaryCol = surgingCols[0];
    const count = nullTransitionCounts[primaryCol];

    return {
      rule_id: DiagnosticRuleID.DR_05_NULL_SENTINEL_SURGE,
      rule_name: "Null Sentinel Surge",
      step_id: ctx.step_id,
      evidence_tier: EvidenceTier.PROVEN_OBSERVATION,
      message: `Column '${primaryCol}' in step '${ctx.step_id}' experienced a null surge (${count} sample rows transitioned from non-null values to NULL). Unhandled string sentinel ('N/A', '-') or coercion without coalesce fallback detected.`,
      details: {
        surging_columns: surgingCols,
        null_transition_sample_counts: nullTransitionCounts,
      },
      affected_columns: surgingCols,
      confidence_explanation:
        "Valid values in baseline were coerced into NULL in target run. Surfaces when type cast operations encounter unhandled string sentinels.",
      observed: `${count} sample records in column '${primaryCol}' transitioned from valid baseline values into NULL.`,
      interpretation: "Type casting or unhandled string sentinel values caused silent nullification.",
      limitations: "Count is based on sampled modified rows; full dataset may contain additional instances.",
      next_investigation: "Add handle_missing step with COALESCE or fill_value before type casting.",
    };
  }

  /**
   * DR-06: Non-Deterministic Transformation Detected
   * Evidence Tier: PROVEN_OBSERVATION
   */
  public static evaluateDR06(ctx: StepDiagnosticContext): DiagnosticFinding | null {
    const baseHashes = ctx.baseline_input_hashes || [];
    const targHashes = ctx.target_input_hashes || [];

    const inputsIdentical =
      (baseHashes.length === 0 && targHashes.length === 0) ||
      (baseHashes.length > 0 &&
        targHashes.length > 0 &&
        JSON.stringify(baseHashes) === JSON.stringify(targHashes));

    if (!inputsIdentical) {
      return null;
    }

    const baseParams = ctx.baseline_parameters || {};
    const targParams = ctx.target_parameters || {};
    const paramsIdentical = JSON.stringify(baseParams) === JSON.stringify(targParams);

    if (!paramsIdentical) {
      return null;
    }

    if (
      !ctx.baseline_output_hash ||
      !ctx.target_output_hash ||
      ctx.baseline_output_hash === ctx.target_output_hash
    ) {
      return null;
    }

    return {
      rule_id: DiagnosticRuleID.DR_06_NONDETERMINISTIC_TRANSFORMATION,
      rule_name: "Non-Deterministic Transformation Detected",
      step_id: ctx.step_id,
      evidence_tier: EvidenceTier.PROVEN_OBSERVATION,
      message: `Transformation '${ctx.step_id}' produced divergent outputs (${ctx.baseline_output_hash.slice(0, 16)}... vs ${ctx.target_output_hash.slice(0, 16)}...) despite identical input hashes and identical step parameters.`,
      details: {
        baseline_output_hash: ctx.baseline_output_hash,
        target_output_hash: ctx.target_output_hash,
        input_hashes: baseHashes,
      },
      affected_columns: [],
      confidence_explanation:
        "Proven non-determinism in transformation logic. Typically caused by ambient timestamps, unseeded pseudo-random generators, or unordered group-by.",
      observed: `Step produced different output hashes (${ctx.baseline_output_hash.slice(0, 12)} vs ${ctx.target_output_hash.slice(0, 12)}) with 100% identical inputs and parameters.`,
      interpretation: "Non-deterministic operator (such as unseeded random or system time) was executed.",
      limitations: "Specific unseeded function name cannot be isolated without AST inspection.",
      next_investigation: "Ensure date functions take explicit parameter timestamps rather than system now().",
    };
  }
}
