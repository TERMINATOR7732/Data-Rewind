/**
 * Data Rewind Replay & Reproducibility Contracts.
 * Conforms strictly to SPEC-MOD-03 §3.4.
 */

export enum ReplayOutcome {
  REPRODUCIBLE = "REPRODUCIBLE",
  PARTIALLY_REPRODUCIBLE = "PARTIALLY_REPRODUCIBLE",
  BLOCKED_MISSING_ARTIFACTS = "BLOCKED_MISSING_ARTIFACTS",
  DIVERGENT = "DIVERGENT",
  FAILED_VERIFICATION = "FAILED_VERIFICATION",
}

export type ReplayScope = "FULL_PIPELINE" | "CHECKPOINT" | "SINGLE_STEP";

export interface ReplayRequest {
  historicalRunId: string;
  scope?: ReplayScope;
  fromCheckpointStepId?: string;
  targetStepId?: string;
  floatTolerance?: number; // default 1e-6
  persistReplayRun?: boolean;
}

export interface ReplayStepVerification {
  stepId: string;
  historicalMultisetHash?: string | null;
  replayedMultisetHash?: string | null;
  isMatched: boolean;
  isLateDivergencePoint: boolean;
  varianceDetails?: string | null;
  historicalRowCount?: number;
  replayedRowCount?: number;
}

export interface ReplayResult {
  replayRunId: string;
  historicalRunId: string;
  scope: ReplayScope;
  outcome: ReplayOutcome;
  explanation: string;
  missingArtifacts: string[];
  stepVerifications: Record<string, ReplayStepVerification>;
  lateDivergenceStepId?: string | null;
  executionDurationMs: number;
  executedAt: string;
}
