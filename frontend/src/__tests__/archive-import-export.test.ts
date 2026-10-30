/**
 * Data Rewind Investigation Archive Import/Export Test Suite.
 * Conforms strictly to SPEC-MOD-05 and security policies.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { ArchiveService } from "../runtime/archive/archive-service";
import { ARCHIVE_FORMAT_VERSION, InvestigationArchiveBundle } from "../runtime/archive/archive-contracts";
import { IndexedDBStorage } from "../runtime/storage/indexeddb";
import { OpfsArtifactStorage } from "../runtime/storage/opfs";
import { StorageManager } from "../runtime/storage/storage-manager";
import { EXECUTION_CONTRACT_VERSION } from "../runtime/contracts/index";
import { computeSHA256 } from "../runtime/storage/run-manifest";

describe("Portable Investigation Archive (Export & Staged Import)", () => {
  let idb: IndexedDBStorage;
  let opfs: OpfsArtifactStorage;
  let storageManager: StorageManager;
  let archiveService: ArchiveService;
  let mockStores: Record<string, Map<string, any>>;

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
                if (resolvedName === "investigations") key = item.investigationId;
                else if (resolvedName === "run_manifests") key = item.runId;
                else if (resolvedName === "artifacts") key = item.artifactId;
                else if (resolvedName === "verifications") key = item.verificationId;
                else key = item.investigationId || item.runId || item.artifactId || item.key;
                storeMap.set(key, item);
                return createMockReq(key);
              },
              get: (key: string) => createMockReq(storeMap.get(key)),
              getAll: () => createMockReq(Array.from(storeMap.values())),
              delete: (key: string) => {
                storeMap.delete(key);
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
    archiveService = new ArchiveService(storageManager);
  });

  it("exports and imports investigation archive bundle round-trip", async () => {
    const rawData = "id,name\n1,Alpha\n2,Beta";
    const dataHash = await computeSHA256(rawData);

    // Save run manifest and artifact in storage
    await storageManager.persistRun(
      {
        version: EXECUTION_CONTRACT_VERSION,
        runId: "run_exp_01",
        workspaceId: "ws_01",
        pipelineId: "pipe_exp",
        pipelineName: "Export Pipeline",
        pipelineDefinitionHash: "def_exp_01",
        runType: "BASELINE",
        status: "COMPLETED",
        executionPlan: {
          planId: "p_01",
          pipelineId: "pipe_exp",
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
        durationMs: 10,
      },
      [
        {
          artifactId: "art_exp_01",
          runId: "run_exp_01",
          stepId: "s1",
          artifactType: "CSV",
          data: rawData,
          sha256Hash: dataHash,
        },
      ]
    );

    // Save investigation record
    await idb.saveInvestigation({
      investigationId: "inv_exp_01",
      workspaceId: "ws_01",
      title: "Archive Test Investigation",
      faultedRunId: "run_exp_01",
      status: "COMPLETED",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // 1. Export archive
    const bundle = await archiveService.exportArchive("inv_exp_01");
    expect(bundle.formatVersion).toBe(ARCHIVE_FORMAT_VERSION);
    expect(bundle.investigation.investigationId).toBe("inv_exp_01");
    expect(bundle.artifacts["art_exp_01"]).toBeDefined();
    expect(bundle.artifacts["art_exp_01"].sha256Hash).toBe(dataHash);

    // 2. Clear storage to simulate new workspace import
    mockStores.investigations.clear();
    mockStores.run_manifests.clear();
    mockStores.artifacts.clear();

    // 3. Import bundle
    const result = await archiveService.importArchive(bundle, {
      conflictStrategy: "FAIL_ON_CONFLICT",
    });

    expect(result.investigationId).toBe("inv_exp_01");
    expect(result.importedRunsCount).toBe(1);
    expect(result.importedArtifactsCount).toBe(1);

    // Verify imported artifact bytes can be read from storage
    const readBytes = await storageManager.readArtifactData("art_exp_01");
    expect(new TextDecoder().decode(readBytes)).toBe(rawData);
  });

  it("strictly rejects path traversal attacks in artifact storage paths", async () => {
    const maliciousBundle: InvestigationArchiveBundle = {
      formatVersion: ARCHIVE_FORMAT_VERSION,
      archiveId: "arch_malicious",
      exportedAt: new Date().toISOString(),
      investigation: {
        investigationId: "inv_malicious",
        workspaceId: "ws_01",
        title: "Attack Test",
        faultedRunId: "r1",
        status: "ACTIVE",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      runManifests: {},
      artifacts: {
        art_bad: {
          reference: {
            artifactId: "art_bad",
            runId: "r1",
            stepId: "s1",
            artifactType: "CSV",
            storagePath: "../../etc/passwd", // PATH TRAVERSAL
            byteSize: 10,
            sha256Hash: "some_hash",
            createdAt: new Date().toISOString(),
          },
          dataBase64: "dGVzdA==",
          sha256Hash: "some_hash",
          byteSize: 4,
        },
      },
      checksums: {},
    };

    await expect(archiveService.importArchive(maliciousBundle)).rejects.toThrowError(
      /violates safe directory traversal/
    );
  });

  it("rejects corrupted or tampered artifact checksums upon import", async () => {
    const rawData = "legitimate data";
    const honestHash = await computeSHA256(rawData);

    const tamperedBundle: InvestigationArchiveBundle = {
      formatVersion: ARCHIVE_FORMAT_VERSION,
      archiveId: "arch_tampered",
      exportedAt: new Date().toISOString(),
      investigation: {
        investigationId: "inv_tampered",
        workspaceId: "ws_01",
        title: "Tampered Test",
        faultedRunId: "r1",
        status: "ACTIVE",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      runManifests: {},
      artifacts: {
        art_tampered: {
          reference: {
            artifactId: "art_tampered",
            runId: "r1",
            stepId: "s1",
            artifactType: "CSV",
            storagePath: "artifacts/test.csv",
            byteSize: rawData.length,
            sha256Hash: honestHash,
            createdAt: new Date().toISOString(),
          },
          dataBase64: Buffer.from("TAMPERED DATA PAYLOAD").toString("base64"), // Payload changed!
          sha256Hash: honestHash, // Hash still claims old data
          byteSize: 21,
        },
      },
      checksums: {},
    };

    await expect(archiveService.importArchive(tamperedBundle)).rejects.toThrowError(
      /Integrity check failed for archived artifact/
    );
  });

  it("resolves conflicts by renaming when RENAME_ON_CONFLICT strategy is selected", async () => {
    // Existing investigation
    await idb.saveInvestigation({
      investigationId: "inv_conflict",
      workspaceId: "ws_01",
      title: "Original Investigation",
      faultedRunId: "r1",
      status: "COMPLETED",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const bundle: InvestigationArchiveBundle = {
      formatVersion: ARCHIVE_FORMAT_VERSION,
      archiveId: "arch_conflict",
      exportedAt: new Date().toISOString(),
      investigation: {
        investigationId: "inv_conflict", // Identical ID
        workspaceId: "ws_01",
        title: "Imported Investigation",
        faultedRunId: "r1",
        status: "COMPLETED",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      runManifests: {},
      artifacts: {},
      checksums: {},
    };

    const res = await archiveService.importArchive(bundle, {
      conflictStrategy: "RENAME_ON_CONFLICT",
    });

    expect(res.investigationId).not.toBe("inv_conflict");
    expect(res.conflictsResolved.length).toBeGreaterThan(0);
  });

  it("aborts when archive size exceeds maximum allowed bytes", async () => {
    const hugeBundleString = JSON.stringify({
      formatVersion: ARCHIVE_FORMAT_VERSION,
      archiveId: "arch_huge",
      investigation: { investigationId: "inv_huge" },
      runManifests: {},
      artifacts: {},
      checksums: {},
    });

    await expect(
      archiveService.importArchive(hugeBundleString, { maxSizeBytes: 10 }) // Limit 10 bytes
    ).rejects.toThrowError(/exceeds safe size limit/);
  });
});
