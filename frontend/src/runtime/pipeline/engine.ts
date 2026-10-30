/**
 * Data Rewind Pipeline Execution Engine.
 * Conforms to SPEC-MOD-01, SPEC-MOD-02 & SPEC-MOD-07.
 * Coordinates validation, planning, isolated step execution,
 * intermediate checkpoint hashing, and fail-fast fault isolation.
 */

import {
  ExecutionPlan,
  ExecutionRequest,
  PipelineExecutionResult,
  StepOutput,
  IntermediateCheckpoint,
  ExecutionProgressEvent,
  EXECUTION_CONTRACT_VERSION,
} from "../contracts/index";
import { ERROR_CODES, RuntimeError } from "../contracts/errors";
import { validatePipeline } from "./dag-validator";
import { createExecutionPlan } from "./planner";
import {
  computeContentHash,
  computeMultisetHash,
  computeStepDefinitionHash,
} from "./hashing";
import { executeTransformation, QueryExecutor } from "./transformations/index";

export type ProgressCallback = (event: ExecutionProgressEvent) => void;

export interface PipelineEngineOptions {
  executor: QueryExecutor;
  onProgress?: ProgressCallback;
  maxCartesianProduct?: number;
}

export class PipelineExecutionEngine {
  private executor: QueryExecutor;
  private onProgress?: ProgressCallback;
  private maxCartesianProduct: number;

  constructor(options: PipelineEngineOptions) {
    this.executor = options.executor;
    this.onProgress = options.onProgress;
    this.maxCartesianProduct = options.maxCartesianProduct ?? 10_000_000;
  }

