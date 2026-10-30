/**
 * Data Rewind Tri-Run Fix Verification Engine.
 * Conforms strictly to SPEC-MOD-05 §1.
 *
 * Evaluates candidate remediation execution (R2) against:
 * - Axis 1: Remediation Evaluation (R2 vs R1) - Proves EOD fault elimination
 * - Axis 2: Baseline Equivalence (R2 vs R0) - Proves zero collateral regressions
 */

import {
  BaselineEquivalenceAxisResult,
  EvidenceItem,
  ForensicDossier,
  IntentionalUpdateContract,
  MissingEvidenceDeclaration,
  RemediationAxisResult,
  TriRunVerification,
  TriRunVerificationRequest,
  VerificationVerdictCode,
} from "./contracts";
import { TabularDiffResult } from "../../types/api";
import { RunManifest } from "../storage/run-manifest";
import { StorageManager, storageManager } from "../storage/storage-manager";
import { TabularComparator } from "../forensics/comparator/index";

export const VERDICT_MEANINGS: Record<VerificationVerdictCode, string> = {
  VERIFIED_CLEAN:
    "Candidate fix completely eliminates the reported regression with zero collateral divergence.",
  INTENTIONAL_UPDATE:
    "Candidate fix remediates the fault with declared intentional business schema/value updates.",
  PARTIAL_RESTORATION:
    "Fault severity reduced, but candidate fix only partially restores baseline behavior.",
  REGRESSION_UNRESOLVED:
    "Candidate fix failed to remediate the regression; fault persists at target step.",
  NEW_FAULT_INTRODUCED:
    "Candidate fix resolved original fault but introduced secondary regressions at other steps.",
  BASELINE_UNAVAILABLE:
    "Candidate fix verified against faulted run, but baseline equivalence could not be established.",
  FAULT_UNREPRODUCIBLE:
    "The reported defect in R1 could not be observed or reproduced under test conditions.",
  INCONCLUSIVE_VERIFICATION:
    "Verification inconclusive due to ambiguous keyless correspondence or non-deterministic transformations.",
};

export class TriRunVerifier {
  constructor(private storage: StorageManager = storageManager) {}

