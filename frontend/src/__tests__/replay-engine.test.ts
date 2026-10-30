/**
 * Data Rewind Replay Engine & Reproducibility Outcome Tests.
 * Conforms strictly to SPEC-MOD-03 §3.4.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { ReplayEngine } from "../runtime/replay/replay-engine";
import { ReplayOutcome } from "../runtime/replay/contracts";
import { RunManifest } from "../runtime/storage/run-manifest";
import { EXECUTION_CONTRACT_VERSION, PipelineExecutionResult } from "../runtime/contracts/index";
import { IndexedDBStorage } from "../runtime/storage/indexeddb";
import { OpfsArtifactStorage } from "../runtime/storage/opfs";
import { StorageManager } from "../runtime/storage/storage-manager";

describe("Historical Replay & Reproducibility Engine", () => {
  let idb: IndexedDBStorage;
  let opfs: OpfsArtifactStorage;
  let storageManager: StorageManager;
  let replayEngine: ReplayEngine;

  beforeEach(() => {
    const mockStore = new Map<string, any>();
    const createMockReq = (result: any) => {
      const req: any = { result, onsuccess: null, onerror: null };
      setTimeout(() => {
        if (req.onsuccess) req.onsuccess({ target: req });
      }, 0);
      return req;
    };

    const mockDb: any = {
      objectStoreNames: { contains: () => true },
      createObjectStore: () => ({}),
      transaction: () => {
        const tx: any = {
          error: null,
          oncomplete: null,
          onerror: null,
          objectStore: () => ({
            put: (item: any) => {
              const key = item.runId || item.replayId || item.artifactId;
              mockStore.set(key, item);
              return createMockReq(key);
            },
            get: (key: string) => createMockReq(mockStore.get(key)),
            getAll: () => createMockReq(Array.from(mockStore.values())),
            delete: (key: string) => {
              mockStore.delete(key);
              return createMockReq(undefined);
            },
          }),
        };
        setTimeout(() => {
          if (tx.oncomplete) tx.oncomplete();
        }, 0);
        return tx;
      },
    };

    idb = new IndexedDBStorage();
    (idb as any).getDB = async () => mockDb;
    opfs = new OpfsArtifactStorage();
    storageManager = new StorageManager(idb, opfs);
    replayEngine = new ReplayEngine(storageManager);
  });

  const baseManifest: RunManifest = {
    version: EXECUTION_CONTRACT_VERSION,
    runId: "run_hist_01",
    workspaceId: "ws_01",
    pipelineId: "pipe_01",
    pipelineName: "Financial Metrics Pipeline",
    pipelineDefinitionHash: "hash_pipe_def",
    runType: "BASELINE",
    status: "COMPLETED",
    executionPlan: {
      planId: "p_01",
      pipelineId: "pipe_01",
      topologicalOrder: ["step_1", "step_2"],
      stages: [["step_1"], ["step_2"]],
      stepInputs: { step_1: [], step_2: ["step_1"] },
      plannedAt: new Date().toISOString(),
      tieBreakerApplied: false,
    },
    inputArtifacts: {
      in_1: {
        artifactId: "art_input_1",
        runId: "run_hist_01",
        stepId: "input",
        artifactType: "CSV",
        storagePath: "artifacts/in_1.csv",
        byteSize: 100,
        sha256Hash: "in1_hash_abc",
        createdAt: new Date().toISOString(),
      },
    },
    stepsSnapshot: {
      step_1: {
        stepId: "step_1",
        status: "SUCCESS",
        rowCount: 10,
        columnCount: 3,
        durationMs: 12,
        schema: { version: EXECUTION_CONTRACT_VERSION, columns: [], primaryKeys: ["id"] },
        tableName: "t_step_1",
        contentHash: "hash_s1_content",
        multisetHash: "hash_s1_multiset",
        definitionHash: "def_s1",
        previewRows: [{ id: 1, val: 10.0 }],
      },
      step_2: {
        stepId: "step_2",
        status: "SUCCESS",
        rowCount: 10,
        columnCount: 4,
        durationMs: 15,
        schema: { version: EXECUTION_CONTRACT_VERSION, columns: [], primaryKeys: ["id"] },
        tableName: "t_step_2",
        contentHash: "hash_s2_content",
        multisetHash: "hash_s2_multiset",
        definitionHash: "def_s2",
        previewRows: [{ id: 1, result: 100.5 }],
      },
    },
    checkpointReferences: {},
    missingEvidence: [],
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: 27,
  };

  it("classifies exact multiset hash matches as REPRODUCIBLE", async () => {
    const replayedResult: PipelineExecutionResult = {
      version: EXECUTION_CONTRACT_VERSION,
      executionId: "exec_rep_01",
      pipelineId: "pipe_01",
      status: "COMPLETED",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 25,
      topologicalOrder: ["step_1", "step_2"],
      checkpoints: [],
      stepResults: {
        step_1: {
          stepId: "step_1",
          status: "SUCCESS",
          rowCount: 10,
          columnCount: 3,
          durationMs: 10,
          schema: { version: EXECUTION_CONTRACT_VERSION, columns: [], primaryKeys: [] },
          tableName: "t_rep_s1",
          contentHash: "hash_s1_content",
          multisetHash: "hash_s1_multiset",
          definitionHash: "def_s1",
        },
        step_2: {
          stepId: "step_2",
          status: "SUCCESS",
          rowCount: 10,
          columnCount: 4,
          durationMs: 14,
          schema: { version: EXECUTION_CONTRACT_VERSION, columns: [], primaryKeys: [] },
          tableName: "t_rep_s2",
          contentHash: "hash_s2_content",
          multisetHash: "hash_s2_multiset",
          definitionHash: "def_s2",
        },
      },
    };

    const result = await replayEngine.evaluateReplay(baseManifest, replayedResult);
    expect(result.outcome).toBe(ReplayOutcome.REPRODUCIBLE);
    expect(result.stepVerifications["step_1"].isMatched).toBe(true);
    expect(result.stepVerifications["step_2"].isMatched).toBe(true);
    expect(result.lateDivergenceStepId).toBeNull();
  });

  it("classifies numerical float tolerance match as PARTIALLY_REPRODUCIBLE", async () => {
    const replayedResult: PipelineExecutionResult = {
      version: EXECUTION_CONTRACT_VERSION,
      executionId: "exec_rep_float",
      pipelineId: "pipe_01",
      status: "COMPLETED",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 25,
      topologicalOrder: ["step_1", "step_2"],
      checkpoints: [],
      stepResults: {
        step_1: {
          stepId: "step_1",
          status: "SUCCESS",
          rowCount: 10,
          columnCount: 3,
          durationMs: 10,
          schema: { version: EXECUTION_CONTRACT_VERSION, columns: [], primaryKeys: [] },
          tableName: "t_rep_s1",
          contentHash: "hash_s1_content",
          multisetHash: "hash_s1_multiset",
          definitionHash: "def_s1",
        },
        step_2: {
          stepId: "step_2",
          status: "SUCCESS",
          rowCount: 10,
          columnCount: 4,
          durationMs: 14,
          schema: { version: EXECUTION_CONTRACT_VERSION, columns: [], primaryKeys: [] },
          tableName: "t_rep_s2",
          contentHash: "hash_s2_diff_float",
          multisetHash: "hash_s2_diff_float", // Different hash
          definitionHash: "def_s2",
          previewRows: [{ id: 1, result: 100.500000001 }], // within 1e-6 tolerance of 100.5
        },
      },
    };

    const result = await replayEngine.evaluateReplay(baseManifest, replayedResult, {
      floatTolerance: 1e-6,
    });
    expect(result.outcome).toBe(ReplayOutcome.PARTIALLY_REPRODUCIBLE);
    expect(result.stepVerifications["step_2"].isMatched).toBe(true);
    expect(result.lateDivergenceStepId).toBeNull();
  });

  it("identifies earliest divergence and flags DIVERGENT when outputs differ", async () => {
    const replayedResult: PipelineExecutionResult = {
      version: EXECUTION_CONTRACT_VERSION,
      executionId: "exec_rep_div",
      pipelineId: "pipe_01",
      status: "COMPLETED",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 25,
      topologicalOrder: ["step_1", "step_2"],
      checkpoints: [],
      stepResults: {
        step_1: {
          stepId: "step_1",
          status: "SUCCESS",
          rowCount: 10,
          columnCount: 3,
          durationMs: 10,
          schema: { version: EXECUTION_CONTRACT_VERSION, columns: [], primaryKeys: [] },
          tableName: "t_rep_s1",
          contentHash: "hash_s1_content",
          multisetHash: "hash_s1_multiset",
          definitionHash: "def_s1",
        },
        step_2: {
          stepId: "step_2",
          status: "SUCCESS",
          rowCount: 10,
          columnCount: 4,
          durationMs: 14,
          schema: { version: EXECUTION_CONTRACT_VERSION, columns: [], primaryKeys: [] },
          tableName: "t_rep_s2",
          contentHash: "hash_s2_corrupt",
          multisetHash: "hash_s2_corrupt",
          definitionHash: "def_s2",
          previewRows: [{ id: 1, result: 999.0 }], // gross mismatch
        },
      },
    };

    const result = await replayEngine.evaluateReplay(baseManifest, replayedResult);
    expect(result.outcome).toBe(ReplayOutcome.DIVERGENT);
    expect(result.stepVerifications["step_2"].isMatched).toBe(false);
    expect(result.lateDivergenceStepId).toBe("step_2");
  });

  it("returns FAILED_VERIFICATION when execution aborts prematurely", async () => {
    const replayedResult: PipelineExecutionResult = {
      version: EXECUTION_CONTRACT_VERSION,
      executionId: "exec_rep_fail",
      pipelineId: "pipe_01",
      status: "FAILED",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 8,
      topologicalOrder: ["step_1"],
      checkpoints: [],
      stepResults: {},
      failedStepId: "step_1",
      errorMessage: "Divide by zero in SQL expression",
    };

    const result = await replayEngine.evaluateReplay(baseManifest, replayedResult);
    expect(result.outcome).toBe(ReplayOutcome.FAILED_VERIFICATION);
    expect(result.lateDivergenceStepId).toBe("step_1");
  });

  it("blocks replay and flags BLOCKED_MISSING_ARTIFACTS when input artifacts are missing", async () => {
    // Save manifest with unbacked input artifact
    await storageManager.getIdb().saveRunManifest(baseManifest);

    const result = await replayEngine.replayRun({
      historicalRunId: "run_hist_01",
    });

    expect(result.outcome).toBe(ReplayOutcome.BLOCKED_MISSING_ARTIFACTS);
    expect(result.missingArtifacts).toContain("art_input_1");
  });
});
