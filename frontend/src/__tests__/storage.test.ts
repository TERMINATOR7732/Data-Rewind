import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  IndexedDBStorage,
  WorkspaceMetadata,
} from "../runtime/storage/indexeddb";
import {
  OpfsArtifactStorage,
} from "../runtime/storage/opfs";
import {
  DatasetMetadata,
  ArtifactReference,
  EXECUTION_CONTRACT_VERSION,
} from "../runtime/contracts/index";
import { ERROR_CODES } from "../runtime/contracts/errors";

describe("IndexedDB Storage Foundation", () => {
  it("detects when IndexedDB is not available in environment", () => {
    const originalIDB = globalThis.indexedDB;
    // @ts-ignore
    delete (globalThis as any).indexedDB;

    expect(IndexedDBStorage.isSupported()).toBe(false);

    // Restore
    if (originalIDB !== undefined) {
      globalThis.indexedDB = originalIDB;
    }
  });

  it("throws STORAGE_UNAVAILABLE error when saving without IndexedDB support", async () => {
    const originalIDB = globalThis.indexedDB;
    // @ts-ignore
    delete (globalThis as any).indexedDB;

    const storage = new IndexedDBStorage();
    const ws: WorkspaceMetadata = {
      workspaceId: "ws_01",
      name: "Workspace 1",
      mode: "DEMO",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      totalDiskBytes: 1024,
    };

    await expect(storage.saveWorkspace(ws)).rejects.toThrowError(
      expect.objectContaining({
        code: ERROR_CODES.STORAGE_UNAVAILABLE,
      })
    );

    if (originalIDB !== undefined) {
      globalThis.indexedDB = originalIDB;
    }
  });

  describe("Mock IndexedDB Full Store Operations", () => {
    let mockStores: Record<string, Map<string, any>>;
    let storage: IndexedDBStorage;

    beforeEach(() => {
      mockStores = {
        workspaces: new Map(),
        datasets: new Map(),
        artifacts: new Map(),
        runtime_config: new Map(),
      };

      const createMockReq = (result: any) => {
        const req: any = {
          result,
          onsuccess: null,
          onerror: null,
        };
        setTimeout(() => {
          if (req.onsuccess) req.onsuccess({ target: req });
        }, 0);
        return req;
      };

      const mockDb: any = {
        objectStoreNames: {
          contains: (_name: string) => true,
        },
        createObjectStore: (_name: string) => ({}),
        transaction: (storeNames: string | string[], _mode: string) => {
          const tx: any = {
            error: null,
            oncomplete: null,
            onerror: null,
            objectStore: (storeName?: string) => {
              const resolvedName =
                storeName ||
                (Array.isArray(storeNames) ? storeNames[0] : storeNames);
              const storeMap = mockStores[resolvedName] || new Map();
              return {
                put: (item: any) => {
                  const key =
                    item.workspaceId ||
                    item.datasetId ||
                    item.artifactId ||
                    item.key;
                  storeMap.set(key, item);
                  return createMockReq(key);
                },
                get: (key: string) => {
                  return createMockReq(storeMap.get(key) || undefined);
                },
                getAll: () => {
                  return createMockReq(Array.from(storeMap.values()));
                },
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

      (globalThis as any).indexedDB = {
        open: (_name: string, _version: number) => {
          const req: any = {
            result: mockDb,
            onsuccess: null,
            onerror: null,
            onupgradeneeded: null,
          };
          setTimeout(() => {
            if (req.onsuccess) req.onsuccess({ target: req });
          }, 0);
          return req;
        },
      };

      storage = new IndexedDBStorage();
    });

    afterEach(() => {
      // @ts-ignore
      delete (globalThis as any).indexedDB;
    });

    it("saves, retrieves, lists, and deletes workspaces", async () => {
      const ws: WorkspaceMetadata = {
        workspaceId: "ws_test_01",
        name: "Test Workspace",
        mode: "CSV_UPLOAD",
        createdAt: "2026-10-30T10:00:00Z",
        updatedAt: "2026-10-30T10:00:00Z",
        totalDiskBytes: 5000,
      };

      await storage.saveWorkspace(ws);
      const retrieved = await storage.getWorkspace("ws_test_01");
      expect(retrieved).toEqual(ws);

      const all = await storage.listWorkspaces();
      expect(all).toHaveLength(1);
      expect(all[0].name).toBe("Test Workspace");

      await storage.deleteWorkspace("ws_test_01");
      const deleted = await storage.getWorkspace("ws_test_01");
      expect(deleted).toBeNull();
    });

    it("saves, retrieves, and lists datasets", async () => {
      const dataset: DatasetMetadata = {
        datasetId: "ds_orders",
        name: "orders.csv",
        rowCount: 100,
        columnCount: 4,
        byteSize: 1200,
        sha256Hash: "abcdef1234567890",
        schema: {
          version: EXECUTION_CONTRACT_VERSION,
          columns: [{ name: "id", dataType: "INTEGER", nullable: false, ordinalPosition: 1 }],
          primaryKeys: ["id"],
        },
        createdAt: "2026-10-30T10:00:00Z",
      };

      await storage.saveDataset(dataset);
      const retrieved = await storage.getDataset("ds_orders");
      expect(retrieved?.datasetId).toBe("ds_orders");
      expect(retrieved?.rowCount).toBe(100);

      const list = await storage.listDatasets();
      expect(list).toHaveLength(1);

      await storage.deleteDataset("ds_orders");
      expect(await storage.getDataset("ds_orders")).toBeNull();
    });

    it("manages artifacts and runtime configuration", async () => {
      const artifact: ArtifactReference = {
        artifactId: "art_01",
        runId: "run_99",
        stepId: "step_filter",
        artifactType: "PARQUET",
        storagePath: "/artifacts/filtered.parquet",
        byteSize: 2048,
        sha256Hash: "hash987",
        createdAt: "2026-10-30T10:00:00Z",
      };

      await storage.saveArtifact(artifact);
      expect((await storage.getArtifact("art_01"))?.runId).toBe("run_99");

      // Runtime config
      await storage.setConfig("engine_preference", "browser");
      expect(await storage.getConfig("engine_preference")).toBe("browser");
      expect(await storage.getConfig("missing_key", "default_val")).toBe("default_val");

      // Purge
      await storage.purgeAll();
      expect(await storage.listWorkspaces()).toHaveLength(0);
      expect(await storage.listDatasets()).toHaveLength(0);
      expect(await storage.listArtifacts()).toHaveLength(0);
    });
  });
});

describe("OPFS Artifact Storage Abstraction", () => {
  it("falls back gracefully to in-memory storage when OPFS is unsupported", async () => {
    const storage = new OpfsArtifactStorage();
    const isAvail = await storage.isAvailable();
    // In node/jsdom test runner, OPFS is not available
    expect(isAvail).toBe(false);

    // Should store and read from in-memory fallback transparently
    const testData = new TextEncoder().encode("parquet-binary-payload-data");
    const bytesWritten = await storage.writeArtifact("sample/test.parquet", testData);
    expect(bytesWritten).toBe(testData.byteLength);

    const readBytes = await storage.readArtifact("sample/test.parquet");
    expect(readBytes).toEqual(testData);

    const files = await storage.listArtifacts();
    expect(files).toContain("sample/test.parquet");

    const deleted = await storage.deleteArtifact("sample/test.parquet");
    expect(deleted).toBe(true);

    const filesAfterDelete = await storage.listArtifacts();
    expect(filesAfterDelete).not.toContain("sample/test.parquet");
  });

  it("handles string write input by encoding to UTF-8 bytes", async () => {
    const storage = new OpfsArtifactStorage();
    await storage.writeArtifact("report.json", '{"status":"ok"}');

    const readBytes = await storage.readArtifact("report.json");
    const decoded = new TextDecoder().decode(readBytes);
    expect(decoded).toBe('{"status":"ok"}');
  });

  it("throws TABLE_NOT_FOUND or TABLE_NOT_FOUND equivalent when file is missing", async () => {
    const storage = new OpfsArtifactStorage();
    await expect(storage.readArtifact("non_existent.parquet")).rejects.toThrowError();
  });
});
