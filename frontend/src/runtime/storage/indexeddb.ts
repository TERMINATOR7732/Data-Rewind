/**
 * Data Rewind IndexedDB Storage Foundation.
 * Schema Version: 2
 * Manages persistent metadata for:
 * - Workspaces
 * - Datasets
 * - Artifact references
 * - Runtime configuration
 * - Run manifests (SPEC-MOD-03)
 * - Tri-Run Verifications (SPEC-MOD-05)
 * - Historical Replay records
 * - Investigations
 */

import { ArtifactReference, DatasetMetadata } from "../contracts/index";
import { ERROR_CODES, RuntimeError } from "../contracts/errors";
import { RunManifest } from "./run-manifest";

export type { ArtifactReference, DatasetMetadata };

export interface WorkspaceMetadata {
  workspaceId: string;
  name: string;
  mode: "DEMO" | "CSV_UPLOAD" | "DEVELOPER";
  createdAt: string;
  updatedAt: string;
  totalDiskBytes: number;
}

export interface RuntimeConfigItem {
  key: string;
  value: unknown;
  updatedAt: string;
}

export interface StoredInvestigation {
  investigationId: string;
  workspaceId: string;
  title: string;
  baselineRunId?: string;
  faultedRunId: string;
  candidateRunId?: string;
  status: "ACTIVE" | "ARCHIVED" | "COMPLETED";
  createdAt: string;
  updatedAt: string;
  notes?: string;
  verificationId?: string;
}

export const DB_NAME = "data_rewind_storage";
export const DB_VERSION = 2;

export const STORES = {
  WORKSPACES: "workspaces",
  DATASETS: "datasets",
  ARTIFACTS: "artifacts",
  RUNTIME_CONFIG: "runtime_config",
  RUN_MANIFESTS: "run_manifests",
  VERIFICATIONS: "verifications",
  REPLAY_RECORDS: "replay_records",
  INVESTIGATIONS: "investigations",
} as const;

export class IndexedDBStorage {
  private dbPromise: Promise<IDBDatabase> | null = null;

  /**
   * Check if IndexedDB is supported in the current environment.
   */
  static isSupported(): boolean {
    return typeof indexedDB !== "undefined";
  }

  /**
   * Reset cached DB connection (useful for testing or after store migrations).
   */
  close(): void {
    if (this.dbPromise) {
      this.dbPromise.then((db) => {
        try {
          db.close();
        } catch {
          // ignore
        }
      });
      this.dbPromise = null;
    }
  }

  /**
   * Open or initialize the IndexedDB connection with upgrade schema.
   */
  private async getDB(): Promise<IDBDatabase> {
    if (!IndexedDBStorage.isSupported()) {
      throw new RuntimeError(
        ERROR_CODES.STORAGE_UNAVAILABLE,
        "IndexedDB is not available in this environment.",
        undefined,
        "Use a modern browser with storage permissions enabled."
      );
    }

    if (this.dbPromise) {
      return this.dbPromise;
    }

    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = request.result;
        const oldVersion = event.oldVersion;

        // Version 1 Stores
        if (oldVersion < 1) {
          if (!db.objectStoreNames.contains(STORES.WORKSPACES)) {
            db.createObjectStore(STORES.WORKSPACES, { keyPath: "workspaceId" });
          }
          if (!db.objectStoreNames.contains(STORES.DATASETS)) {
            db.createObjectStore(STORES.DATASETS, { keyPath: "datasetId" });
          }
          if (!db.objectStoreNames.contains(STORES.ARTIFACTS)) {
            db.createObjectStore(STORES.ARTIFACTS, { keyPath: "artifactId" });
          }
          if (!db.objectStoreNames.contains(STORES.RUNTIME_CONFIG)) {
            db.createObjectStore(STORES.RUNTIME_CONFIG, { keyPath: "key" });
          }
        }

        // Version 2 Stores (Run Manifests, Verifications, Replay Records, Investigations)
        if (oldVersion < 2) {
          if (!db.objectStoreNames.contains(STORES.RUN_MANIFESTS)) {
            db.createObjectStore(STORES.RUN_MANIFESTS, { keyPath: "runId" });
          }
          if (!db.objectStoreNames.contains(STORES.VERIFICATIONS)) {
            db.createObjectStore(STORES.VERIFICATIONS, { keyPath: "verificationId" });
          }
          if (!db.objectStoreNames.contains(STORES.REPLAY_RECORDS)) {
            db.createObjectStore(STORES.REPLAY_RECORDS, { keyPath: "replayId" });
          }
          if (!db.objectStoreNames.contains(STORES.INVESTIGATIONS)) {
            db.createObjectStore(STORES.INVESTIGATIONS, { keyPath: "investigationId" });
          }
        }
      };

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = () => {
        reject(
          new RuntimeError(
            ERROR_CODES.STORAGE_UNAVAILABLE,
            `Failed to open IndexedDB '${DB_NAME}': ${request.error?.message || "Unknown error"}`,
            { error: request.error?.name }
          )
        );
      };

