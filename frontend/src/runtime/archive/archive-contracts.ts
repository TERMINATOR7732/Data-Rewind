/**
 * Data Rewind Portable Investigation Archive Contracts.
 * Conforms strictly to SPEC-MOD-05 & SPEC-MOD-07.
 */

import { ForensicDossier } from "../../types/api";
import { RunManifest } from "../storage/run-manifest";
import { StoredInvestigation } from "../storage/indexeddb";
import { ArtifactReference } from "../contracts/index";

export const ARCHIVE_FORMAT_VERSION = "1.0.0";
export const MAX_UNCOMPRESSED_ARCHIVE_BYTES = 50 * 1024 * 1024; // 50MB browser safety limit

export interface ArchivedArtifact {
  reference: ArtifactReference;
  dataBase64: string;
  sha256Hash: string;
  byteSize: number;
}

export interface InvestigationArchiveBundle {
  formatVersion: typeof ARCHIVE_FORMAT_VERSION;
  archiveId: string;
  exportedAt: string;
  investigation: StoredInvestigation;
  dossier?: ForensicDossier;
  runManifests: Record<string, RunManifest>;
  artifacts: Record<string, ArchivedArtifact>;
  checksums: Record<string, string>; // entryName -> sha256
  metadata?: Record<string, unknown>;
}

export type ConflictStrategy = "FAIL_ON_CONFLICT" | "RENAME_ON_CONFLICT" | "OVERWRITE";

export interface ArchiveImportOptions {
  conflictStrategy?: ConflictStrategy;
  maxSizeBytes?: number;
  skipChecksumVerification?: boolean;
}

export interface ArchiveImportResult {
  archiveId: string;
  investigationId: string;
  importedRunsCount: number;
  importedArtifactsCount: number;
  conflictsResolved: string[];
  importedAt: string;
}
