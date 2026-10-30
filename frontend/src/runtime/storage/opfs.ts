/**
 * Data Rewind Origin Private File System (OPFS) Artifact Storage Abstraction.
 * Supports:
 * - Browser capability detection (navigator.storage.getDirectory)
 * - Safe directory traversal & file handle resolution
 * - Storage quota interrogation via navigator.storage.estimate()
 * - Controlled errors on quota exhaustion or unavailable APIs
 * - In-memory fallback for test runners / environments without OPFS
 */

import { ERROR_CODES, RuntimeError } from "../contracts/errors";

export interface StorageQuotaInfo {
  usedBytes: number;
  quotaBytes: number;
  usagePercentage: number;
}

export interface IArtifactStorage {
  isAvailable(): Promise<boolean>;
  getStorageQuota(): Promise<StorageQuotaInfo | null>;
  writeArtifact(filePath: string, data: Uint8Array | string): Promise<number>;
  readArtifact(filePath: string): Promise<Uint8Array>;
  deleteArtifact(filePath: string): Promise<boolean>;
  listArtifacts(dirPath?: string): Promise<string[]>;
}

export class OpfsArtifactStorage implements IArtifactStorage {
  private inMemoryFallback: Map<string, Uint8Array> = new Map();
  private opfsAvailable: boolean | null = null;

  /**
   * Detect whether OPFS is available and functioning in the current execution context.
   */
  async isAvailable(): Promise<boolean> {
    if (this.opfsAvailable !== null) {
      return this.opfsAvailable;
    }

    try {
      if (
        typeof navigator !== "undefined" &&
        navigator.storage &&
        typeof navigator.storage.getDirectory === "function"
      ) {
        const root = await navigator.storage.getDirectory();
        // Probe test directory to verify read/write permission
        await root.getFileHandle("__probe_test__", {
          create: true,
        });
        await root.removeEntry("__probe_test__");
        this.opfsAvailable = true;
        return true;
      }
    } catch {
      // OPFS blocked by security policy, incognito, or sandboxed iframe
      this.opfsAvailable = false;
      return false;
    }

    this.opfsAvailable = false;
    return false;
  }

  /**
   * Retrieve storage quota metrics from browser.
   */
  async getStorageQuota(): Promise<StorageQuotaInfo | null> {
    try {
      if (typeof navigator !== "undefined" && navigator.storage?.estimate) {
        const estimate = await navigator.storage.estimate();
        const usedBytes = estimate.usage ?? 0;
        const quotaBytes = estimate.quota ?? 0;
        const usagePercentage =
          quotaBytes > 0 ? Math.round((usedBytes / quotaBytes) * 100) : 0;
        return { usedBytes, quotaBytes, usagePercentage };
      }
    } catch {
      // Quota interrogation unsupported
    }
    return null;
  }

  /**
   * Write binary or string data to an artifact path in OPFS.
   */
  async writeArtifact(
    filePath: string,
    data: Uint8Array | string
  ): Promise<number> {
    const bytes =
      typeof data === "string" ? new TextEncoder().encode(data) : data;

    const available = await this.isAvailable();
    if (!available) {
      // Use in-memory fallback so artifacts are never silently discarded
      this.inMemoryFallback.set(filePath, bytes);
      return bytes.byteLength;
    }

    try {
      const root = await navigator.storage.getDirectory();
      const parts = filePath.split("/").filter(Boolean);
      const filename = parts.pop();
      if (!filename) {
        throw new RuntimeError(
          ERROR_CODES.STORAGE_UNAVAILABLE,
          `Invalid artifact file path '${filePath}'.`
        );
      }

      // Navigate or create subdirectories
      let currentDir = root;
      for (const dirName of parts) {
        currentDir = await currentDir.getDirectoryHandle(dirName, {
          create: true,
        });
      }

      const fileHandle = await currentDir.getFileHandle(filename, {
        create: true,
      });

      // Write using Writable stream
      const writable = await fileHandle.createWritable();
      await writable.write(bytes);
      await writable.close();

      return bytes.byteLength;
    } catch (err: any) {
      if (err?.name === "QuotaExceededError") {
        throw new RuntimeError(
          ERROR_CODES.STORAGE_QUOTA_EXCEEDED,
          `OPFS storage quota exceeded while writing artifact '${filePath}'.`,
          { filePath, byteLength: bytes.byteLength },
          "Purge existing runs or free disk space on this device."
        );
      }
      throw new RuntimeError(
        ERROR_CODES.STORAGE_UNAVAILABLE,
        `Failed to write artifact to OPFS: ${err?.message || "Storage error"}`,
        { filePath }
      );
    }
  }