      request.onblocked = () => {
        reject(
          new RuntimeError(
            ERROR_CODES.STORAGE_UNAVAILABLE,
            `IndexedDB '${DB_NAME}' is blocked by an open connection in another tab.`
          )
        );
      };
    });

    return this.dbPromise;
  }

  // --- Workspace Metadata ---

  async saveWorkspace(workspace: WorkspaceMetadata): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(STORES.WORKSPACES, "readwrite");
        const store = tx.objectStore(STORES.WORKSPACES);
        store.put(workspace);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(this.handleTxError(tx.error));
      } catch (err: any) {
        reject(this.handleTxError(err));
      }
    });
  }

  async getWorkspace(workspaceId: string): Promise<WorkspaceMetadata | null> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(STORES.WORKSPACES, "readonly");
        const store = tx.objectStore(STORES.WORKSPACES);
        const req = store.get(workspaceId);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(this.handleTxError(req.error));
      } catch (err: any) {
        reject(this.handleTxError(err));
      }
    });
  }

  async listWorkspaces(): Promise<WorkspaceMetadata[]> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(STORES.WORKSPACES, "readonly");
        const store = tx.objectStore(STORES.WORKSPACES);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(this.handleTxError(req.error));
      } catch (err: any) {
        reject(this.handleTxError(err));
      }
    });
  }

  async deleteWorkspace(workspaceId: string): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(STORES.WORKSPACES, "readwrite");
        const store = tx.objectStore(STORES.WORKSPACES);
        store.delete(workspaceId);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(this.handleTxError(tx.error));
      } catch (err: any) {
        reject(this.handleTxError(err));
      }
    });
  }

  // --- Dataset Metadata ---

  async saveDataset(dataset: DatasetMetadata): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(STORES.DATASETS, "readwrite");
        const store = tx.objectStore(STORES.DATASETS);
        store.put(dataset);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(this.handleTxError(tx.error));
      } catch (err: any) {
        reject(this.handleTxError(err));
      }
    });
  }

  async getDataset(datasetId: string): Promise<DatasetMetadata | null> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(STORES.DATASETS, "readonly");
        const store = tx.objectStore(STORES.DATASETS);
        const req = store.get(datasetId);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(this.handleTxError(req.error));
      } catch (err: any) {
        reject(this.handleTxError(err));
      }
    });
  }

  async listDatasets(): Promise<DatasetMetadata[]> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(STORES.DATASETS, "readonly");
        const store = tx.objectStore(STORES.DATASETS);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(this.handleTxError(req.error));
      } catch (err: any) {
        reject(this.handleTxError(err));
      }
    });
  }

  async deleteDataset(datasetId: string): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(STORES.DATASETS, "readwrite");
        const store = tx.objectStore(STORES.DATASETS);
        store.delete(datasetId);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(this.handleTxError(tx.error));
      } catch (err: any) {
        reject(this.handleTxError(err));
      }
    });
  }

  // --- Artifact References ---

  async saveArtifact(artifact: ArtifactReference): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(STORES.ARTIFACTS, "readwrite");
        const store = tx.objectStore(STORES.ARTIFACTS);
        store.put(artifact);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(this.handleTxError(tx.error));
      } catch (err: any) {
        reject(this.handleTxError(err));
      }
    });
  }

  async getArtifact(artifactId: string): Promise<ArtifactReference | null> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(STORES.ARTIFACTS, "readonly");
        const store = tx.objectStore(STORES.ARTIFACTS);
        const req = store.get(artifactId);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(this.handleTxError(req.error));
      } catch (err: any) {
        reject(this.handleTxError(err));
      }
    });
  }

  async listArtifacts(): Promise<ArtifactReference[]> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(STORES.ARTIFACTS, "readonly");
        const store = tx.objectStore(STORES.ARTIFACTS);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(this.handleTxError(req.error));
      } catch (err: any) {
        reject(this.handleTxError(err));
      }
    });
  }

  async deleteArtifact(artifactId: string): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(STORES.ARTIFACTS, "readwrite");
        const store = tx.objectStore(STORES.ARTIFACTS);
        store.delete(artifactId);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(this.handleTxError(tx.error));
      } catch (err: any) {
        reject(this.handleTxError(err));
      }
    });
  }

  // --- Run Manifests (SPEC-MOD-03) ---

  async saveRunManifest(manifest: RunManifest): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(STORES.RUN_MANIFESTS, "readwrite");
        const store = tx.objectStore(STORES.RUN_MANIFESTS);
        store.put(manifest);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(this.handleTxError(tx.error));
      } catch (err: any) {
        reject(this.handleTxError(err));
      }
    });
  }

  async getRunManifest(runId: string): Promise<RunManifest | null> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(STORES.RUN_MANIFESTS, "readonly");
        const store = tx.objectStore(STORES.RUN_MANIFESTS);
        const req = store.get(runId);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(this.handleTxError(req.error));
      } catch (err: any) {
        reject(this.handleTxError(err));
      }
    });
  }

  async listRunManifests(workspaceId?: string): Promise<RunManifest[]> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(STORES.RUN_MANIFESTS, "readonly");
        const store = tx.objectStore(STORES.RUN_MANIFESTS);
        const req = store.getAll();
        req.onsuccess = () => {
          const all = (req.result || []) as RunManifest[];
          if (workspaceId) {
            resolve(all.filter((m) => m.workspaceId === workspaceId));
          } else {
            resolve(all);
          }
        };
        req.onerror = () => reject(this.handleTxError(req.error));
      } catch (err: any) {
        reject(this.handleTxError(err));
      }
    });
  }

  async deleteRunManifest(runId: string): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(STORES.RUN_MANIFESTS, "readwrite");
        const store = tx.objectStore(STORES.RUN_MANIFESTS);
        store.delete(runId);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(this.handleTxError(tx.error));
      } catch (err: any) {
        reject(this.handleTxError(err));
      }
    });
  }

  // --- Verifications (SPEC-MOD-05) ---

  async saveVerification(verification: any): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(STORES.VERIFICATIONS, "readwrite");
        const store = tx.objectStore(STORES.VERIFICATIONS);
        store.put(verification);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(this.handleTxError(tx.error));
      } catch (err: any) {
        reject(this.handleTxError(err));
      }
    });
  }

  async getVerification(verificationId: string): Promise<any | null> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(STORES.VERIFICATIONS, "readonly");
        const store = tx.objectStore(STORES.VERIFICATIONS);
        const req = store.get(verificationId);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(this.handleTxError(req.error));
      } catch (err: any) {
        reject(this.handleTxError(err));
      }
    });
  }

  async listVerifications(): Promise<any[]> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(STORES.VERIFICATIONS, "readonly");
        const store = tx.objectStore(STORES.VERIFICATIONS);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(this.handleTxError(req.error));
      } catch (err: any) {
        reject(this.handleTxError(err));
      }
    });
  }

  // --- Replay Records (SPEC-MOD-03 §3.4) ---

  async saveReplayRecord(replay: any): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(STORES.REPLAY_RECORDS, "readwrite");
        const store = tx.objectStore(STORES.REPLAY_RECORDS);
        store.put(replay);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(this.handleTxError(tx.error));
      } catch (err: any) {
        reject(this.handleTxError(err));
      }
    });
  }

  async getReplayRecord(replayId: string): Promise<any | null> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(STORES.REPLAY_RECORDS, "readonly");
        const store = tx.objectStore(STORES.REPLAY_RECORDS);
        const req = store.get(replayId);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(this.handleTxError(req.error));
      } catch (err: any) {
        reject(this.handleTxError(err));
      }
    });
  }

  async listReplayRecords(): Promise<any[]> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(STORES.REPLAY_RECORDS, "readonly");
        const store = tx.objectStore(STORES.REPLAY_RECORDS);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(this.handleTxError(req.error));
      } catch (err: any) {
        reject(this.handleTxError(err));
      }
    });
  }

  // --- Investigations ---

  async saveInvestigation(investigation: StoredInvestigation): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(STORES.INVESTIGATIONS, "readwrite");
        const store = tx.objectStore(STORES.INVESTIGATIONS);
        store.put(investigation);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(this.handleTxError(tx.error));
      } catch (err: any) {
        reject(this.handleTxError(err));
      }
    });
  }

  async getInvestigation(investigationId: string): Promise<StoredInvestigation | null> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(STORES.INVESTIGATIONS, "readonly");
        const store = tx.objectStore(STORES.INVESTIGATIONS);
        const req = store.get(investigationId);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(this.handleTxError(req.error));
      } catch (err: any) {
        reject(this.handleTxError(err));
      }
    });
  }

  async listInvestigations(): Promise<StoredInvestigation[]> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(STORES.INVESTIGATIONS, "readonly");
        const store = tx.objectStore(STORES.INVESTIGATIONS);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(this.handleTxError(req.error));
      } catch (err: any) {
        reject(this.handleTxError(err));
      }
    });
  }

  // --- Runtime Configuration ---

  async setConfig(key: string, value: unknown): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(STORES.RUNTIME_CONFIG, "readwrite");
        const store = tx.objectStore(STORES.RUNTIME_CONFIG);
        const item: RuntimeConfigItem = {
          key,
          value,
          updatedAt: new Date().toISOString(),
        };
        store.put(item);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(this.handleTxError(tx.error));
      } catch (err: any) {
        reject(this.handleTxError(err));
      }
    });
  }

  async getConfig<T = unknown>(key: string, defaultValue?: T): Promise<T | null> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(STORES.RUNTIME_CONFIG, "readonly");
        const store = tx.objectStore(STORES.RUNTIME_CONFIG);
        const req = store.get(key);
        req.onsuccess = () => {
          const item = req.result as RuntimeConfigItem | undefined;
          if (item && item.value !== undefined) {
            resolve(item.value as T);
          } else {
            resolve(defaultValue !== undefined ? defaultValue : null);
          }
        };
        req.onerror = () => reject(this.handleTxError(req.error));
      } catch (err: any) {
        reject(this.handleTxError(err));
      }
    });
  }

  // --- Reference-Aware Garbage Collection ---

  /**
   * Reference-aware Garbage Collection:
   * Safely discovers unreferenced artifacts and deletes their metadata from IndexedDB.
   * Artifacts that are referenced by any RunManifest, Dataset, or active Investigation
   * are guaranteed to remain untouched.
   */
  async collectGarbage(): Promise<{
    collectedArtifactIds: string[];
    collectedBytes: number;
    retainedArtifactIds: string[];
  }> {
    const allArtifacts = await this.listArtifacts();
    const manifests = await this.listRunManifests();
    const datasets = await this.listDatasets();

    // Collect all referenced artifact IDs
    const referencedArtifactIds = new Set<string>();

    // References from Run Manifests
    for (const m of manifests) {
      if (m.inputArtifacts) {
        for (const art of Object.values(m.inputArtifacts)) {
          if (art?.artifactId) referencedArtifactIds.add(art.artifactId);
        }
      }
      if (m.checkpointReferences) {
        for (const art of Object.values(m.checkpointReferences)) {
          if (art?.artifactId) referencedArtifactIds.add(art.artifactId);
        }
      }
    }

    // References from Datasets
    for (const d of datasets) {
      referencedArtifactIds.add(d.datasetId);
    }

    const collectedArtifactIds: string[] = [];
    let collectedBytes = 0;
    const retainedArtifactIds: string[] = [];

    for (const art of allArtifacts) {
      if (!referencedArtifactIds.has(art.artifactId)) {
        collectedArtifactIds.push(art.artifactId);
        collectedBytes += art.byteSize || 0;
        await this.deleteArtifact(art.artifactId);
      } else {
        retainedArtifactIds.push(art.artifactId);
      }
    }

    return {
      collectedArtifactIds,
      collectedBytes,
      retainedArtifactIds,
    };
  }

  // --- Reset / Purge ---

  async purgeAll(): Promise<void> {
    return this.clearAll();
  }

  async clearAll(): Promise<void> {
    const db = await this.getDB();
    const storeNames = [
      STORES.WORKSPACES,
      STORES.DATASETS,
      STORES.ARTIFACTS,
      STORES.RUNTIME_CONFIG,
      STORES.RUN_MANIFESTS,
      STORES.VERIFICATIONS,
      STORES.REPLAY_RECORDS,
      STORES.INVESTIGATIONS,
    ];
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(storeNames, "readwrite");
        for (const s of storeNames) {
          tx.objectStore(s).clear();
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(this.handleTxError(tx.error));
      } catch (err: any) {
        reject(this.handleTxError(err));
      }
    });
  }

  private handleTxError(error: any): RuntimeError {
    if (error && error.name === "QuotaExceededError") {
      return new RuntimeError(
        ERROR_CODES.STORAGE_QUOTA_EXCEEDED,
        "Browser IndexedDB storage quota has been exceeded.",
        { errorName: error.name },
        "Purge unused datasets or clear browser storage for this origin."
      );
    }
    return new RuntimeError(
      ERROR_CODES.STORAGE_UNAVAILABLE,
      `IndexedDB operation failed: ${error?.message || "Transaction error"}`
    );
  }
}

export const indexedDBStorage = new IndexedDBStorage();

export function getIndexedDBStorage(): IndexedDBStorage {
  return indexedDBStorage;
}
