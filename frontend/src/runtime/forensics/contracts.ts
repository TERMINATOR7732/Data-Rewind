/**
 * Data Rewind Forensic Intelligence Engine Contracts.
 * Conforms strictly to SPEC-MOD-03, SPEC-MOD-04, and SPEC-MOD-07.
 */

export type DiffCategory = "IDENTICAL" | "MODIFIED" | "ADDED" | "REMOVED";

export enum CaseClassification {
  CASE_1_KEYED_PK = "CASE_1_KEYED_PK",
  CASE_2_COMPOSITE_KEY = "CASE_2_COMPOSITE_KEY",
  CASE_3_NULL_KEY = "CASE_3_NULL_KEY",
  CASE_4_DUPLICATE_KEY = "CASE_4_DUPLICATE_KEY",
  CASE_5_KEYLESS_MULTISET = "CASE_5_KEYLESS_MULTISET",
  CASE_6_REORDERED_ROWS = "CASE_6_REORDERED_ROWS",
  CASE_7_IDENTICAL_DUPLICATES = "CASE_7_IDENTICAL_DUPLICATES",
  CASE_8_PARTITION_INVARIANTS = "CASE_8_PARTITION_INVARIANTS",
  CASE_9_SCHEMA_DRIFT = "CASE_9_SCHEMA_DRIFT",
  CASE_10_TYPE_COERCION = "CASE_10_TYPE_COERCION",
  CASE_11_FLOAT_TOLERANCE = "CASE_11_FLOAT_TOLERANCE",
  CASE_12_DECIMAL_INTEGER_ARITHMETIC = "CASE_12_DECIMAL_INTEGER_ARITHMETIC",
  CASE_13_NAN_INF_NULL = "CASE_13_NAN_INF_NULL",
  CASE_14_STRING_NORMALIZATION = "CASE_14_STRING_NORMALIZATION",
  CASE_15_FINGERPRINT = "CASE_15_FINGERPRINT",
}

export enum EvidenceTier {
  PROVEN_OBSERVATION = "PROVEN_OBSERVATION",
  CAUSAL_HYPOTHESIS_DIRECT_CODE_DIFF = "CAUSAL_HYPOTHESIS_DIRECT_CODE_DIFF",
  CAUSAL_HYPOTHESIS_INPUT_DRIFT = "CAUSAL_HYPOTHESIS_INPUT_DRIFT",
  CORRELATION_INFERENCE = "CORRELATION_INFERENCE",
  INDETERMINATE = "INDETERMINATE",
}

export enum EODStatus {
  EXACT_EOD = "EXACT_EOD",
  COARSE_GRAINED_EOD = "COARSE_GRAINED_EOD",
  CONCURRENT_DIVERGENCE_POINTS = "CONCURRENT_DIVERGENCE_POINTS",
  UPSTREAM_INPUT_DATA_DRIFT = "UPSTREAM_INPUT_DATA_DRIFT",
  NONDETERMINISTIC_TRANSFORMATION = "NONDETERMINISTIC_TRANSFORMATION",
  NO_DIVERGENCE = "NO_DIVERGENCE",
}

export enum DiagnosticRuleID {
  DR_01_UPSTREAM_INPUT_DATA_DRIFT = "DR_01_UPSTREAM_INPUT_DATA_DRIFT",
  DR_02_ARITHMETIC_EXPRESSION_MUTATION = "DR_02_ARITHMETIC_EXPRESSION_MUTATION",
  DR_03_UNMATCHED_JOIN_DROP = "DR_03_UNMATCHED_JOIN_DROP",
  DR_04_DUPLICATION_CARDINALITY_BURST = "DR_04_DUPLICATION_CARDINALITY_BURST",
  DR_05_NULL_SENTINEL_SURGE = "DR_05_NULL_SENTINEL_SURGE",
  DR_06_NONDETERMINISTIC_TRANSFORMATION = "DR_06_NONDETERMINISTIC_TRANSFORMATION",
}

export enum TaintStatus {
  UNTAINTED = "UNTAINTED",
  POTENTIALLY_AFFECTED = "POTENTIALLY_AFFECTED",
  CONFIRMED_AFFECTED = "CONFIRMED_AFFECTED",
  MASKED_UNAFFECTED = "MASKED_UNAFFECTED",
}

export interface ComparisonConfig {
  primaryKey?: string[];
  atol?: number; // default 1e-6
  rtol?: number; // default 1e-5
  caseSensitive?: boolean; // default true
  ignoreWhitespace?: boolean; // default false
  floatToleranceColumns?: string[];
  maxSamples?: number; // default 100
}

