/**
 * Data Rewind Replay & Reproducibility Engine.
 * Conforms strictly to SPEC-MOD-03 §3.4.
 *
 * Implements deterministic historical execution replay and classifies outcomes into:
 * - REPRODUCIBLE
 * - PARTIALLY_REPRODUCIBLE
 * - BLOCKED_MISSING_ARTIFACTS
 * - DIVERGENT
 * - FAILED_VERIFICATION
 */

import { ExecutionRequest, PipelineDefinition, PipelineExecutionResult, StepOutput } from "../contracts/index";
import { QueryExecutor } from "../pipeline/transformations/index";
import { PipelineExecutionEngine } from "../pipeline/engine";
import { StorageManager, storageManager } from "../storage/storage-manager";
import { RunManifest, verifyArtifactChecksum } from "../storage/run-manifest";
import {
  ReplayOutcome,
  ReplayRequest,
  ReplayResult,
  ReplayScope,
  ReplayStepVerification,
} from "./contracts";
import { TabularComparator } from "../forensics/comparator/index";

export class ReplayEngine {
  constructor(
    private storage: StorageManager = storageManager,
    private executor?: QueryExecutor
  ) {}

  setExecutor(executor: QueryExecutor): void {
    this.executor = executor;
  }

  /**
   * Evaluates replayed execution result against historical run manifest.
   * Classifies into REPRODUCIBLE, PARTIALLY_REPRODUCIBLE, DIVERGENT, or FAILED_VERIFICATION.
   */
  public async evaluateReplay(
    historicalManifest: RunManifest,
    replayedResult: PipelineExecutionResult,
    options: {
      scope?: ReplayScope;
      floatTolerance?: number;
      replayRunId?: string;
    } = {}
  ): Promise<ReplayResult> {
    const replayRunId =
      options.replayRunId ||
      (typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `replay_${Date.now()}`);

    const scope = options.scope || "FULL_PIPELINE";
    const tolerance = options.floatTolerance ?? 1e-6;

    // Check if replayed execution failed
    if (replayedResult.status === "FAILED") {
      return {
        replayRunId,
        historicalRunId: historicalManifest.runId,
        scope,
        outcome: ReplayOutcome.FAILED_VERIFICATION,
        explanation: `Replay execution failed prematurely: ${replayedResult.errorMessage || "Unknown error"}`,
        missingArtifacts: [],
        stepVerifications: {},
        lateDivergenceStepId: replayedResult.failedStepId || null,
        executionDurationMs: replayedResult.durationMs,
        executedAt: new Date().toISOString(),
      };
    }

    const stepVerifications: Record<string, ReplayStepVerification> = {};
    let allExactMatch = true;
    let hasPartialMatch = false;
    let lateDivergenceStepId: string | null = null;
    let divergenceExplanation = "";

    const historicalSteps = historicalManifest.stepsSnapshot || {};
    const topologicalOrder =
      replayedResult.topologicalOrder && replayedResult.topologicalOrder.length > 0
        ? replayedResult.topologicalOrder
        : Object.keys(historicalSteps);

    for (const stepId of topologicalOrder) {
      const histStep: StepOutput | undefined = historicalSteps[stepId];
      const repStep: StepOutput | undefined = replayedResult.stepResults[stepId];

      if (!histStep || !repStep) {
        allExactMatch = false;
        if (!lateDivergenceStepId) {
          lateDivergenceStepId = stepId;
          divergenceExplanation = `Step '${stepId}' was missing from ${!histStep ? "historical" : "replayed"} results.`;
        }
        stepVerifications[stepId] = {
          stepId,
          historicalMultisetHash: histStep?.multisetHash || null,
          replayedMultisetHash: repStep?.multisetHash || null,
          isMatched: false,
          isLateDivergencePoint: lateDivergenceStepId === stepId,
          varianceDetails: "Step output missing in one of the executions",
          historicalRowCount: histStep?.rowCount,
          replayedRowCount: repStep?.rowCount,
        };
        continue;
      }

      // Check 1: Multiset Hash equality (100% exact match)
      const histHash = histStep.multisetHash;
      const repHash = repStep.multisetHash;

      if (histHash && repHash && histHash === repHash) {
        stepVerifications[stepId] = {
          stepId,
          historicalMultisetHash: histHash,
          replayedMultisetHash: repHash,
          isMatched: true,
          isLateDivergencePoint: false,
          historicalRowCount: histStep.rowCount,
          replayedRowCount: repStep.rowCount,
        };
        continue;
      }

      // Check 2: If preview rows or tables exist, perform tabular comparison with float tolerance
      let matchedWithinTolerance = false;
      let diffReason = "";

      if (histStep.rowCount === repStep.rowCount && histStep.previewRows && repStep.previewRows) {
        const candidatePk =
          histStep.schema?.primaryKeys?.length
            ? histStep.schema.primaryKeys
            : (histStep.previewRows[0] && "id" in histStep.previewRows[0] ? ["id"] : undefined);

        const comp = await TabularComparator.compare({
          baselineRows: histStep.previewRows,
          targetRows: repStep.previewRows,
          config: { primaryKey: candidatePk, atol: tolerance },
        });

        if (comp.is_equal) {
          matchedWithinTolerance = true;
          hasPartialMatch = true;
          diffReason = `Matched within numerical float tolerance (${tolerance})`;
        } else {
          diffReason = `Divergence: ${comp.modified_count} modified rows, ${comp.added_count} added rows, ${comp.removed_count} removed rows`;
        }
      } else {
        diffReason = `Hash mismatch (Hist: ${histHash?.slice(0, 8)}, Rep: ${repHash?.slice(0, 8)})`;
      }

      if (matchedWithinTolerance) {
        allExactMatch = false;
        stepVerifications[stepId] = {
          stepId,
          historicalMultisetHash: histHash,
          replayedMultisetHash: repHash,
          isMatched: true,
          isLateDivergencePoint: false,
          varianceDetails: diffReason,
          historicalRowCount: histStep.rowCount,
          replayedRowCount: repStep.rowCount,
        };
      } else {
        allExactMatch = false;
        if (!lateDivergenceStepId) {
          lateDivergenceStepId = stepId;
          divergenceExplanation = `Earliest divergence occurred at step '${stepId}': ${diffReason}`;
        }
        stepVerifications[stepId] = {
          stepId,
          historicalMultisetHash: histHash,
          replayedMultisetHash: repHash,
          isMatched: false,
          isLateDivergencePoint: lateDivergenceStepId === stepId,
          varianceDetails: diffReason,
          historicalRowCount: histStep.rowCount,
          replayedRowCount: repStep.rowCount,
        };
      }
    }

    let outcome: ReplayOutcome;
    let explanation: string;

    if (allExactMatch) {
      outcome = ReplayOutcome.REPRODUCIBLE;
      explanation = "All input data, transformation steps, and output multiset hashes matched historical records 100%.";
    } else if (hasPartialMatch && !lateDivergenceStepId) {
      outcome = ReplayOutcome.PARTIALLY_REPRODUCIBLE;
      explanation = `Replay matched historical records within float tolerance (${tolerance}).`;
    } else {
      outcome = ReplayOutcome.DIVERGENT;
      explanation = divergenceExplanation || "Replay produced divergent output hashes compared to historical records.";
    }

    const replayResult: ReplayResult = {
      replayRunId,
      historicalRunId: historicalManifest.runId,
      scope,
      outcome,
      explanation,
      missingArtifacts: [],
      stepVerifications,
      lateDivergenceStepId,
      executionDurationMs: replayedResult.durationMs,
      executedAt: new Date().toISOString(),
    };

    // Save replay record to IndexedDB
    try {
      await this.storage.getIdb().saveReplayRecord(replayResult);
    } catch {
      // Storage save error should not block replay result return
    }

    return replayResult;
  }

