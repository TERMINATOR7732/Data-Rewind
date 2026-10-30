/**
 * Data Rewind IndexedDB Storage Foundation.
 * Manages persistent metadata for:
 * - Workspaces
 * - Datasets
 * - Artifact references
 * - Runtime configuration
 */

import { ArtifactReference, DatasetMetadata } from "../contracts/index";
import { ERROR_CODES, RuntimeError } from "../contracts/errors";

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

const DB_NAME = "data_rewind_storage";
const DB_VERSION = 1;

const STORES = {
  WORKSPACES: "workspaces",
  DATASETS: "datasets",
  ARTIFACTS: "artifacts",
  RUNTIME_CONFIG: "runtime_config",
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

      request.onupgradeneeded = (_event) => {
        const db = request.result;
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