  /**
   * Verify candidate fix execution R2 using historical manifests or loaded step outputs.
   */
  public async verifyRuns(
    request: TriRunVerificationRequest,
    manifests?: {
      r0?: RunManifest | null; // Baseline
      r1: RunManifest;         // Faulted
      r2: RunManifest;         // Candidate Fix
    }
  ): Promise<ForensicDossier> {
    const startTime = performance.now();

    // 1. Resolve manifests
    let r0: RunManifest | null = null;
    if (manifests?.r0 !== undefined) {
      r0 = manifests.r0;
    } else if (request.baselineRunId) {
      r0 = await this.storage.getRunManifest(request.baselineRunId);
    }

    const r1 = manifests ? manifests.r1 : await this.storage.getRunManifest(request.faultedRunId);
    const r2 = manifests ? manifests.r2 : await this.storage.getRunManifest(request.candidateRunId);

    if (!r1 || !r2) {
      throw new Error(
        `Failed to locate required run manifests: R1=${request.faultedRunId}, R2=${request.candidateRunId}`
      );
    }

    const eodStep = this.detectEODStep(r0, r1);
    const sinkSteps = request.terminalSinkStepIds || this.detectSinkSteps(r2);

    // 2. Evaluate Axis 1: Remediation Evaluation (R2 vs R1)
    const remediationAxis = await this.evaluateRemediationAxis(r0, r1, r2, eodStep, request.floatTolerance);

    // 3. Evaluate Axis 2: Baseline Equivalence (R2 vs R0)
    let baselineAxis: BaselineEquivalenceAxisResult | undefined;
    if (r0) {
      baselineAxis = await this.evaluateBaselineEquivalenceAxis(
        r0,
        r2,
        sinkSteps,
        eodStep,
        request.floatTolerance
      );
    }

    // 4. Synthesize Dual Axis & Determine Canonical Verdict
    const { verdict, reasonCodes } = this.determineVerdict({
      r0Available: !!r0,
      remediationAxis,
      baselineAxis,
      contract: request.intentionalContract,
    });

    // 5. Build Evidence Chain & Missing Evidence Declarations
    const evidenceChain: EvidenceItem[] = [];
    const missingEvidence: MissingEvidenceDeclaration[] = [];

    // Evidence: EOD Remediation
    evidenceChain.push({
      tier: "PROVEN_OBSERVATION",
      step_id: eodStep || "pipeline",
      category: "EOD_REMEDIATION",
      description: remediationAxis.explanation,
      remediation_advice: remediationAxis.eod_remediated
        ? "Fix verified at earliest divergence step."
        : "Inspect transformation parameters or input conditions at target step.",
    });

    if (baselineAxis) {
      evidenceChain.push({
        tier: "PROVEN_OBSERVATION",
        step_id: sinkSteps.join(", ") || "sinks",
        category: "BASELINE_EQUIVALENCE",
        description: baselineAxis.explanation,
        remediation_advice: baselineAxis.baseline_equivalent_across_all_steps
          ? "No secondary regressions detected across pipeline graph."
          : "Review collateral steps for unintentional logic side-effects.",
      });
    }

    // Check for missing artifacts in any run
    const checkMissing = (m: RunManifest, role: string) => {
      for (const me of m.missingEvidence || []) {
        missingEvidence.push({
          step_id: me.stepId || role,
          missing_artifact: me.artifactId || me.description,
          impact_on_verdict: me.remediationAdvice || "Evidence unverified",
        });
      }
    };
    if (r0) checkMissing(r0, "BASELINE (R0)");
    checkMissing(r1, "FAULTED (R1)");
    checkMissing(r2, "FIX (R2)");

    const durationMs = performance.now() - startTime;
    const verificationId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `verif_${Date.now()}`;

    const verification: TriRunVerification = {
      verification_id: verificationId,
      title: request.title || `Fix Verification: ${r2.pipelineName}`,
      baseline_run_id: r0?.runId,
      faulted_run_id: r1.runId,
      candidate_run_id: r2.runId,
      verdict,
      verdict_meaning: VERDICT_MEANINGS[verdict],
      verdict_reason_codes: reasonCodes,
      dual_axis: {
        remediation_axis: remediationAxis,
        baseline_axis: baselineAxis,
      },
      evidence_chain: evidenceChain,
      missing_evidence: missingEvidence,
      created_at: new Date().toISOString(),
      duration_ms: durationMs,
    };

    // Save verification to storage
    try {
      await this.storage.getIdb().saveVerification(verification);
    } catch {
      // Non-blocking
    }

    const dossier: ForensicDossier = {
      metadata: {
        dossier_id: verificationId,
        pipeline_name: r2.pipelineName,
        pipeline_version_hash: r2.pipelineDefinitionHash,
        investigator_session: request.investigatorSession || "browser_interactive",
        baseline_run_id: r0?.runId,
        faulted_run_id: r1.runId,
        candidate_run_id: r2.runId,
        created_at: new Date().toISOString(),
      },
      verification,
      reproducibility_signatures: {
        r0_hash: r0?.pipelineDefinitionHash || "NONE",
        r1_hash: r1.pipelineDefinitionHash,
        r2_hash: r2.pipelineDefinitionHash,
      },
      limitations_disclaimer:
        "Forensic evidence is compiled locally via deterministic tabular comparisons and reproducible hashing. Findings distinguish observed mathematical facts from causal hypotheses. Bit-for-bit logical equivalence requires raw data export.",
    };

    return dossier;
  }

