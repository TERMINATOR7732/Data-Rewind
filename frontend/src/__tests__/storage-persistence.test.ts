/**
 * Data Rewind Storage Persistence & Evidence Lifecycle Tests.
 * Conforms strictly to SPEC-MOD-02 §4 and SPEC-MOD-03 §3.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { IndexedDBStorage } from "../runtime/storage/indexeddb";
import { OpfsArtifactStorage } from "../runtime/storage/opfs";
import { StorageManager } from "../runtime/storage/storage-manager";
import {
  computeSHA256,
  RunManifest,
  StagedWriteArtifact,
} from "../runtime/storage/run-manifest";
import { EXECUTION_CONTRACT_VERSION } from "../runtime/contracts/index";

describe("Storage Persistence & Evidence Lifecycle", () => {
  let mockStores: Record<string, Map<string, any>>;
  let idb: IndexedDBStorage;
  let opfs: OpfsArtifactStorage;
  let storageManager: StorageManager;

  beforeEach(() => {
    mockStores = {
      workspaces: new Map(),
      datasets: new Map(),
      artifacts: new Map(),
      runtime_config: new Map(),
      run_manifests: new Map(),
      verifications: new Map(),
      replay_records: new Map(),
      investigations: new Map(),
    };

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
      transaction: (storeNames: string | string[]) => {
        const tx: any = {
          error: null,
          oncomplete: null,
          onerror: null,
          objectStore: (storeName?: string) => {
            const resolvedName =
              storeName || (Array.isArray(storeNames) ? storeNames[0] : storeNames);
            const storeMap = mockStores[resolvedName] || new Map();
            return {
              put: (item: any) => {
                let key: string;
                if (resolvedName === "run_manifests") key = item.runId;
                else if (resolvedName === "workspaces") key = item.workspaceId;
                else if (resolvedName === "datasets") key = item.datasetId;
                else if (resolvedName === "artifacts") key = item.artifactId;
                else if (resolvedName === "verifications") key = item.verificationId;
                else if (resolvedName === "replay_records") key = item.replayId;
                else if (resolvedName === "investigations") key = item.investigationId;
                else if (resolvedName === "runtime_config") key = item.key;
                else key = item.runId || item.workspaceId || item.artifactId || item.key;
                storeMap.set(key, item);
                return createMockReq(key);
              },
              get: (key: string) => createMockReq(storeMap.get(key)),
              getAll: () => createMockReq(Array.from(storeMap.values())),
              delete: (key: string) => {
                storeMap.delete(key);
                return createMockReq(undefined);
              },
              clear: () => {
                storeMap.clear();
                return createMockReq(undefined);
              },
            };
          },
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
  });

  it("computes deterministic SHA-256 checksums", async () => {
    const data = "test-payload-data";
    const hash1 = await computeSHA256(data);
    const hash2 = await computeSHA256(data);
    expect(hash1).toBe(hash2);
    expect(hash1.length).toBe(64);
  });

  it("persists run manifest with atomic staged writes", async () => {
    const rawData = "col_a,col_b\n1,2\n3,4";
    const hash = await computeSHA256(rawData);

    const manifest: RunManifest = {
      version: EXECUTION_CONTRACT_VERSION,
      runId: "run_test_01",
      workspaceId: "ws_01",
      pipelineId: "pipe_01",
      pipelineName: "Test Pipeline",
      pipelineDefinitionHash: "def_hash_01",
      runType: "BASELINE",
      status: "COMPLETED",
      executionPlan: {
        planId: "p_01",
        pipelineId: "pipe_01",
        topologicalOrder: ["s1"],
        stages: [["s1"]],
        stepInputs: { s1: [] },
        plannedAt: new Date().toISOString(),
        tieBreakerApplied: false,
      },
      inputArtifacts: {},
      stepsSnapshot: {
        s1: {
          stepId: "s1",
          status: "SUCCESS",
          rowCount: 2,
          columnCount: 2,
          durationMs: 5,
          schema: { version: EXECUTION_CONTRACT_VERSION, columns: [], primaryKeys: [] },
          tableName: "t_s1",
          contentHash: hash,
          multisetHash: hash,
          definitionHash: "def_s1",
        },
      },
      checkpointReferences: {},
      missingEvidence: [],
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 10,
    };

    const stagedArtifacts: StagedWriteArtifact[] = [
      {
        artifactId: "art_01",
        runId: "run_test_01",
        stepId: "s1",
        artifactType: "CSV",
        data: rawData,
        sha256Hash: hash,
      },
    ];

    const { writtenBytes, manifest: committed } = await storageManager.persistRun(
      manifest,
      stagedArtifacts
    );

    expect(writtenBytes).toBe(new TextEncoder().encode(rawData).byteLength);
    expect(committed.checkpointReferences["art_01"]).toBeDefined();

    // Verify retrieval from storage
    const retrieved = await storageManager.getRunManifest("run_test_01");
    expect(retrieved).not.toBeNull();
    expect(retrieved?.runId).toBe("run_test_01");

    // Verify artifact checksum
    const check = await storageManager.verifyRunArtifacts("run_test_01");
    expect(check.allValid).toBe(true);
    expect(check.missingOrCorrupt).toHaveLength(0);
  });

  it("detects corrupted content when artifact checksum mismatches", async () => {
    const rawData = "good data";

    // Staged write with bad hash expectation
    const staged: StagedWriteArtifact[] = [
      {
        artifactId: "art_corrupt",
        runId: "run_corrupt",
        stepId: "s1",
        artifactType: "CSV",
        data: rawData,
        sha256Hash: "bad_sha256_hash_that_does_not_match_payload_bytes_0000000000000000",
      },
    ];

    const manifest: RunManifest = {
      version: EXECUTION_CONTRACT_VERSION,
      runId: "run_corrupt",
      workspaceId: "ws_01",
      pipelineId: "pipe_01",
      pipelineName: "Corrupt Pipeline",
      pipelineDefinitionHash: "def_01",
      runType: "BASELINE",
      status: "COMPLETED",
      executionPlan: {
        planId: "p_01",
        pipelineId: "pipe_01",
        topologicalOrder: ["s1"],
        stages: [["s1"]],
        stepInputs: { s1: [] },
        plannedAt: new Date().toISOString(),
        tieBreakerApplied: false,
      },
      inputArtifacts: {},
      stepsSnapshot: {},
      checkpointReferences: {},
      missingEvidence: [],
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 5,
    };

    await expect(storageManager.persistRun(manifest, staged)).rejects.toThrowError(
      /Integrity verification failed/
    );

    // Ensure rollback: manifest was NOT committed to IndexedDB
    const retrieved = await storageManager.getRunManifest("run_corrupt");
    expect(retrieved).toBeNull();
  });

  it("safely collects unreferenced garbage without deleting active artifacts", async () => {
    const dataA = "active artifact data";
    const hashA = await computeSHA256(dataA);

    const dataOrphan = "orphan unreferenced data";
    const hashOrphan = await computeSHA256(dataOrphan);

    // Save active artifact
    await storageManager.persistRun(
      {
        version: EXECUTION_CONTRACT_VERSION,
        runId: "run_active",
        workspaceId: "ws_01",
        pipelineId: "pipe_01",
        pipelineName: "Active Pipeline",
        pipelineDefinitionHash: "def_01",
        runType: "BASELINE",
        status: "COMPLETED",
        executionPlan: {
          planId: "p_01",
          pipelineId: "pipe_01",
          topologicalOrder: ["s1"],
          stages: [["s1"]],
          stepInputs: { s1: [] },
          plannedAt: new Date().toISOString(),
          tieBreakerApplied: false,
        },
        inputArtifacts: {},
        stepsSnapshot: {},
        checkpointReferences: {},
        missingEvidence: [],
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: 5,
      },
      [
        {
          artifactId: "art_active",
          runId: "run_active",
          stepId: "s1",
          artifactType: "CSV",
          data: dataA,
          sha256Hash: hashA,
        },
      ]
    );

    // Save orphan artifact directly to registry without linking to any run manifest
    await opfs.writeArtifact(`artifacts/${hashOrphan}.csv`, dataOrphan);
    await idb.saveArtifact({
      artifactId: "art_orphan",
      runId: "old_deleted_run",
      stepId: "s_orphan",
      artifactType: "CSV",
      storagePath: `artifacts/${hashOrphan}.csv`,
      byteSize: dataOrphan.length,
      sha256Hash: hashOrphan,
      createdAt: new Date().toISOString(),
    });

    // Run reference-aware garbage collection
    const gcResult = await storageManager.collectGarbage();

    expect(gcResult.collectedArtifactIds).toContain("art_orphan");
    expect(gcResult.retainedArtifactIds).toContain("art_active");

    // Verify art_active still exists in registry
    const activeRef = await idb.getArtifact("art_active");
    expect(activeRef).not.toBeNull();

    // Verify orphan was deleted
    const orphanRef = await idb.getArtifact("art_orphan");
    expect(orphanRef).toBeNull();
  });
});
