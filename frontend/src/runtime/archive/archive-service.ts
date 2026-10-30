/**
 * Data Rewind Portable Investigation Archive Service.
 * Implements:
 * - Exporting portable investigation archives (.drz / JSON bundles)
 * - Staged importing with strict path traversal, payload size, checksum, and DAG validation
 * - Conflict handling ("FAIL_ON_CONFLICT" | "RENAME_ON_CONFLICT" | "OVERWRITE")
 */

import { ERROR_CODES, RuntimeError } from "../contracts/errors";
import { validatePipeline } from "../pipeline/dag-validator";
import { computeSHA256, RunManifest } from "../storage/run-manifest";
import { StorageManager, storageManager } from "../storage/storage-manager";
import {
  ARCHIVE_FORMAT_VERSION,
  ArchivedArtifact,
  ArchiveImportOptions,
  ArchiveImportResult,
  InvestigationArchiveBundle,
  MAX_UNCOMPRESSED_ARCHIVE_BYTES,
} from "./archive-contracts";

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(base64, "base64"));
  }
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export class ArchiveService {
  constructor(private storage: StorageManager = storageManager) {}

  /**
   * Export an investigation archive bundle.
   */
  async exportArchive(investigationId: string): Promise<InvestigationArchiveBundle> {
    const idb = this.storage.getIdb();
    const investigation = await idb.getInvestigation(investigationId);
    if (!investigation) {
      throw new RuntimeError(
        ERROR_CODES.STORAGE_UNAVAILABLE,
        `Investigation '${investigationId}' not found.`
      );
    }

    const runIds = [
      investigation.baselineRunId,
      investigation.faultedRunId,
      investigation.candidateRunId,
    ].filter(Boolean) as string[];

    const runManifests: Record<string, RunManifest> = {};
    const artifacts: Record<string, ArchivedArtifact> = {};
    const checksums: Record<string, string> = {};

    for (const rid of runIds) {
      const manifest = await idb.getRunManifest(rid);
      if (manifest) {
        runManifests[rid] = manifest;

        // Collect all referenced artifacts
        const allRefs = [
          ...Object.values(manifest.inputArtifacts || {}),
          ...Object.values(manifest.checkpointReferences || {}),
        ];

        for (const ref of allRefs) {
          if (!ref || artifacts[ref.artifactId]) continue;
          try {
            const dataBytes = await this.storage.readArtifactData(ref.artifactId);
            const b64 = bytesToBase64(dataBytes);
            const hash = await computeSHA256(dataBytes);

            artifacts[ref.artifactId] = {
              reference: ref,
              dataBase64: b64,
              sha256Hash: hash,
              byteSize: dataBytes.byteLength,
            };
            checksums[ref.artifactId] = hash;
          } catch {
            // If artifact binary is missing from OPFS, record in checksums as MISSING
            checksums[ref.artifactId] = "MISSING";
          }
        }
      }
    }

    const dossier = investigation.verificationId
      ? await idb.getVerification(investigation.verificationId)
      : undefined;

    const archiveBundle: InvestigationArchiveBundle = {
      formatVersion: ARCHIVE_FORMAT_VERSION,
      archiveId:
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `archive_${Date.now()}`,
      exportedAt: new Date().toISOString(),
      investigation,
      dossier: dossier || undefined,
      runManifests,
      artifacts,
      checksums,
    };

    return archiveBundle;
  }

  /**
   * Validate and import an investigation archive bundle.
   */
  async importArchive(
    bundleData: string | InvestigationArchiveBundle,
    options: ArchiveImportOptions = {}
  ): Promise<ArchiveImportResult> {
    const maxBytes = options.maxSizeBytes ?? MAX_UNCOMPRESSED_ARCHIVE_BYTES;
    const conflictStrategy = options.conflictStrategy || "RENAME_ON_CONFLICT";

    // 1. Uncompressed Size Check
    if (typeof bundleData === "string") {
      const byteLen = new TextEncoder().encode(bundleData).byteLength;
      if (byteLen > maxBytes) {
        throw new RuntimeError(
          "ARCHIVE_TOO_LARGE",
          `Archive bundle exceeds safe size limit (${byteLen} > ${maxBytes} bytes).`,
          { byteLen, maxBytes },
          "Increase import limit or remove large intermediate checkpoints."
        );
      }
    }

    const bundle: InvestigationArchiveBundle =
      typeof bundleData === "string" ? JSON.parse(bundleData) : bundleData;

    // 2. Format Version Validation
    if (!bundle || bundle.formatVersion !== ARCHIVE_FORMAT_VERSION) {
      throw new RuntimeError(
        "INVALID_ARCHIVE_FORMAT",
        `Unsupported archive version: ${bundle?.formatVersion || "unknown"}. Expected: ${ARCHIVE_FORMAT_VERSION}`
      );
    }

    if (!bundle.investigation || !bundle.runManifests) {
      throw new RuntimeError(
        "INVALID_ARCHIVE_PAYLOAD",
        "Archive is missing required investigation or runManifests structures."
      );
    }

    // 3. Security Sanity: Path Traversal Prevention
    for (const [artId, art] of Object.entries(bundle.artifacts || {})) {
      const storagePath = art.reference?.storagePath || "";
      if (
        storagePath.includes("..") ||
        storagePath.includes("\\") ||
        storagePath.startsWith("/") ||
        storagePath.includes("\0") ||
        /^[a-zA-Z]:/.test(storagePath)
      ) {
        throw new RuntimeError(
          "MALICIOUS_PATH_DETECTED",
          `Archive artifact path '${storagePath}' violates safe directory traversal policies.`,
          { artifactId: artId, storagePath }
        );
      }
    }

    // 4. Integrity Check: SHA-256 Checksum Verification
    if (!options.skipChecksumVerification) {
      for (const [artId, art] of Object.entries(bundle.artifacts || {})) {
        const bytes = base64ToBytes(art.dataBase64);
        const computed = await computeSHA256(bytes);
        if (computed.toLowerCase() !== art.sha256Hash.toLowerCase()) {
          throw new RuntimeError(
            "ARCHIVE_CHECKSUM_MISMATCH",
            `Integrity check failed for archived artifact '${artId}'. Expected: ${art.sha256Hash}, computed: ${computed}`
          );
        }
      }
    }

    // 5. Structural DAG Validation
    for (const [rid, manifest] of Object.entries(bundle.runManifests)) {
      const nodes = Object.values(manifest.stepsSnapshot || {}).map((s) => ({
        nodeId: s.stepId,
        operationType: "select_columns" as any,
        parameters: {},
        inputNodeIds: manifest.executionPlan?.stepInputs?.[s.stepId] || [],
      }));

      if (nodes.length > 0) {
        const mockPipeline = {
          version: manifest.version,
          pipelineId: manifest.pipelineId,
          name: manifest.pipelineName,
          nodes,
          edges: [],
          sourceDatasets: {},
        };
        const val = validatePipeline(mockPipeline);
        if (!val.valid) {
          throw new RuntimeError(
            "INVALID_PIPELINE_STRUCTURE",
            `Pipeline DAG in run '${rid}' is invalid or contains cycles.`
          );
        }
      }
    }

    // 6. Conflict Resolution & Staged Import Commit
    const idb = this.storage.getIdb();
    const opfs = this.storage.getOpfs();
    const existing = await idb.getInvestigation(bundle.investigation.investigationId);
    const conflictsResolved: string[] = [];

    let targetInvestigationId = bundle.investigation.investigationId;

    if (existing) {
      if (conflictStrategy === "FAIL_ON_CONFLICT") {
        throw new RuntimeError(
          "INVESTIGATION_CONFLICT",
          `An investigation with ID '${targetInvestigationId}' already exists in workspace.`
        );
      } else if (conflictStrategy === "RENAME_ON_CONFLICT") {
        targetInvestigationId =
          typeof crypto !== "undefined" && crypto.randomUUID
            ? crypto.randomUUID()
            : `inv_${Date.now()}`;
        conflictsResolved.push(`Renamed investigationId to '${targetInvestigationId}'`);
      }
      // If OVERWRITE, we retain the existing ID
    }

    // Write all artifacts to OPFS & IndexedDB
    let importedArtifactsCount = 0;
    for (const [, art] of Object.entries(bundle.artifacts || {})) {
      const bytes = base64ToBytes(art.dataBase64);
      await opfs.writeArtifact(art.reference.storagePath, bytes);
      await idb.saveArtifact(art.reference);
      importedArtifactsCount++;
    }

    // Save Run Manifests
    let importedRunsCount = 0;
    for (const [, manifest] of Object.entries(bundle.runManifests)) {
      await idb.saveRunManifest(manifest);
      importedRunsCount++;
    }

    // Save Verification if present
    if (bundle.dossier?.verification) {
      await idb.saveVerification(bundle.dossier.verification);
    }

    // Save Investigation
    const importedInvestigation = {
      ...bundle.investigation,
      investigationId: targetInvestigationId,
      updatedAt: new Date().toISOString(),
    };
    await idb.saveInvestigation(importedInvestigation);

    return {
      archiveId: bundle.archiveId,
      investigationId: targetInvestigationId,
      importedRunsCount,
      importedArtifactsCount,
      conflictsResolved,
      importedAt: new Date().toISOString(),
    };
  }
}

export const archiveService = new ArchiveService();
