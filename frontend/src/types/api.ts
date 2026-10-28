/**
 * Data Rewind API TypeScript Contracts.
 * Conforms strictly to SPEC-MOD-07 §3 and backend schemas.
 */

export type VerificationVerdictCode =
  | "VERIFIED_CLEAN"
  | "INTENTIONAL_UPDATE"
  | "PARTIAL_RESTORATION"
  | "REGRESSION_UNRESOLVED"
  | "NEW_FAULT_INTRODUCED"
  | "BASELINE_UNAVAILABLE"
  | "FAULT_UNREPRODUCIBLE"
  | "INCONCLUSIVE_VERIFICATION";

export type DiffCategory = "IDENTICAL" | "MODIFIED" | "ADDED" | "REMOVED";

export interface HealthResponse {
  status: string;
  app_name: string;
  version: string;
  profile: "local" | "hosted_demo";
  limits: {
    max_raw_csv_bytes: number;
    max_dataset_rows: number;
    max_column_count: number;
    max_cell_length_chars: number;
    max_line_length_bytes: number;
    max_process_rss_mib: number;
    duckdb_max_memory_mib: number;
    step_timeout_seconds: number;
  };
  free_disk_mb: number;
  rss_mib: number;
}

export interface ScenarioSummary {
  scenario_id: string;
  title: string;
  description: string;
  expected_eod_step: string;
  expected_rule_id: string;
  step_count: number;
  input_tables: string[];
  primary_keys_by_step: Record<string, string[]>;
}

export interface ScenarioDetail extends ScenarioSummary {
  steps: TransformationStep[];
  target_steps: TransformationStep[];
  baseline_inputs: Record<string, number>;
  target_inputs: Record<string, number>;
}

export interface TransformationStep {
  step_id: string;
  operation_type: string;
  input_step_ids: string[];
  parameters: Record<string, any>;
}

export interface DatasetColumnInfo {
  name: string;
  data_type: string;
}

export interface DatasetUploadResponse {
  dataset_id: string;
  filename: string;
  row_count: number;
  column_count: number;
  byte_size: number;
  sha256_hash: string;
  columns: DatasetColumnInfo[];
}

export interface DatasetPreviewResponse {
  dataset_id: string;
  filename: string;
  row_count: number;
  column_count: number;
  columns: DatasetColumnInfo[];
  sample_rows: Record<string, any>[];
}

export interface ValueDiff {
  column: string;
  baseline_value: any;
  target_value: any;
  is_numeric_tolerant_match: boolean;
  is_null_transition: boolean;
  is_numeric_corruption: boolean;
}

export interface RowDiff {
  _diff_status: DiffCategory;
  _key_values: Record<string, any>;
  _field_diffs?: ValueDiff[];
  [key: string]: any;
}

export interface StepDiffPage {
  step_id: string;
  filter_status: string;
  total_matching_rows: number;
  page: number;
  page_size: number;
  total_pages: number;
  columns: string[];
  primary_keys: string[];
  rows: RowDiff[];
}

export interface SchemaDiff {
  added_columns: string[];
  removed_columns: string[];
  common_columns: string[];
  type_changes: Record<string, [string, string]>;
  has_breaking_type_drift: boolean;
}

export interface DatasetFingerprint {
  schema_hash: string;
  multiset_hash: string;
  row_count: number;
  fingerprint_hash: string;
}

export interface TabularDiffResult {
  is_equal: boolean;
  case_classifications: string[];
  schema_diff: SchemaDiff;
  baseline_fingerprint: DatasetFingerprint;
  target_fingerprint: DatasetFingerprint;
  identical_count: number;
  modified_count: number;
  added_count: number;
  removed_count: number;
  baseline_row_count: number;
  target_row_count: number;
  warnings: string[];
  execution_duration_ms: number;
}

export interface EODResult {
  primary_eod_step: string | null;
  status: string;
  divergence_category: string;
  affected_row_count: number;
  explanation: string;
}

export interface BlastRadiusReport {
  tainted_step_ids: string[];
  confirmed_divergent_step_ids: string[];
  affected_terminal_sinks: string[];
  tainted_nodes_count: number;
  total_graph_nodes: number;
  blast_radius_ratio: number;
}

export interface InvestigationSummary {
  investigation_id: string;
  title: string;
  baseline_run_id: string;
  target_run_id: string;
  status: string;
  primary_eod_step: string | null;
  eod_status: string;
  blast_radius_ratio: number;
  created_at: string;
}

export interface Investigation {
  investigation_id: string;
  title: string;
  baseline_run_id: string;
  target_run_id: string;
  status: string;
  eod_result: EODResult;
  blast_radius: BlastRadiusReport;
  topological_order: string[];
  step_comparisons: Record<string, TabularDiffResult>;
  primary_keys_by_step: Record<string, string[]>;
  step_dependencies: Record<string, string[]>;
  created_at: string;
}

export interface EvidenceItem {
  tier: string;
  step_id: string;
  category: string;
  description: string;
  remediation_advice: string;
}

export interface MissingEvidenceDeclaration {
  step_id: string;
  missing_artifact: string;
  impact_on_verdict: string;
}

export interface RemediationAxisResult {
  eod_step: string | null;
  eod_remediated: boolean;
  eod_severity_reduced: boolean;
  unresolved_eod_differences: string[];
  eod_diff?: TabularDiffResult;
  explanation: string;
}

export interface BaselineEquivalenceAxisResult {
  baseline_equivalent_at_sinks: boolean;
  baseline_equivalent_across_all_steps: boolean;
  collateral_regressions: string[];
  sink_step_ids: string[];
  step_comparisons: Record<string, TabularDiffResult>;
  explanation: string;
}

export interface DualAxisEvaluation {
  remediation_axis: RemediationAxisResult;
  baseline_axis?: BaselineEquivalenceAxisResult;
}

export interface TriRunVerification {
  verification_id: string;
  title: string;
  baseline_run_id?: string;
  faulted_run_id: string;
  candidate_run_id: string;
  verdict: VerificationVerdictCode;
  verdict_meaning: string;
  verdict_reason_codes: string[];
  dual_axis: DualAxisEvaluation;
  evidence_chain: EvidenceItem[];
  missing_evidence: MissingEvidenceDeclaration[];
  created_at: string;
  duration_ms: number;
}

export interface VerificationSummary {
  verification_id: string;
  title: string;
  verdict: VerificationVerdictCode;
  baseline_run_id?: string;
  faulted_run_id: string;
  candidate_run_id: string;
  created_at: string;
}

export interface ForensicDossierMetadata {
  dossier_id: string;
  pipeline_name: string;
  pipeline_version_hash: string;
  investigator_session: string;
  baseline_run_id?: string;
  faulted_run_id: string;
  candidate_run_id: string;
  created_at: string;
}

export interface ForensicDossier {
  metadata: ForensicDossierMetadata;
  verification: TriRunVerification;
  reproducibility_signatures: Record<string, string>;
  limitations_disclaimer: string;
}

export interface WorkspaceInfo {
  workspace_path: string;
  total_storage_bytes: number;
  total_storage_mb: number;
  file_count: number;
  investigations_db_bytes: number;
  verifications_db_bytes: number;
}

export interface WorkspacePurgeResponse {
  purged_bytes: number;
  unlinked_files_count: number;
  vacuum_completed: boolean;
  message: string;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, any>;
  remediation?: string;
  timestamp?: string;
}