  /**
   * Detect EOD step between R0 and R1.
   */
  private detectEODStep(r0: RunManifest | null, r1: RunManifest): string | null {
    if (!r0) {
      // If R0 is absent, check if R1 failed or has flagged step
      for (const [stepId, s] of Object.entries(r1.stepsSnapshot)) {
        if (s.status === "FAILED") return stepId;
      }
      return Object.keys(r1.stepsSnapshot)[0] || null;
    }

    const order =
      r1.executionPlan?.topologicalOrder && r1.executionPlan.topologicalOrder.length > 0
        ? r1.executionPlan.topologicalOrder
        : Object.keys(r1.stepsSnapshot);

    for (const stepId of order) {
      const s0 = r0.stepsSnapshot[stepId];
      const s1 = r1.stepsSnapshot[stepId];
      if (!s0 || !s1) return stepId;
      if (s0.multisetHash !== s1.multisetHash || s0.rowCount !== s1.rowCount) {
        return stepId;
      }
    }

    return null;
  }

  /**
   * Detect terminal sink steps in the pipeline DAG.
   */
  private detectSinkSteps(r: RunManifest): string[] {
    const allSteps = new Set(Object.keys(r.stepsSnapshot));
    const nonSinkSteps = new Set<string>();

    for (const inputs of Object.values(r.executionPlan?.stepInputs || {})) {
      for (const inId of inputs) {
        nonSinkSteps.add(inId);
      }
    }

    const sinks: string[] = [];
    for (const stepId of allSteps) {
      if (!nonSinkSteps.has(stepId)) {
        sinks.push(stepId);
      }
    }

    return sinks.length > 0 ? sinks : Array.from(allSteps).slice(-1);
  }

  /**
   * Axis 1: Remediation Evaluation (R2 vs R1).
   */
  private async evaluateRemediationAxis(
    r0: RunManifest | null,
    r1: RunManifest,
    r2: RunManifest,
    eodStep: string | null,
    tolerance: number = 1e-6
  ): Promise<RemediationAxisResult> {
    if (!eodStep) {
      return {
        eod_step: null,
        eod_remediated: true,
        eod_severity_reduced: true,
        unresolved_eod_differences: [],
        explanation: "No historical divergence was detected in R1 to remediate.",
      };
    }

    const step1 = r1.stepsSnapshot[eodStep];
    const step2 = r2.stepsSnapshot[eodStep];
    const step0 = r0?.stepsSnapshot[eodStep];

    if (!step2) {
      return {
        eod_step: eodStep,
        eod_remediated: false,
        eod_severity_reduced: false,
        unresolved_eod_differences: [`Step '${eodStep}' not executed in R2`],
        explanation: `Candidate run R2 did not execute target EOD step '${eodStep}'.`,
      };
    }

    // Compare R2 with R0 at EOD step if R0 exists, otherwise compare R2 with R1
    let eodDiff: TabularDiffResult | undefined;
    let unresolved: string[] = [];
    let remediated = false;
    let severityReduced = false;

    if (step0 && step0.previewRows && step2.previewRows) {
      const candidatePk =
        step0.schema?.primaryKeys?.length
          ? step0.schema.primaryKeys
          : (step0.previewRows[0] && "id" in step0.previewRows[0] ? ["id"] : undefined);

      const diffResult = await TabularComparator.compare({
        baselineRows: step0.previewRows,
        targetRows: step2.previewRows,
        config: { primaryKey: candidatePk, atol: tolerance },
      });
      eodDiff = diffResult;

      if (diffResult.is_equal) {
        remediated = true;
        severityReduced = true;
      } else {
        // Compare with R1 to see if severity is reduced
        if (step1 && step1.previewRows) {
          const r1Diff = await TabularComparator.compare({
            baselineRows: step0.previewRows,
            targetRows: step1.previewRows,
            config: { primaryKey: candidatePk, atol: tolerance },
          });

          const r2DivergentCount = diffResult.modified_count + diffResult.added_count + diffResult.removed_count;
          const r1DivergentCount = r1Diff.modified_count + r1Diff.added_count + r1Diff.removed_count;

          severityReduced = r2DivergentCount < r1DivergentCount;
        }

        if (diffResult.modified_count > 0) unresolved.push(`${diffResult.modified_count} modified rows`);
        if (diffResult.added_count > 0) unresolved.push(`${diffResult.added_count} added rows`);
        if (diffResult.removed_count > 0) unresolved.push(`${diffResult.removed_count} removed rows`);
      }
    } else {
      // Hash-based check
      if (step0) {
        if (step2.multisetHash === step0.multisetHash && step2.rowCount === step0.rowCount) {
          remediated = true;
          severityReduced = true;
        } else if (step1 && step2.multisetHash !== step1.multisetHash) {
          // Changed from faulted, but not identical to R0
          severityReduced = true;
          unresolved.push("Multiset hash differs from golden reference R0");
        } else {
          unresolved.push("Multiset hash remains identical to faulted R1");
        }
      } else {
        // R0 unavailable, check if changed from R1
        if (step1 && step2.multisetHash !== step1.multisetHash) {
          remediated = true;
          severityReduced = true;
        } else {
          unresolved.push("Candidate R2 output hash identical to faulted R1");
        }
      }
    }

    let explanation: string;
    if (remediated) {
      explanation = `EOD defect at step '${eodStep}' completely resolved in candidate run R2.`;
    } else if (severityReduced) {
      explanation = `EOD defect at step '${eodStep}' partially reduced in candidate run R2, but differences remain: ${unresolved.join(", ")}.`;
    } else {
      explanation = `EOD defect at step '${eodStep}' unresolved in candidate run R2 (${unresolved.join(", ") || "Identical divergence"}).`;
    }

    return {
      eod_step: eodStep,
      eod_remediated: remediated,
      eod_severity_reduced: severityReduced,
      unresolved_eod_differences: unresolved,
      eod_diff: eodDiff,
      explanation,
    };
  }