  /**
   * Read artifact bytes from OPFS.
   */
  async readArtifact(filePath: string): Promise<Uint8Array> {
    const available = await this.isAvailable();
    if (!available) {
      const mem = this.inMemoryFallback.get(filePath);
      if (!mem) {
        throw new RuntimeError(
          ERROR_CODES.STORAGE_UNAVAILABLE,
          `Artifact '${filePath}' not found in storage.`
        );
      }
      return mem;
    }

    try {
      const root = await navigator.storage.getDirectory();
      const parts = filePath.split("/").filter(Boolean);
      const filename = parts.pop();
      if (!filename) {
        throw new RuntimeError(
          ERROR_CODES.STORAGE_UNAVAILABLE,
          `Invalid artifact path: ${filePath}`
        );
      }

      let currentDir = root;
      for (const dirName of parts) {
        currentDir = await currentDir.getDirectoryHandle(dirName);
      }

      const fileHandle = await currentDir.getFileHandle(filename);
      const file = await fileHandle.getFile();
      const arrayBuffer = await file.arrayBuffer();
      return new Uint8Array(arrayBuffer);
    } catch (err: any) {
      throw new RuntimeError(
        ERROR_CODES.STORAGE_UNAVAILABLE,
        `Failed to read artifact '${filePath}': ${err?.message || "File not found"}`
      );
    }
  }

  /**
   * Delete artifact by path.
   */
  async deleteArtifact(filePath: string): Promise<boolean> {
    const available = await this.isAvailable();
    if (!available) {
      return this.inMemoryFallback.delete(filePath);
    }

    try {
      const root = await navigator.storage.getDirectory();
      const parts = filePath.split("/").filter(Boolean);
      const filename = parts.pop();
      if (!filename) return false;

      let currentDir = root;
      for (const dirName of parts) {
        currentDir = await currentDir.getDirectoryHandle(dirName);
      }

      await currentDir.removeEntry(filename);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List artifact paths recursively.
   */
  async listArtifacts(dirPath: string = ""): Promise<string[]> {
    const available = await this.isAvailable();
    if (!available) {
      return Array.from(this.inMemoryFallback.keys()).filter((k) =>
        dirPath ? k.startsWith(dirPath) : true
      );
    }

    try {
      const root = await navigator.storage.getDirectory();
      const results: string[] = [];

      let startDir = root;
      if (dirPath) {
        const parts = dirPath.split("/").filter(Boolean);
        for (const p of parts) {
          startDir = await startDir.getDirectoryHandle(p);
        }
      }

      async function scan(
        dir: FileSystemDirectoryHandle,
        prefix: string
      ): Promise<void> {
        // @ts-ignore - entries() is standard on modern FileSystemDirectoryHandle
        for await (const [name, handle] of dir.entries()) {
          const entryPath = prefix ? `${prefix}/${name}` : name;
          if (handle.kind === "file") {
            results.push(entryPath);
          } else if (handle.kind === "directory") {
            await scan(handle as FileSystemDirectoryHandle, entryPath);
          }
        }
      }

      await scan(startDir, dirPath);
      return results;
    } catch {
      return [];
    }
  }
}

export const opfsStorage = new OpfsArtifactStorage();

export function getArtifactStorage(): OpfsArtifactStorage {
  return opfsStorage;
}