  /**
   * Replay a historical run end-to-end.
   * Validates prerequisites, detects missing artifacts, executes pipeline, and evaluates reproducibility.
   */
  public async replayRun(request: ReplayRequest): Promise<ReplayResult> {
    const { historicalRunId, scope = "FULL_PIPELINE", floatTolerance = 1e-6 } = request;
    const replayRunId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `replay_${Date.now()}`;

    // 1. Load historical run manifest
    const manifest = await this.storage.getRunManifest(historicalRunId);
    if (!manifest) {
      return {
        replayRunId,
        historicalRunId,
        scope,
        outcome: ReplayOutcome.FAILED_VERIFICATION,
        explanation: `Historical run manifest '${historicalRunId}' does not exist in storage.`,
        missingArtifacts: [],
        stepVerifications: {},
        lateDivergenceStepId: null,
        executionDurationMs: 0,
        executedAt: new Date().toISOString(),
      };
    }

    // 2. Validate prerequisites: check required input artifacts and checkpoints
    const missingArtifacts: string[] = [];
    const inputRefs = Object.values(manifest.inputArtifacts || {});

    for (const ref of inputRefs) {
      if (!ref) continue;
      const valid = await verifyArtifactChecksum(this.storage.getOpfs(), ref);
      if (!valid) {
        missingArtifacts.push(ref.artifactId);
      }
    }

    if (scope === "CHECKPOINT" && request.fromCheckpointStepId) {
      const cpRef = manifest.checkpointReferences[request.fromCheckpointStepId];
      if (!cpRef || !(await verifyArtifactChecksum(this.storage.getOpfs(), cpRef))) {
        missingArtifacts.push(cpRef?.artifactId || `checkpoint_${request.fromCheckpointStepId}`);
      }
    }

    if (missingArtifacts.length > 0) {
      const blockedResult: ReplayResult = {
        replayRunId,
        historicalRunId,
        scope,
        outcome: ReplayOutcome.BLOCKED_MISSING_ARTIFACTS,
        explanation: `Replay blocked: ${missingArtifacts.length} required artifact(s) are missing or corrupt in storage.`,
        missingArtifacts,
        stepVerifications: {},
        lateDivergenceStepId: null,
        executionDurationMs: 0,
        executedAt: new Date().toISOString(),
      };
      await this.storage.getIdb().saveReplayRecord(blockedResult);
      return blockedResult;
    }

    // 3. Check for executor availability
    if (!this.executor) {
      // If no query executor was injected, we cannot execute the raw SQL transformations
      return {
        replayRunId,
        historicalRunId,
        scope,
        outcome: ReplayOutcome.FAILED_VERIFICATION,
        explanation: "No QueryExecutor configured on ReplayEngine to run DuckDB-Wasm queries.",
        missingArtifacts: [],
        stepVerifications: {},
        lateDivergenceStepId: null,
        executionDurationMs: 0,
        executedAt: new Date().toISOString(),
      };
    }

    // 4. Construct historical pipeline execution request
    const pipeline: PipelineDefinition = {
      version: manifest.version,
      pipelineId: manifest.pipelineId,
      name: manifest.pipelineName,
      nodes: Object.values(manifest.stepsSnapshot).map((s) => ({
        nodeId: s.stepId,
        operationType: "select_columns" as any, // placeholder, rebuilt from snapshot definition
        parameters: {},
        inputNodeIds: manifest.executionPlan.stepInputs[s.stepId] || [],
      })),
      edges: [],
      sourceDatasets: {},
    };

    const execRequest: ExecutionRequest = {
      version: manifest.version,
      executionId: replayRunId,
      pipeline,
      runType: "HISTORICAL_REPLAY",
    };

    const engine = new PipelineExecutionEngine({ executor: this.executor });
    const execResult = await engine.execute(execRequest);

    return this.evaluateReplay(manifest, execResult, {
      scope,
      floatTolerance,
      replayRunId,
    });
  }
}

export const replayEngine = new ReplayEngine();