  private emitProgress(
    executionId: string,
    stage: ExecutionProgressEvent["stage"],
    percentComplete: number,
    message: string,
    stepId?: string
  ): void {
    if (this.onProgress) {
      this.onProgress({
        executionId,
        stepId,
        stage,
        percentComplete,
        message,
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Executes a pipeline request end-to-end.
   */
  public async execute(request: ExecutionRequest): Promise<PipelineExecutionResult> {
    const { executionId, pipeline, options } = request;
    const startedAt = new Date().toISOString();
    const startTimeMs = Date.now();
    const previewLimit = options?.previewLimit ?? 50;
    const failFast = options?.failFast ?? true;

    this.emitProgress(executionId, "VALIDATING", 5, "Validating pipeline DAG and parameter contracts...");

    // 1. Validation
    const validation = validatePipeline(pipeline);
    if (!validation.valid) {
      const firstError = validation.issues.find((i) => i.severity === "ERROR");
      const err = new RuntimeError(
        firstError?.code || ERROR_CODES.EMPTY_PIPELINE,
        `Pipeline validation failed: ${firstError?.message || "Invalid definition"}`,
        { issues: validation.issues },
        firstError?.remediation
      );

      this.emitProgress(executionId, "FAILED", 100, err.message);

      return {
        version: EXECUTION_CONTRACT_VERSION,
        executionId,
        pipelineId: pipeline.pipelineId,
        status: "FAILED",
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startTimeMs,
        stepResults: {},
        topologicalOrder: [],
        errorMessage: err.message,
        checkpoints: [],
      };
    }

    this.emitProgress(executionId, "PLANNING", 15, "Generating deterministic execution plan...");

    // 2. Planning
    let plan: ExecutionPlan;
    try {
      plan = createExecutionPlan(pipeline);
    } catch (err: any) {
      const errorMsg = err?.message || "Planning error occurred";
      this.emitProgress(executionId, "FAILED", 100, errorMsg);
      return {
        version: EXECUTION_CONTRACT_VERSION,
        executionId,
        pipelineId: pipeline.pipelineId,
        status: "FAILED",
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startTimeMs,
        stepResults: {},
        topologicalOrder: [],
        errorMessage: errorMsg,
        checkpoints: [],
      };
    }

    const { topologicalOrder, stepInputs } = plan;
    const totalSteps = topologicalOrder.length;
    const stepResults: Record<string, StepOutput> = {};
    const checkpoints: IntermediateCheckpoint[] = [];
    const nodeMap = new Map(pipeline.nodes.map((n) => [n.nodeId, n]));

    let executionFailed = false;
    let failedStepId: string | undefined;
    let fatalErrorMessage: string | undefined;

    // 3. Step Execution Loop
    for (let i = 0; i < totalSteps; i++) {
      const stepId = topologicalOrder[i];
      const node = nodeMap.get(stepId)!;
      const progressPercent = Math.min(90, Math.round(20 + ((i + 1) / totalSteps) * 70));

      // Check if upstream dependencies succeeded
      const upstreamStepIds = stepInputs[stepId] || [];
      const upstreamFailedOrSkipped = upstreamStepIds.some(
        (upId) => stepResults[upId]?.status === "FAILED" || stepResults[upId]?.status === "SKIPPED"
      );

      if (executionFailed || upstreamFailedOrSkipped) {
        // Mark step as SKIPPED
        stepResults[stepId] = {
          stepId,
          status: "SKIPPED",
          rowCount: 0,
          columnCount: 0,
          durationMs: 0,
          schema: { version: EXECUTION_CONTRACT_VERSION, columns: [], primaryKeys: [] },
          tableName: "",
          contentHash: "0".repeat(64),
          multisetHash: "0".repeat(64),
          definitionHash: "0".repeat(64),
        };
        continue;
      }

      this.emitProgress(
        executionId,
        "EXECUTING",
        progressPercent,
        `Executing step '${node.label || stepId}' (${node.operationType})...`,
        stepId
      );

      const stepStartMs = Date.now();
      const outputTable = `__intermediate_${executionId}_${stepId.replace(/[^a-zA-Z0-9_]/g, "_")}`;

      // Resolve input tables
      const inputTables: string[] = [];
      const declaredInputs =
        node.inputNodeIds && node.inputNodeIds.length > 0
          ? node.inputNodeIds
          : upstreamStepIds;

      for (const inputId of declaredInputs) {
        if (stepResults[inputId]?.tableName) {
          inputTables.push(stepResults[inputId].tableName);
        } else if (pipeline.sourceDatasets && pipeline.sourceDatasets[inputId]) {
          inputTables.push(pipeline.sourceDatasets[inputId]);
        } else {
          // Direct table name
          inputTables.push(inputId);
        }
      }

      // If entry node, check sourceDatasets binding for this node itself
      if (inputTables.length === 0 && pipeline.sourceDatasets && pipeline.sourceDatasets[stepId]) {
        inputTables.push(pipeline.sourceDatasets[stepId]);
      }

      try {
        // Calculate step definition hash
        const upstreamHashes = upstreamStepIds.map((uid) => stepResults[uid]?.contentHash || "");
        const definitionHash = await computeStepDefinitionHash(
          node.operationType,
          node.parameters || {},
          upstreamHashes
        );

        // Execute transformation
        const transResult = await executeTransformation({
          node,
          inputTables,
          outputTable,
          executor: this.executor,
          maxCartesianProduct: this.maxCartesianProduct,
        });

        // Inspect output table
        const schema = await this.executor.getSchema(outputTable);
        const previewRes = await this.executor.query<Record<string, unknown>>(
          `SELECT * FROM "${outputTable}" LIMIT ${previewLimit};`
        );
        const previewRows = previewRes.rows;

        // Content & Multiset Hashing
        const contentHash = await computeContentHash(previewRows);
        const multisetHash = await computeMultisetHash(previewRows);
        const stepDurationMs = Date.now() - stepStartMs;

        const stepOutput: StepOutput = {
          stepId,
          status: "SUCCESS",
          rowCount: transResult.rowCount,
          columnCount: schema.columns.length,
          durationMs: stepDurationMs,
          schema,
          tableName: outputTable,
          previewRows,
          contentHash,
          multisetHash,
          definitionHash,
          warnings: transResult.warnings,
        };

        stepResults[stepId] = stepOutput;

        // Create Intermediate Checkpoint
        const checkpoint: IntermediateCheckpoint = {
          checkpointId: `chk_${executionId}_${stepId}`,
          runId: executionId,
          stepId,
          tableName: outputTable,
          rowCount: transResult.rowCount,
          byteSize: 0,
          contentHash,
          multisetHash,
          schema,
          createdAt: new Date().toISOString(),
        };
        checkpoints.push(checkpoint);
      } catch (err: any) {
        const stepDurationMs = Date.now() - stepStartMs;
        const execError =
          err instanceof RuntimeError
            ? err.toExecutionError(stepId)
            : {
                code: ERROR_CODES.SQL_EXECUTION_ERROR,
                message: err?.message || `Execution failed at step '${stepId}'.`,
                stepId,
                details: { errorName: err?.name, stack: err?.stack },
                timestamp: new Date().toISOString(),
              };

        stepResults[stepId] = {
          stepId,
          status: "FAILED",
          rowCount: 0,
          columnCount: 0,
          durationMs: stepDurationMs,
          schema: { version: EXECUTION_CONTRACT_VERSION, columns: [], primaryKeys: [] },
          tableName: outputTable,
          contentHash: "0".repeat(64),
          multisetHash: "0".repeat(64),
          definitionHash: "0".repeat(64),
          error: execError,
        };

        executionFailed = true;
        failedStepId = stepId;
        fatalErrorMessage = execError.message;

        if (failFast) {
          // Downstream steps will be marked SKIPPED in subsequent iterations
        }
      }
    }

    const durationMs = Date.now() - startTimeMs;
    const finalStatus: "COMPLETED" | "FAILED" = executionFailed ? "FAILED" : "COMPLETED";

    this.emitProgress(
      executionId,
      finalStatus,
      100,
      executionFailed
        ? `Pipeline execution failed at step '${failedStepId}'. Upstream checkpoints preserved.`
        : `Pipeline executed successfully. All ${totalSteps} steps completed.`
    );

    return {
      version: EXECUTION_CONTRACT_VERSION,
      executionId,
      pipelineId: pipeline.pipelineId,
      status: finalStatus,
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs,
      stepResults,
      topologicalOrder,
      failedStepId,
      errorMessage: fatalErrorMessage,
      checkpoints,
    };
  }
}
