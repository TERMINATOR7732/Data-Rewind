/**
 * Data Rewind Earliest Observable Divergence (EOD) Detector.
 * Conforms strictly to SPEC-MOD-04 §2.1.
 */

import { DiagnosticFinding, DiagnosticRuleID, EODResult, EODStatus, EvidenceTier, StepDiagnosticContext } from "../contracts";
import { DiagnosticRuleEngine } from "../diagnostics/index";

export interface DetectEODOptions {
  topologicalOrder: string[];
  stepContexts: Record<string, StepDiagnosticContext>;
  stepDependencies?: Record<string, string[]>;
  terminalStepIds?: string[];
  hasUnmaterializedIntermediates?: boolean;
}

export class EODDetector {
  /**
   * Evaluates if a single step experienced output divergence.
   */
  public static stepDiverged(ctx: StepDiagnosticContext): boolean {
    if (ctx.diff_result && !ctx.diff_result.is_equal) {
      return true;
    }
    if (
      ctx.baseline_output_hash &&
      ctx.target_output_hash &&
      ctx.baseline_output_hash !== ctx.target_output_hash
    ) {
      return true;
    }
    return false;
  }

  /**
   * Detects Earliest Observable Divergence (EOD) across the DAG topology.
   */
  public static detectEOD(options: DetectEODOptions): EODResult {
    const {
      topologicalOrder,
      stepContexts,
      terminalStepIds,
      hasUnmaterializedIntermediates = false,
    } = options;

    // Infer linear dependency fallback if omitted
    const dependencies: Record<string, string[]> =
      options.stepDependencies ||
      (topologicalOrder.length > 1
        ? topologicalOrder.slice(1).reduce((acc, stepId, idx) => {
            acc[stepId] = [topologicalOrder[idx]];
            return acc;
          }, {} as Record<string, string[]>)
        : {});

    const findings: DiagnosticFinding[] = [];

    // 1. Edge Case: Missing Intermediate Checkpoints (SPEC-MOD-04 2.1.1)
    if (hasUnmaterializedIntermediates) {
      const terminals =
        terminalStepIds && terminalStepIds.length > 0
          ? terminalStepIds
          : topologicalOrder.length > 0
          ? [topologicalOrder[topologicalOrder.length - 1]]
          : [];

      for (const termId of terminals) {
        const ctx = stepContexts[termId];
        if (ctx && this.stepDiverged(ctx)) {
          findings.push(...DiagnosticRuleEngine.evaluateStep(ctx));
          return {
            status: EODStatus.COARSE_GRAINED_EOD,
            divergent_step_ids: [termId],
            primary_eod_step: termId,
            is_coarse_grained: true,
            findings,
            evidence_tier: EvidenceTier.PROVEN_OBSERVATION,
            summary: `COARSE_GRAINED_EOD (Intermediates not materialized): Output divergence observed at terminal sink '${termId}'.`,
            divergence_category: "COARSE_GRAINED_TERMINAL_DIVERGENCE",
            affected_row_count: ctx.diff_result?.modified_count ?? 0,
          };
        }
      }

      return {
        status: EODStatus.NO_DIVERGENCE,
        divergent_step_ids: [],
        primary_eod_step: null,
        is_coarse_grained: true,
        findings: [],
        evidence_tier: EvidenceTier.PROVEN_OBSERVATION,
        summary: "No divergence observed at terminal sinks.",
        divergence_category: "NO_DIVERGENCE",
        affected_row_count: 0,
      };
    }

    // 2. Edge Case: Upstream Input Data Drift (SPEC-MOD-04 2.1.3)
    for (const stepId of topologicalOrder) {
      const ctx = stepContexts[stepId];
      if (ctx && ctx.is_ingestion_node && this.stepDiverged(ctx)) {
        const stepFindings = DiagnosticRuleEngine.evaluateStep(ctx);
        const hasInputDrift = stepFindings.some(
          (f) => f.rule_id === DiagnosticRuleID.DR_01_UPSTREAM_INPUT_DATA_DRIFT
        );
        if (hasInputDrift) {
          findings.push(...stepFindings);
          return {
            status: EODStatus.UPSTREAM_INPUT_DATA_DRIFT,
            divergent_step_ids: [stepId],
            primary_eod_step: stepId,
            is_coarse_grained: false,
            findings,
            evidence_tier: EvidenceTier.CAUSAL_HYPOTHESIS_INPUT_DRIFT,
            summary: `Earliest Observable Divergence detected at ingestion step '${stepId}'. Upstream input file changed content hash.`,
            divergence_category: "UPSTREAM_INPUT_DATA_DRIFT",
            affected_row_count: ctx.diff_result?.modified_count ?? ctx.diff_result?.added_count ?? 0,
          };
        }
      }
    }

    // 3. Identify all divergent steps across the graph
    const divergentSteps = new Set<string>();
    for (const stepId of topologicalOrder) {
      const ctx = stepContexts[stepId];
      if (ctx && this.stepDiverged(ctx)) {
        divergentSteps.add(stepId);
      }
    }

    if (divergentSteps.size === 0) {
      return {
        status: EODStatus.NO_DIVERGENCE,
        divergent_step_ids: [],
        primary_eod_step: null,
        is_coarse_grained: false,
        findings: [],
        evidence_tier: EvidenceTier.PROVEN_OBSERVATION,
        summary: "No divergence detected across pipeline steps; all outputs identical.",
        divergence_category: "NO_DIVERGENCE",
        affected_row_count: 0,
      };
    }

    // 4. Find root divergent nodes (steps whose upstream dependencies did NOT diverge)
    const rootDivergentSteps: string[] = [];
    for (const stepId of topologicalOrder) {
      if (divergentSteps.has(stepId)) {
        const upstream = dependencies[stepId] || [];
        const hasDivergentParent = upstream.some((dep) => divergentSteps.has(dep));
        if (!hasDivergentParent) {
          rootDivergentSteps.push(stepId);
        }
      }
    }

    if (rootDivergentSteps.length === 0) {
      const firstDiv = topologicalOrder.find((s) => divergentSteps.has(s))!;
      rootDivergentSteps.push(firstDiv);
    }

    // Evaluate findings on all root divergent steps
    for (const stepId of rootDivergentSteps) {
      const ctx = stepContexts[stepId];
      if (ctx) {
        findings.push(...DiagnosticRuleEngine.evaluateStep(ctx));
      }
    }

    // 5. Multiple Independent Divergent Branches (SPEC-MOD-04 2.1.2)
    if (rootDivergentSteps.length > 1) {
      return {
        status: EODStatus.CONCURRENT_DIVERGENCE_POINTS,
        divergent_step_ids: rootDivergentSteps,
        primary_eod_step: rootDivergentSteps[0],
        is_coarse_grained: false,
        findings,
        evidence_tier: EvidenceTier.PROVEN_OBSERVATION,
        summary: `Concurrent Divergence Points detected: ${rootDivergentSteps.length} independent parallel branches diverged simultaneously (${rootDivergentSteps.join(", ")}).`,
        divergence_category: "CONCURRENT_DIVERGENCE_POINTS",
        affected_row_count: rootDivergentSteps.reduce(
          (sum, s) => sum + (stepContexts[s]?.diff_result?.modified_count || 0),
          0
        ),
      };
    }

    // 6. Single Origin Divergent Node
    const primaryStep = rootDivergentSteps[0];
    const primaryCtx = stepContexts[primaryStep];

    const isNonDeterministic = findings.some(
      (f) => f.rule_id === "DR_06_NONDETERMINISTIC_TRANSFORMATION"
    );

    const status = isNonDeterministic
      ? EODStatus.NONDETERMINISTIC_TRANSFORMATION
      : EODStatus.EXACT_EOD;

    const topFinding = findings[0];
    const evidenceTier = topFinding ? topFinding.evidence_tier : EvidenceTier.PROVEN_OBSERVATION;

    return {
      status,
      divergent_step_ids: [primaryStep],
      primary_eod_step: primaryStep,
      is_coarse_grained: false,
      findings,
      evidence_tier: evidenceTier,
      summary: `Earliest Observable Divergence verified at step '${primaryStep}' (${primaryCtx?.operation || "operation"}).`,
      divergence_category: topFinding ? topFinding.rule_name : "TRANSFORMATION_DIVERGENCE",
      affected_row_count: primaryCtx?.diff_result?.modified_count ?? 0,
    };
  }
}