  /**
   * Axis 2: Baseline Equivalence (R2 vs R0).
   */
  private async evaluateBaselineEquivalenceAxis(
    r0: RunManifest,
    r2: RunManifest,
    sinkSteps: string[],
    eodStep: string | null,
    tolerance: number = 1e-6
  ): Promise<BaselineEquivalenceAxisResult> {
    const stepComparisons: Record<string, TabularDiffResult> = {};
    const collateralRegressions: string[] = [];
    let equivalentAtSinks = true;
    let equivalentAcrossAll = true;

    const allSteps = new Set([
      ...Object.keys(r0.stepsSnapshot),
      ...Object.keys(r2.stepsSnapshot),
    ]);

    for (const stepId of allSteps) {
      const s0 = r0.stepsSnapshot[stepId];
      const s2 = r2.stepsSnapshot[stepId];

      if (!s0 || !s2) {
        equivalentAcrossAll = false;
        if (sinkSteps.includes(stepId)) equivalentAtSinks = false;
        if (stepId !== eodStep) collateralRegressions.push(stepId);
        continue;
      }

      // Check multiset hash match
      if (s0.multisetHash === s2.multisetHash && s0.rowCount === s2.rowCount) {
        continue;
      }

      // Tabular comparison
      if (s0.previewRows && s2.previewRows) {
        const candidatePk =
          s0.schema?.primaryKeys?.length
            ? s0.schema.primaryKeys
            : (s0.previewRows[0] && "id" in s0.previewRows[0] ? ["id"] : undefined);

        const diff = await TabularComparator.compare({
          baselineRows: s0.previewRows,
          targetRows: s2.previewRows,
          config: { primaryKey: candidatePk, atol: tolerance },
        });

        stepComparisons[stepId] = diff;

        if (!diff.is_equal) {
          equivalentAcrossAll = false;
          if (sinkSteps.includes(stepId)) {
            equivalentAtSinks = false;
          }
          if (stepId !== eodStep) {
            collateralRegressions.push(stepId);
          }
        }
      } else {
        // Preview rows unavailable, hashes differ
        equivalentAcrossAll = false;
        if (sinkSteps.includes(stepId)) {
          equivalentAtSinks = false;
        }
        if (stepId !== eodStep) {
          collateralRegressions.push(stepId);
        }
      }
    }

    let explanation: string;
    if (equivalentAcrossAll) {
      explanation = "Candidate run R2 is 100% equivalent to golden baseline R0 across all intermediate steps and terminal sinks.";
    } else if (equivalentAtSinks && collateralRegressions.length === 0) {
      explanation = "Candidate run R2 is equivalent to golden baseline R0 at terminal sinks and all non-targeted steps.";
    } else if (collateralRegressions.length > 0) {
      explanation = `Candidate run R2 introduced ${collateralRegressions.length} collateral regression(s) at non-targeted steps: ${collateralRegressions.join(", ")}.`;
    } else {
      explanation = "Candidate run R2 exhibits differences at terminal sink outputs compared to golden baseline R0.";
    }

    return {
      baseline_equivalent_at_sinks: equivalentAtSinks,
      baseline_equivalent_across_all_steps: equivalentAcrossAll,
      collateral_regressions: collateralRegressions,
      sink_step_ids: sinkSteps,
      step_comparisons: stepComparisons,
      explanation,
    };
  }

