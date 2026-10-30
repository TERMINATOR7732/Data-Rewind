/**
 * Data Rewind Tri-Run Verification Contracts.
 * Conforms strictly to SPEC-MOD-05 §1.
 */

import type {
  VerificationVerdictCode,
  DualAxisEvaluation,
  RemediationAxisResult,
  BaselineEquivalenceAxisResult,
  EvidenceItem,
  MissingEvidenceDeclaration,
  TriRunVerification,
  ForensicDossier,
  ForensicDossierMetadata,
} from "../../types/api";

export type {
  VerificationVerdictCode,
  DualAxisEvaluation,
  RemediationAxisResult,
  BaselineEquivalenceAxisResult,
  EvidenceItem,
  MissingEvidenceDeclaration,
  TriRunVerification,
  ForensicDossier,
  ForensicDossierMetadata,
};

export enum RunRole {
  BASELINE = "BASELINE", // R0
  FAULTED = "FAULTED",   // R1
  FIX = "FIX",           // R2
}

export interface IntentionalUpdateContract {
  allowed_steps?: string[];
  allowed_columns_by_step?: Record<string, string[]>;
  allow_row_count_change?: boolean;
  justification?: string;
}

export interface TriRunVerificationRequest {
  title?: string;
  baselineRunId?: string; // R0 (optional)
  faultedRunId: string;   // R1
  candidateRunId: string; // R2
  intentionalContract?: IntentionalUpdateContract;
  floatTolerance?: number;
  terminalSinkStepIds?: string[];
  investigatorSession?: string;
}
