/**
 * Data Rewind — Structured Explainability Engine
 * Formulates clear, plain-language forensic explanations answering the Five Core Questions:
 * 1. What went wrong?
 * 2. Where did it go wrong?
 * 3. What is the evidence?
 * 4. Why does it matter?
 * 5. How can I fix and verify it?
 */

import {
  DiagnosticFinding,
  DiagnosticRuleID,
  EvidenceTier,
  StepDiagnosticContext,
  StructuredFinding,
  BlastRadiusReport,
  TabularDiffResult,
} from "../contracts";

export interface BuildStructuredFindingParams {
  finding?: DiagnosticFinding | null;
  ctx: StepDiagnosticContext;
  diff?: TabularDiffResult | null;
  blastRadius?: BlastRadiusReport | null;
  allStepIds?: string[];
}

export class StructuredExplainer {
  public static buildStructuredFinding(params: BuildStructuredFindingParams): StructuredFinding {
    const { finding, ctx, diff, blastRadius } = params;
    const stepId = ctx.step_id;
    const isIngestion = ctx.is_ingestion_node || stepId === "csv_ingest" || stepId.includes("ingest");
    const operation = ctx.operation && ctx.operation !== "TRANSFORMATION"
      ? ctx.operation
      : (isIngestion ? "CSV Data Ingestion" : "Pipeline Transformation");
    const datasetName = ctx.input_dataset_name || (isIngestion ? "Uploaded Source CSV" : "Pipeline Node Data");
    const diffRes = diff || ctx.diff_result;

    const baseRows = diffRes?.baseline_row_count ?? 0;
    const targRows = diffRes?.target_row_count ?? 0;
    const rowDelta = targRows - baseRows;
    const modifiedCount = diffRes?.modified_count ?? 0;
    const addedCount = diffRes?.added_count ?? 0;
    const removedCount = diffRes?.removed_count ?? 0;

    const affectedCols = finding?.affected_columns?.length
      ? finding.affected_columns
      : diffRes?.schema_diff?.added_columns?.concat(diffRes?.schema_diff?.removed_columns) || [];

    // Extract sample records
    const sampleRecords = (diffRes?.sample_row_diffs || []).slice(0, 5).map((sample) => {
      const diffCols = (sample.field_diffs || []).map((fd) => fd.column);
      return {
        key: (sample.key_values || sample._key_values || {}) as Record<string, unknown>,
        before: (sample.baseline_row || {}) as Record<string, unknown>,
        after: (sample.target_row || {}) as Record<string, unknown>,
        diff_columns: diffCols,
      };
    });

    const observedFacts: string[] = [];
    if (diffRes) {
      if (diffRes.is_equal) {
        observedFacts.push("Outputs are bit-for-bit identical across all columns.");
      } else {
        observedFacts.push(
          `Baseline produced ${baseRows} rows; target produced ${targRows} rows (${rowDelta >= 0 ? "+" : ""}${rowDelta} rows delta).`
        );
        if (modifiedCount > 0) {
          observedFacts.push(`${modifiedCount} rows had modified column values.`);
        }
        if (removedCount > 0) {
          observedFacts.push(`${removedCount} rows present in baseline were missing in target.`);
        }
        if (addedCount > 0) {
          observedFacts.push(`${addedCount} new rows were introduced in target.`);
        }
      }
    }
    if (ctx.baseline_output_hash && ctx.target_output_hash) {
      if (ctx.baseline_output_hash === ctx.target_output_hash) {
        observedFacts.push("Step output content hash verified identical.");
      } else {
        observedFacts.push(
          `Content hash diverged: baseline was ${ctx.baseline_output_hash.slice(0, 12)}..., candidate is ${ctx.target_output_hash.slice(0, 12)}...`
        );
      }
    }

    // Determine Downstream Impact & Blast Radius
    const taintedSteps = blastRadius?.tainted_step_ids || [];
    const affectedSinks = blastRadius?.affected_terminal_sinks || [];

    // Formulate 5 core answers based on diagnosis
    let whatWentWrong = "";
    let riskLevel: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" = "MEDIUM";
    let consequence = "";
    let action = "";
    let explanation = "";
    let verificationCheck = "";

    const baseParams = ctx.baseline_parameters || {};
    const targParams = ctx.target_parameters || {};
    const ruleId = finding?.rule_id;

    if (ruleId === DiagnosticRuleID.DR_01_UPSTREAM_INPUT_DATA_DRIFT) {
      whatWentWrong = `The raw input dataset '${datasetName}' was modified prior to pipeline execution. The incoming data arrived with a different content hash and a delta of ${rowDelta >= 0 ? "+" : ""}${rowDelta} rows compared to baseline.`;
      riskLevel = "CRITICAL";
      consequence = `Every downstream step and ${affectedSinks.length > 0 ? affectedSinks.join(", ") : "final sink"} was calculated from mutated source data.`;
      action = `Verify the upstream data provider's export timestamp, schema version, and ingestion audit log.`;
      explanation = `Since the pipeline transformation parameters did not change, the discrepancy originated outside the pipeline boundary.`;
      verificationCheck = `Re-run pipeline with baseline source dataset '${datasetName}' and verify that step '${stepId}' produces exactly ${baseRows} rows.`;
    } else if (ruleId === DiagnosticRuleID.DR_02_ARITHMETIC_EXPRESSION_MUTATION) {
      if (baseParams.predicate || targParams.predicate) {
        const basePred = String(baseParams.predicate || "none");
        const targPred = String(targParams.predicate || "none");
        whatWentWrong = `The filter condition in step '${stepId}' was modified from "${basePred}" to "${targPred}", causing ${Math.abs(rowDelta)} rows to be ${rowDelta < 0 ? "excluded" : "added"}.`;
        consequence = `Downstream calculations received ${targRows} records instead of ${baseRows}, altering regional aggregations and downstream sink outputs.`;
        action = `Restore the original filter predicate "${basePred}" or document the exclusion if this rule adjustment was intentional.`;
        explanation = `The inputs to this step were identical; only the filter predicate string was altered between runs.`;
        verificationCheck = `Confirm that step '${stepId}' emits exactly ${baseRows} rows matching predicate "${basePred}".`;
      } else {
        const baseExpr = String(baseParams.expression || JSON.stringify(baseParams));
        const targExpr = String(targParams.expression || JSON.stringify(targParams));
        const col = (ctx.target_parameters?.target_column as string) || (affectedCols[0] || "calculated metric");
        whatWentWrong = `The calculation formula for '${col}' in step '${stepId}' changed from "${baseExpr}" to "${targExpr}", altering values across ${modifiedCount} rows.`;
        consequence = `Downstream reports and terminal sinks relying on '${col}' contain mathematically drifted values.`;
        action = `Revert the formula expression in '${stepId}' back to "${baseExpr}".`;
        explanation = `Bit-for-bit identical input rows were transformed with a modified formula, directly causing the numeric divergence.`;
        verificationCheck = `Re-run pipeline and verify zero modified rows with identical output content hash.`;
      }
      riskLevel = affectedSinks.length > 0 ? "HIGH" : "MEDIUM";
    } else if (ruleId === DiagnosticRuleID.DR_03_UNMATCHED_JOIN_DROP) {
      const dropPct = baseRows > 0 ? (((baseRows - targRows) / baseRows) * 100).toFixed(1) : "0";
      whatWentWrong = `The join operation in step '${stepId}' experienced a ${dropPct}% row drop (${baseRows} baseline rows down to ${targRows} candidate rows).`;
      riskLevel = "CRITICAL";
      consequence = `Significant data loss occurred in terminal sinks (${affectedSinks.join(", ") || "pipeline sinks"}), omitting critical records.`;
      action = `Inspect the join keys (left_on and right_on) for casing, whitespace, or data type discrepancies between datasets.`;
      explanation = `The join condition failed to find matching keys in the candidate dataset, discarding unmatched records.`;
      verificationCheck = `Ensure join step '${stepId}' preserves at least ${baseRows} rows and matches key distribution.`;
    } else if (ruleId === DiagnosticRuleID.DR_04_DUPLICATION_CARDINALITY_BURST) {
      const inflPct = baseRows > 0 ? (((targRows - baseRows) / baseRows) * 100).toFixed(1) : "0";
      whatWentWrong = `Step '${stepId}' experienced cardinality inflation of +${inflPct}% (${baseRows} rows inflated to ${targRows} rows, +${targRows - baseRows} extra rows).`;
      riskLevel = "HIGH";
      consequence = `Multiplied rows cause financial metrics and volume counts to be artificially inflated downstream.`;
      action = `Add a deduplicate_rows step or ensure 1-to-1 key uniqueness on join dimension tables.`;
      explanation = `A 1-to-many relationship in the input data caused record duplication during transformation.`;
      verificationCheck = `Verify unique primary keys and row count returning to ${baseRows} rows.`;
    } else if (ruleId === DiagnosticRuleID.DR_05_NULL_SENTINEL_SURGE) {
      const col = affectedCols[0] || "target column";
      whatWentWrong = `Column '${col}' in step '${stepId}' suffered a null surge: valid values were converted into NULL.`;
      riskLevel = "HIGH";
      consequence = `Downstream mathematical formulas and filters will silently drop or ignore nullified records.`;
      action = `Add a handle_missing step with COALESCE or provide default fallback values before type casting.`;
      explanation = `Non-standard sentinel strings or unhandled missing formats caused silent null conversion during casting.`;
      verificationCheck = `Confirm zero unexpected NULL values in column '${col}' across all ${targRows} rows.`;
    } else if (ruleId === DiagnosticRuleID.DR_06_NONDETERMINISTIC_TRANSFORMATION) {
      whatWentWrong = `Step '${stepId}' produced different output results despite 100% identical inputs and identical step parameters.`;
      riskLevel = "HIGH";
      consequence = `Pipeline executions are non-reproducible; repeated runs will generate inconsistent numbers.`;
      action = `Replace ambient system timestamp calls (e.g. now()) with explicit parameter timestamps and seed pseudo-random functions.`;
      explanation = `Non-deterministic operations inject runtime-dependent state into deterministic pipelines.`;
      verificationCheck = `Execute pipeline twice and verify that output hash matches deterministically across runs.`;
    } else if (diffRes && diffRes.is_equal && (!ctx.baseline_output_hash || !ctx.target_output_hash || ctx.baseline_output_hash === ctx.target_output_hash)) {
      // No divergence case
      whatWentWrong = "No divergence detected. Pipeline outputs and content hashes are 100% identical between baseline and candidate runs.";
      riskLevel = "LOW";
      consequence = "All downstream nodes and terminal sinks are verified bit-for-bit identical with baseline.";
      action = "No remediation required. Candidate run is verified clean and equivalent.";
      explanation = "Zero row deltas, zero field modifications, and matching fingerprints confirm pipeline equivalence.";
      verificationCheck = "Verified equivalent across all checkpoints with 0 modified rows.";
    } else if (diffRes?.schema_diff && (diffRes.schema_diff.added_columns.length > 0 || diffRes.schema_diff.removed_columns.length > 0)) {
      // Schema drift case
      const added = diffRes.schema_diff.added_columns;
      const removed = diffRes.schema_diff.removed_columns;
      whatWentWrong = `Schema drift detected in step '${stepId}': ${added.length > 0 ? `added column(s) [${added.join(", ")}]` : ""}${added.length > 0 && removed.length > 0 ? "; " : ""}${removed.length > 0 ? `removed column(s) [${removed.join(", ")}]` : ""}.`;
      riskLevel = removed.length > 0 ? "CRITICAL" : "MEDIUM";
      consequence = `Downstream steps expecting previous column definitions will fail or encounter null references.`;
      action = `Ensure column select/rename operations maintain backward-compatible column contracts.`;
      explanation = `The schema structure diverged between runs while row data was transformed.`;
      verificationCheck = `Confirm step '${stepId}' emits exact expected schema without missing columns.`;
    } else if (removedCount > 0 && modifiedCount === 0 && addedCount === 0) {
      // Pure row deletion / exclusion case
      whatWentWrong = `Row deletion detected in step '${stepId}': ${removedCount} rows present in baseline were completely omitted in candidate output (${baseRows} -> ${targRows} rows).`;
      riskLevel = "HIGH";
      consequence = `Missing rows propagate downstream, causing omission of transactions in terminal sinks.`;
      action = `Review filtering or deduplication conditions responsible for the deletion of ${removedCount} records.`;
      explanation = `Candidate step omitted existing records without introducing new modifications.`;
      verificationCheck = `Verify that step '${stepId}' preserves all ${baseRows} expected records.`;
    } else {
      // Divergence where the exact root cause cannot be determined (explicitly identified as unknown)
      whatWentWrong = diffRes && !diffRes.is_equal
        ? `Unclassified divergence in step '${stepId}': ${modifiedCount} rows modified, ${addedCount} added, ${removedCount} removed. The specific causal mechanism could not be definitively determined from parameters alone.`
        : `Unclassified divergence in step '${stepId}': Output content hashes diverged without explicit parameter diffs.`;
      riskLevel = affectedSinks.length > 0 ? "HIGH" : "MEDIUM";
      consequence = `Downstream nodes (${taintedSteps.slice(0, 3).join(", ") || "sinks"}) received divergent data of indeterminate origin.`;
      action = `Inspect step configuration and sample row diffs in the comparison table below to determine manual intent.`;
      explanation = `Unknown / indeterminate cause: Output diverged, but observed metrics do not match canonical diagnostic rules (DR-01 through DR-06) with high confidence.`;
      verificationCheck = `Investigate sample records in step '${stepId}' and re-run comparison after verifying upstream contracts.`;
    }

    return {
      what_went_wrong: whatWentWrong,
      where: {
        step_id: stepId,
        step_name: ctx.step_id,
        dataset_name: datasetName,
        operation,
        affected_columns: affectedCols,
      },
      evidence: {
        baseline_row_count: baseRows,
        target_row_count: targRows,
        row_delta: rowDelta,
        baseline_hash: ctx.baseline_output_hash || diffRes?.baseline_fingerprint?.fingerprint_hash,
        target_hash: ctx.target_output_hash || diffRes?.target_fingerprint?.fingerprint_hash,
        schema_changes: diffRes?.schema_diff
          ? {
              added: diffRes.schema_diff.added_columns,
              removed: diffRes.schema_diff.removed_columns,
              type_changes: diffRes.schema_diff.type_changes,
            }
          : undefined,
        sample_records: sampleRecords,
        observed_facts: observedFacts,
      },
      impact: {
        risk_level: riskLevel,
        blast_radius_steps: taintedSteps,
        affected_terminal_sinks: affectedSinks,
        consequence,
      },
      remediation: {
        action,
        explanation,
        verification_check: verificationCheck,
      },
      technical_details: {
        rule_id: finding?.rule_id || "GENERAL_TRANSFORMATION_DIVERGENCE",
        rule_name: finding?.rule_name || "Transformation Divergence",
        evidence_tier: finding?.evidence_tier || EvidenceTier.PROVEN_OBSERVATION,
        divergence_category: finding?.rule_name || "TRANSFORMATION_DIVERGENCE",
        confidence_explanation: finding?.confidence_explanation,
        parameters_diff: {
          baseline: ctx.baseline_parameters,
          target: ctx.target_parameters,
        },
      },
    };
  }
}