export interface SchemaDiff {
  added_columns: string[];
  removed_columns: string[];
  common_columns: string[];
  type_changes: Record<string, [string, string]>;
  has_breaking_type_drift: boolean;
}

export interface ValueDiff {
  column: string;
  baseline_value: unknown;
  target_value: unknown;
  is_numeric_tolerant_match: boolean;
  is_null_transition: boolean;
  is_numeric_corruption: boolean;
}

export interface RowDiff {
  category: DiffCategory;
  key_values: Record<string, unknown>;
  baseline_row?: Record<string, unknown> | null;
  target_row?: Record<string, unknown> | null;
  field_diffs: ValueDiff[];
  row_hash_baseline?: string | null;
  row_hash_target?: string | null;
  // UI compatibility fields
  _diff_status: DiffCategory;
  _key_values: Record<string, unknown>;
  _field_diffs?: ValueDiff[];
  [key: string]: unknown;
}

export interface DatasetFingerprint {
  schema_hash: string;
  multiset_hash: string;
  row_count: number;
  fingerprint_hash: string;
}

export interface TabularDiffResult {
  is_equal: boolean;
  case_classifications: CaseClassification[];
  schema_diff: SchemaDiff;
  baseline_fingerprint: DatasetFingerprint;
  target_fingerprint: DatasetFingerprint;

  // Exact Partition Counts
  identical_count: number;
  modified_count: number;
  added_count: number;
  removed_count: number;
  baseline_row_count: number;
  target_row_count: number;

  // Forensic Samples and Evidence
  sample_row_diffs: RowDiff[];
  warnings: string[];
  invalid_key_rows_baseline: Record<string, unknown>[];
  invalid_key_rows_target: Record<string, unknown>[];
  duplicate_keys_detected: string[];

  // Performance Telemetry
  execution_duration_ms: number;
  peak_memory_mib?: number;
}

export interface StepDiagnosticContext {
  step_id: string;
  operation: string;
  is_ingestion_node?: boolean;
  input_dataset_name?: string | null;
  baseline_input_hashes?: string[];
  target_input_hashes?: string[];
  baseline_parameters?: Record<string, unknown>;
  target_parameters?: Record<string, unknown>;
  baseline_output_hash?: string | null;
  target_output_hash?: string | null;
  diff_result?: TabularDiffResult | null;
  left_input_rows?: number;
  right_input_rows?: number;
}

export interface DiagnosticFinding {
  rule_id: DiagnosticRuleID;
  rule_name: string;
  step_id: string;
  evidence_tier: EvidenceTier;
  message: string;
  details: Record<string, unknown>;
  affected_columns: string[];
  confidence_explanation: string;

  // Observed vs Inferred separation
  observed: string;
  interpretation: string;
  limitations: string;
  next_investigation: string;
}

export interface EODResult {
  status: EODStatus;
  divergent_step_ids: string[];
  primary_eod_step: string | null;
  is_coarse_grained: boolean;
  findings: DiagnosticFinding[];
  evidence_tier: EvidenceTier;
  summary: string;
  // UI compatibility field
  divergence_category: string;
  affected_row_count?: number;
}

export interface LineageNode {
  step_id: string;
  operation: string;
  taint_status: TaintStatus;
  is_origin: boolean;
  is_divergent: boolean;
  input_step_ids: string[];
  output_step_ids: string[];
  baseline_output_hash?: string | null;
  target_output_hash?: string | null;
  explanation?: string | null;
}

export interface BlastRadiusReport {
  origin_divergent_step_ids: string[];
  total_nodes_count: number;
  tainted_nodes_count: number;
  confirmed_affected_count: number;
  masked_count: number;
  untainted_count: number;
  blast_radius_ratio: number;
  confirmed_divergence_ratio: number;
  tainted_step_ids: string[];
  confirmed_affected_step_ids: string[];
  masked_step_ids: string[];
  untainted_step_ids: string[];
  affected_terminal_sinks: string[];
  nodes: Record<string, LineageNode>;
  upstream_paths: Record<string, string[][]>;
  // UI compatibility fields
  confirmed_divergent_step_ids: string[];
  total_graph_nodes: number;
}

export interface ColumnLineageSource {
  source_dataset: string;
  source_column: string;
  transformations: string[];
}

export interface ColumnLineageResult {
  target_step_id: string;
  target_column: string;
  producing_operation: string;
  direct_input_columns: string[];
  upstream_sources: ColumnLineageSource[];
  downstream_consumers: Array<{ step_id: string; column: string }>;
  is_derived: boolean;
  expression?: string;
  is_ambiguous: boolean;
}
