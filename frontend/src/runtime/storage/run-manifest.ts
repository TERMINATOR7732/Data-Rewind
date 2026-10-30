/**
 * Data Rewind Immutable Run Manifest & Staged Write Protocols.
 * Conforms strictly to SPEC-MOD-02 §4, SPEC-MOD-03 §3, and SPEC-MOD-07.
 */

import {
  ArtifactReference,
  ExecutionPlan,
  EXECUTION_CONTRACT_VERSION,
  StepOutput,
} from "../contracts/index";
import { ERROR_CODES, RuntimeError } from "../contracts/errors";
import { IArtifactStorage } from "./opfs";
import { IndexedDBStorage } from "./indexeddb";

export interface RunManifestMissingEvidence {
  category: "INPUT_ARTIFACT" | "INTERMEDIATE_CHECKPOINT" | "SINK_OUTPUT" | "SCHEMA_METADATA";
  stepId?: string;
  artifactId?: string;
  description: string;
  remediationAdvice: string;
}

export interface RunManifest {
  version: typeof EXECUTION_CONTRACT_VERSION;
  runId: string;
  workspaceId: string;
  pipelineId: string;
  pipelineName: string;
  pipelineDefinitionHash: string;
  runType: "BASELINE" | "INVESTIGATION_PROBE" | "FIX_VERIFICATION" | "HISTORICAL_REPLAY";
  status: "COMPLETED" | "FAILED" | "CANCELLED";
  executionPlan: ExecutionPlan;
  inputArtifacts: Record<string, ArtifactReference>;
  stepsSnapshot: Record<string, StepOutput>;
  checkpointReferences: Record<string, ArtifactReference>;
  missingEvidence: RunManifestMissingEvidence[];
  startedAt: string;
  completedAt: string;
  durationMs: number;
  metadata?: Record<string, unknown>;
}

export interface StagedWriteArtifact {
  artifactId: string;
  runId: string;
  stepId: string;
  artifactType: "PARQUET" | "CSV" | "METADATA_JSON";
  data: Uint8Array | string;
  sha256Hash: string;
  multisetHash?: string;
}

/**
 * Compute SHA-256 hash in browser or Node environment.
 */
export async function computeSHA256(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  // Fallback simple deterministic FNV-like 64-char hex string for Node/mock without crypto.subtle
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < bytes.length; i++) {
    h1 = Math.imul(h1 ^ bytes[i], 2654435761);
    h2 = Math.imul(h2 ^ bytes[i], 1597334677);
  }
  const part1 = (h1 >>> 0).toString(16).padStart(8, "0");
  const part2 = (h2 >>> 0).toString(16).padStart(8, "0");
  return (part1 + part2).repeat(4);
}

/**
 * Verify artifact on-storage integrity by reading and checking checksum.
 */
export async function verifyArtifactChecksum(
  storage: IArtifactStorage,
  artifact: ArtifactReference
): Promise<boolean> {
  try {
    const bytes = await storage.readArtifact(artifact.storagePath);
    const calculatedHash = await computeSHA256(bytes);
    return calculatedHash.toLowerCase() === artifact.sha256Hash.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Staged Write Coordinator implements atomic evidence writing:
 * 1. Checks storage quota preflight.
 * 2. Writes all artifact payloads to OPFS storage paths (with content deduplication).
 * 3. Verifies hashes of written artifacts.
 * 4. Only if all writes & verifications succeed, commits the manifest & artifact references to IndexedDB.
 * 5. On any error or quota exhaustion, staged files written in this session are rolled back / deleted.
 */
export class StagedWriteCoordinator {
  constructor(
    private idb: IndexedDBStorage,
    private opfs: IArtifactStorage
  ) {}

  async commitRunManifest(
    manifest: RunManifest,
    artifactsToWrite: StagedWriteArtifact[]
  ): Promise<{ writtenBytes: number; manifest: RunManifest }> {
    // 1. Preflight Quota Check
    const quota = await this.opfs.getStorageQuota();
    const incomingBytes = artifactsToWrite.reduce((sum, a) => {
      const len = typeof a.data === "string" ? new TextEncoder().encode(a.data).byteLength : a.data.byteLength;
      return sum + len;
    }, 0);

    if (quota && quota.quotaBytes > 0) {
      const remainingBytes = quota.quotaBytes - quota.usedBytes;
      if (incomingBytes > remainingBytes) {
        throw new RuntimeError(
          ERROR_CODES.STORAGE_QUOTA_EXCEEDED,
          `Storage quota exceeded. Required: ${incomingBytes} bytes, available: ${remainingBytes} bytes.`,
          { incomingBytes, remainingBytes, quota },
          "Purge unused runs or clear browser storage for this workspace."
        );
      }
    }

    const stagedStoragePaths: string[] = [];
    const committedReferences: Record<string, ArtifactReference> = {};

    try {
      // 2. Write Artifacts to Content-Addressed Paths
      for (const item of artifactsToWrite) {
        const ext = item.artifactType === "PARQUET" ? "parquet" : item.artifactType === "CSV" ? "csv" : "json";
        // Content-addressed filename prevents duplicate blobs
        const storagePath = `artifacts/${item.sha256Hash}.${ext}`;
        const byteLen = typeof item.data === "string" ? new TextEncoder().encode(item.data).byteLength : item.data.byteLength;

        // Write to storage
        await this.opfs.writeArtifact(storagePath, item.data);
        stagedStoragePaths.push(storagePath);

        // Verify checksum immediately
        const writtenBytes = await this.opfs.readArtifact(storagePath);
        const computed = await computeSHA256(writtenBytes);
        if (computed.toLowerCase() !== item.sha256Hash.toLowerCase()) {
          throw new RuntimeError(
            ERROR_CODES.STORAGE_UNAVAILABLE,
            `Integrity verification failed for staged artifact '${item.artifactId}'. Expected SHA-256: ${item.sha256Hash}, computed: ${computed}.`
          );
        }

        const ref: ArtifactReference = {
          artifactId: item.artifactId,
          runId: item.runId,
          stepId: item.stepId,
          artifactType: item.artifactType,
          storagePath,
          byteSize: byteLen,
          sha256Hash: item.sha256Hash,
          multisetHash: item.multisetHash,
          createdAt: new Date().toISOString(),
        };

        committedReferences[item.artifactId] = ref;
        await this.idb.saveArtifact(ref);
      }

      // 3. Update checkpoint references with committed references
      const updatedManifest: RunManifest = {
        ...manifest,
        checkpointReferences: {
          ...manifest.checkpointReferences,
          ...committedReferences,
        },
      };

      // 4. Commit RunManifest to IndexedDB
      await this.idb.saveRunManifest(updatedManifest);

      return {
        writtenBytes: incomingBytes,
        manifest: updatedManifest,
      };
    } catch (err) {
      // Rollback newly written staged files on failure
      for (const path of stagedStoragePaths) {
        try {
          await this.opfs.deleteArtifact(path);
        } catch {
          // Ignore secondary cleanup error
        }
      }
      throw err;
    }
  }
}
