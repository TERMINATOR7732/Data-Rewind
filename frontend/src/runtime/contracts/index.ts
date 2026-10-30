/**
 * Data Rewind Versioned Execution Contract.
 * Schema Version: 1.0.0
 * Conforms to SPEC-MOD-02 & SPEC-MOD-03 & SPEC-MOD-07 browser-first execution architecture.
 */

export const EXECUTION_CONTRACT_VERSION = "1.0.0";

export type DataType =
  | "STRING"
  | "INTEGER"
  | "FLOAT"
  | "BOOLEAN"
  | "DATE"
  | "TIMESTAMP";

/**
 * All 12 Canonical Atomic Transformations (SPEC-MOD-01 §5.2).
 * Includes "cast_columns" as an alias for "cast_types" for Python engine interoperability.
 */
export type OperationType =
  | "select_columns"
  | "rename_columns"
  | "drop_columns"
  | "filter_rows"
  | "deduplicate_rows"
  | "handle_missing"
  | "cast_types"
  | "cast_columns" // Alias for cast_types
  | "join_datasets"
  | "aggregate_group_by"
  | "sort_rows"
  | "derive_column"
  | "data_quality_rule";

export const CANONICAL_TRANSFORMATIONS = [
  "select_columns",
  "rename_columns",
  "drop_columns",
  "filter_rows",
  "deduplicate_rows",
  "handle_missing",
  "cast_types",
  "join_datasets",
  "aggregate_group_by",
  "sort_rows",
  "derive_column",
  "data_quality_rule",
] as const;

// --- Transformation Parameter Schemas ---

export interface SelectColumnsParams {
  columns: string[];
}

export interface RenameColumnsParams {
  mapping: Record<string, string>;
}

export interface DropColumnsParams {
  columns: string[];
}

export interface FilterRowsParams {
  predicate: string;
}

export interface DeduplicateRowsParams {
  subset?: string[];
  subset_columns?: string[]; // Alias for subset
  keep?: "first" | "last";
}

export interface HandleMissingParams {
  columns: string[];
  strategy: "drop" | "fill_literal" | "fill_mean" | "fill_mode";
  value?: unknown;
}

export interface CastTypesParams {
  casts?: Record<string, DataType | "int" | "float" | "string" | "boolean" | "date" | "timestamp" | string>;
  target_types?: Record<string, string>; // Alias for casts
  error_behavior?: "coerce_null" | "fail";
}

export interface JoinDatasetsParams {
  left_on?: string[];
  right_on?: string[];
  join_keys?: string[]; // Convenience when left_on == right_on
  how?: "inner" | "left" | "right" | "outer" | "full";
  join_type?: "inner" | "left" | "right" | "outer" | "full"; // Alias for how
  on?: string; // Optional direct SQL join predicate
}

export interface AggregationDefinition {
  column: string;
  func: "sum" | "avg" | "min" | "max" | "count" | "count_distinct";
  alias: string;
}

export interface AggregateGroupByParams {
  group_keys?: string[];
  group_by_columns?: string[]; // Alias for group_keys
  aggregations: AggregationDefinition[] | Record<string, string>;
}

export interface SortColumnDefinition {
  column: string;
  order: "asc" | "desc";
}

export interface SortRowsParams {
  by?: SortColumnDefinition[] | Array<string | { column: string; ascending?: boolean }>;
  sort_columns?: Array<string | { column: string; ascending?: boolean }>; // Alias for by
}

export interface DeriveColumnParams {
  new_column?: string;
  target_column?: string; // Alias for new_column
  expression: string;
}

export interface DataQualityRuleParams {
  rule_type: "is_not_null" | "in_range" | "matches_regex";
  column: string;
  params?: {
    min?: number;
    max?: number;
    pattern?: string;
  };
  severity?: "warn" | "fail";
}

export type TransformationParams =
  | SelectColumnsParams
  | RenameColumnsParams
  | DropColumnsParams
  | FilterRowsParams
  | DeduplicateRowsParams
  | HandleMissingParams
  | CastTypesParams
  | JoinDatasetsParams
  | AggregateGroupByParams
  | SortRowsParams
  | DeriveColumnParams
  | DataQualityRuleParams;

// --- Domain Schema & Metadata Contracts ---

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
  label?: string;
  operationType: OperationType;
  parameters: Record<string, any>;
  inputNodeIds: string[];
}

export interface PipelineEdge {
  sourceNodeId: string;
  targetNodeId: string;
  sourcePort?: string;
  targetPort?: string;
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
  multisetHash?: string;
  createdAt: string;
}

// --- Validation Models ---

export interface ValidationIssue {
  code: string;
  severity: "ERROR" | "WARNING";
  nodeId?: string;
  edgeId?: string;
  parameterName?: string;
  message: string;
  remediation?: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  topologicalOrder?: string[];
}

// --- Planning Models ---

export interface ExecutionPlan {
  planId: string;
  pipelineId: string;
  topologicalOrder: string[];
  stages: string[][];
  stepInputs: Record<string, string[]>;
  plannedAt: string;
  tieBreakerApplied: boolean;
}

// --- Execution Models ---

export type StepStatus = "SUCCESS" | "FAILED" | "CANCELLED" | "SKIPPED";

export interface StepOutput {
  stepId: string;
  status: StepStatus;
  rowCount: number;
  columnCount: number;
  durationMs: number;
  schema: DatasetSchema;
  tableName: string;
  previewRows?: Record<string, unknown>[];
  artifact?: ArtifactReference;
  contentHash: string;
  multisetHash: string;
  definitionHash: string;
  error?: ExecutionError;
  warnings?: string[];
}

export interface IntermediateCheckpoint {
  checkpointId: string;
  runId: string;
  stepId: string;
  tableName: string;
  rowCount: number;
  byteSize: number;
  contentHash: string;
  multisetHash: string;
  schema: DatasetSchema;
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
    failFast?: boolean;
  };
}

export interface StepExecutionResult {
  stepId: string;
  status: StepStatus;
  rowCount: number;
  columnCount: number;
  durationMs: number;
  schema: DatasetSchema;
  previewRows?: Record<string, unknown>[];
  artifact?: ArtifactReference;
  error?: ExecutionError;
}

export interface PipelineExecutionResult {
  version: typeof EXECUTION_CONTRACT_VERSION;
  executionId: string;
  pipelineId: string;
  status: "COMPLETED" | "FAILED" | "CANCELLED";
  startedAt: string;
  completedAt: string;
  durationMs: number;
  stepResults: Record<string, StepOutput>;
  topologicalOrder: string[];
  failedStepId?: string;
  errorMessage?: string;
  checkpoints: IntermediateCheckpoint[];
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
  stage: "VALIDATING" | "PLANNING" | "INITIALIZING" | "EXECUTING" | "CHECKPOINTING" | "COMPLETED" | "FAILED";
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
    if (typeof value === "bigint") {
      return value.toString();
    }
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