  /**
   * Determines canonical verdict conforming strictly to SPEC-MOD-05 §1.3.
   */
  private determineVerdict(params: {
    r0Available: boolean;
    remediationAxis: RemediationAxisResult;
    baselineAxis?: BaselineEquivalenceAxisResult;
    contract?: IntentionalUpdateContract;
  }): { verdict: VerificationVerdictCode; reasonCodes: string[] } {
    const { r0Available, remediationAxis, baselineAxis, contract } = params;
    const reasons: string[] = [];

    // Case 1: Baseline Unavailable
    if (!r0Available) {
      reasons.push("REASON_BASELINE_UNAVAILABLE");
      if (remediationAxis.eod_remediated) {
        return { verdict: "BASELINE_UNAVAILABLE", reasonCodes: reasons };
      }
      return { verdict: "REGRESSION_UNRESOLVED", reasonCodes: reasons };
    }

    // Case 2: Defect in R1 could not be observed / reproduced
    if (remediationAxis.eod_step === null) {
      reasons.push("REASON_NO_DIVERGENCE_OBSERVED");
      return { verdict: "FAULT_UNREPRODUCIBLE", reasonCodes: reasons };
    }

    // Case 3: Regression Unresolved
    if (!remediationAxis.eod_remediated && !remediationAxis.eod_severity_reduced) {
      reasons.push("REASON_EOD_DEFECT_PERSISTS");
      return { verdict: "REGRESSION_UNRESOLVED", reasonCodes: reasons };
    }

    // Case 4: Partial Restoration
    if (remediationAxis.eod_severity_reduced && !remediationAxis.eod_remediated) {
      reasons.push("REASON_PARTIAL_FAULT_REDUCTION");
      return { verdict: "PARTIAL_RESTORATION", reasonCodes: reasons };
    }

    // At this point, remediationAxis.eod_remediated is true!
    // Check for collateral regressions
    const collateral = baselineAxis?.collateral_regressions || [];

    // Check Intentional Update Contract
    if (contract && (collateral.length > 0 || !baselineAxis?.baseline_equivalent_across_all_steps)) {
      const allowedSteps = new Set(contract.allowed_steps || []);
      const allCollateralAllowed = collateral.every((s) => allowedSteps.has(s));

      if (allCollateralAllowed) {
        reasons.push("REASON_INTENTIONAL_CONTRACT_SATISFIED");
        return { verdict: "INTENTIONAL_UPDATE", reasonCodes: reasons };
      }
    }

    // Case 5: New Fault Introduced (Collateral Regressions)
    if (collateral.length > 0) {
      reasons.push(`REASON_COLLATERAL_REGRESSIONS_AT_${collateral.join("_")}`);
      return { verdict: "NEW_FAULT_INTRODUCED", reasonCodes: reasons };
    }

    // Case 6: Verified Clean (100% clean baseline equivalence at sinks)
    if (baselineAxis?.baseline_equivalent_at_sinks) {
      reasons.push("REASON_CLEAN_REMEDIATION_AND_BASELINE_EQUIVALENCE");
      return { verdict: "VERIFIED_CLEAN", reasonCodes: reasons };
    }

    // Case 7: Residual sink difference without collateral steps
    reasons.push("REASON_SINK_DIVERGENCE");
    return { verdict: "PARTIAL_RESTORATION", reasonCodes: reasons };
  }
}

export const triRunVerifier = new TriRunVerifier();
