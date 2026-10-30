/**
 * Data Rewind Storage Manager.
 * High-level coordinator between IndexedDB metadata and OPFS artifact storage.
 * Handles:
 * - Atomic run saves with staged writes
 * - Checksum verification
 * - Quota preflight checks & telemetry
 * - Reference-aware cleanup
 */

import { ERROR_CODES, RuntimeError } from "../contracts/errors";
import { IndexedDBStorage, indexedDBStorage } from "./indexeddb";
import { IArtifactStorage, OpfsArtifactStorage, StorageQuotaInfo } from "./opfs";
import { RunManifest, StagedWriteArtifact, StagedWriteCoordinator, verifyArtifactChecksum } from "./run-manifest";

export interface WorkspaceStorageTelemetry {
  workspaceId: string;
  totalArtifacts: number;
  totalDiskBytes: number;
  unverifiedArtifactsCount: number;
  quota?: StorageQuotaInfo | null;
}

export class StorageManager {
  private coordinator: StagedWriteCoordinator;

  constructor(
    private idb: IndexedDBStorage = indexedDBStorage,
    private opfs: IArtifactStorage = new OpfsArtifactStorage()
  ) {
    this.coordinator = new StagedWriteCoordinator(this.idb, this.opfs);
  }

  getIdb(): IndexedDBStorage {
    return this.idb;
  }

  getOpfs(): IArtifactStorage {
    return this.opfs;
  }

  /**
   * Save a completed run atomically:
   * Writes all artifact binaries to OPFS, verifies checksums, then commits manifest to IndexedDB.
   */
  async persistRun(
    manifest: RunManifest,
    artifacts: StagedWriteArtifact[]
  ): Promise<{ writtenBytes: number; manifest: RunManifest }> {
    return this.coordinator.commitRunManifest(manifest, artifacts);
  }

  /**
   * Retrieve a run manifest by ID.
   */
  async getRunManifest(runId: string): Promise<RunManifest | null> {
    return this.idb.getRunManifest(runId);
  }

  /**
   * List all run manifests, optionally filtered by workspace.
   */
  async listRunManifests(workspaceId?: string): Promise<RunManifest[]> {
    return this.idb.listRunManifests(workspaceId);
  }

  /**
   * Verify all artifacts associated with a run manifest.
   */
  async verifyRunArtifacts(
    runId: string
  ): Promise<{ allValid: boolean; missingOrCorrupt: string[] }> {
    const manifest = await this.idb.getRunManifest(runId);
    if (!manifest) {
      throw new RuntimeError(
        ERROR_CODES.STORAGE_UNAVAILABLE,
        `Run manifest '${runId}' not found.`
      );
    }

    const missingOrCorrupt: string[] = [];
    const allRefs = [
      ...Object.values(manifest.inputArtifacts || {}),
      ...Object.values(manifest.checkpointReferences || {}),
    ];

    for (const ref of allRefs) {
      if (!ref) continue;
      const valid = await verifyArtifactChecksum(this.opfs, ref);
      if (!valid) {
        missingOrCorrupt.push(ref.artifactId);
      }
    }

    return {
      allValid: missingOrCorrupt.length === 0,
      missingOrCorrupt,
    };
  }

  /**
   * Read raw artifact bytes by artifact ID.
   */
  async readArtifactData(artifactId: string): Promise<Uint8Array> {
    const ref = await this.idb.getArtifact(artifactId);
    if (!ref) {
      throw new RuntimeError(
        ERROR_CODES.STORAGE_UNAVAILABLE,
        `Artifact metadata '${artifactId}' not found in registry.`
      );
    }
    return this.opfs.readArtifact(ref.storagePath);
  }

  /**
   * Interrogate storage telemetry for a workspace.
   */
  async getTelemetry(workspaceId: string): Promise<WorkspaceStorageTelemetry> {
    const manifests = await this.idb.listRunManifests(workspaceId);
    const quota = await this.opfs.getStorageQuota();

    const artifactSet = new Set<string>();
    let totalBytes = 0;
    let unverifiedCount = 0;

    for (const m of manifests) {
      const refs = [
        ...Object.values(m.inputArtifacts || {}),
        ...Object.values(m.checkpointReferences || {}),
      ];
      for (const r of refs) {
        if (!r || artifactSet.has(r.artifactId)) continue;
        artifactSet.add(r.artifactId);
        totalBytes += r.byteSize || 0;
      }
    }

    return {
      workspaceId,
      totalArtifacts: artifactSet.size,
      totalDiskBytes: totalBytes,
      unverifiedArtifactsCount: unverifiedCount,
      quota,
    };
  }

  /**
   * Reference-aware Garbage Collection:
   * Prunes unreferenced artifacts while strictly safeguarding artifacts required by active runs and investigations.
   */
  async collectGarbage(): Promise<{
    collectedArtifactIds: string[];
    collectedBytes: number;
    retainedArtifactIds: string[];
  }> {
    const result = await this.idb.collectGarbage();
    // Also delete the underlying storage files for collected artifacts
    for (const artId of result.collectedArtifactIds) {
      try {
        const ref = await this.idb.getArtifact(artId);
        if (ref?.storagePath) {
          await this.opfs.deleteArtifact(ref.storagePath);
        }
      } catch {
        // Continue cleanup
      }
    }
    return result;
  }
}

export const storageManager = new StorageManager();
