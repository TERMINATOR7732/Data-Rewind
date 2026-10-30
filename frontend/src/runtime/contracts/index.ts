/**
 * Data Rewind Versioned Execution Contract.
 * Schema Version: 1.0.0
 * Conforms to SPEC-MOD-02 & SPEC-MOD-07 browser-first execution architecture.
 */

export const EXECUTION_CONTRACT_VERSION = "1.0.0";

export type DataType =
  | "STRING"
  | "INTEGER"
  | "FLOAT"
  | "BOOLEAN"
  | "DATE"
  | "TIMESTAMP";

export type OperationType =
  | "filter_rows"
  | "join_datasets"
  | "aggregate_group_by"
  | "derive_column"
  | "deduplicate_rows"
  | "cast_columns"
  | "sort_rows";

export interface ColumnSchema {
  name: string;
  dataType: DataType;
  nullable: boolean;
  ordinalPosition: number;
}

export interface DatasetSchema {
  version: typeof EXECUTION_CONTRACT_VERSION;
  columns: ColumnSchema[];
  primaryKeys: string[];
}

export interface DatasetMetadata {
  datasetId: string;
  name: string;
  rowCount: number;
  columnCount: number;
  byteSize: number;
  sha256Hash: string;
  schema: DatasetSchema;
  createdAt: string; // ISO 8601 UTC string
}

export interface PipelineNode {
  nodeId: string;
  label: string;
  operationType: OperationType;
  parameters: Record<string, unknown>;
  inputNodeIds: string[];
}

export interface PipelineEdge {
  sourceNodeId: string;
  targetNodeId: string;
}

export interface PipelineDefinition {
  version: typeof EXECUTION_CONTRACT_VERSION;
  pipelineId: string;
  name: string;
  nodes: PipelineNode[];
  edges: PipelineEdge[];
  sourceDatasets: Record<string, string>; // inputNodeId -> datasetId
}

export interface ArtifactReference {
  artifactId: string;
  runId: string;
  stepId: string;
  artifactType: "PARQUET" | "CSV" | "METADATA_JSON";
  storagePath: string; // OPFS or virtual storage path
  byteSize: number;
  sha256Hash: string;
  createdAt: string;
}

export interface ExecutionRequest {
  version: typeof EXECUTION_CONTRACT_VERSION;
  executionId: string;
  pipeline: PipelineDefinition;
  runType: "BASELINE" | "INVESTIGATION_PROBE" | "FIX_VERIFICATION" | "HISTORICAL_REPLAY";
  options?: {
    timeoutMs?: number;
    persistArtifacts?: boolean;
    previewLimit?: number;
  };
}

export interface StepExecutionResult {
  stepId: string;
  status: "SUCCESS" | "FAILED" | "CANCELLED" | "SKIPPED";
  rowCount: number;
  columnCount: number;
  durationMs: number;
  schema: DatasetSchema;
  previewRows?: Record<string, unknown>[];
  artifact?: ArtifactReference;
  error?: ExecutionError;
}

export interface ExecutionResult {
  version: typeof EXECUTION_CONTRACT_VERSION;
  executionId: string;
  status: "SUCCESS" | "FAILED" | "CANCELLED";
  startedAt: string;
  completedAt: string;
  durationMs: number;
  stepResults: Record<string, StepExecutionResult>;
  error?: ExecutionError;
}

export interface ExecutionError {
  code: string;
  message: string;
  stepId?: string;
  details?: Record<string, unknown>;
  remediation?: string;
  timestamp: string;
}

export interface ExecutionProgressEvent {
  executionId: string;
  stepId?: string;
  stage: "VALIDATING" | "INITIALIZING" | "EXECUTING" | "COMPARING" | "STORING" | "COMPLETED";
  percentComplete: number; // 0 - 100
  message: string;
  timestamp: string;
}

/**
 * Deterministic serialization helper for execution contract objects.
 * Guarantees:
 * 1. Object keys sorted alphabetically.
 * 2. Explicit null representation (undefined is converted to null).
 * 3. NaN and Infinity normalized to null.
 * 4. Deterministic string output.
 */
export function serializeDeterministic(obj: unknown): string {
  return JSON.stringify(obj, (_key, value) => {
    if (typeof value === "number") {
      if (!Number.isFinite(value)) return null;
      return value;
    }
    if (value === undefined) {
      return null;
    }
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      const sortedKeys = Object.keys(value).sort();
      const result: Record<string, unknown> = {};
      for (const k of sortedKeys) {
        result[k] = (value as Record<string, unknown>)[k];
      }
      return result;
    }
    return value;
  });
}
