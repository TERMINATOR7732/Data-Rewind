/**
 * Unit & Integration Test Suite: EOD Detection & Diagnostic Rules (R1–R6).
 * Conforms strictly to SPEC-MOD-04 §2.1 and §2.2.
 */

import { describe, it, expect } from "vitest";
import {
  EODDetector,
  DiagnosticRuleEngine,
  DiagnosticRuleID,
  EvidenceTier,
  EODStatus,
  StepDiagnosticContext,
  TabularDiffResult,
} from "../runtime/forensics/index";

function createMockDiffResult(isEqual: boolean, modifications: number = 0, added: number = 0, removed: number = 0): TabularDiffResult {
  return {
    is_equal: isEqual,
    case_classifications: [],
    schema_diff: {
      added_columns: [],
      removed_columns: [],
      common_columns: ["id", "val"],
      type_changes: {},
      has_breaking_type_drift: false,
    },
    baseline_fingerprint: {
      schema_hash: "sh1",
      multiset_hash: isEqual ? "mh1" : "mh_base",
      row_count: 10,
      fingerprint_hash: isEqual ? "fp1" : "fp_base",
    },
    target_fingerprint: {
      schema_hash: "sh1",
      multiset_hash: isEqual ? "mh1" : "mh_targ",
      row_count: 10 + added - removed,
      fingerprint_hash: isEqual ? "fp1" : "fp_targ",
    },
    identical_count: isEqual ? 10 : 10 - modifications - removed,
    modified_count: modifications,
    added_count: added,
    removed_count: removed,
    baseline_row_count: 10,
    target_row_count: 10 + added - removed,
    sample_row_diffs: [],
    warnings: [],
    invalid_key_rows_baseline: [],
    invalid_key_rows_target: [],
    duplicate_keys_detected: [],
    execution_duration_ms: 5,
  };
}

describe("Forensic EOD Detector — SPEC-MOD-04 §2.1", () => {
  it("detects NO_DIVERGENCE when all steps are verified identical", () => {
    const topo = ["step_1", "step_2", "step_3"];
    const stepContexts: Record<string, StepDiagnosticContext> = {
      step_1: {
        step_id: "step_1",
        operation: "select_columns",
        diff_result: createMockDiffResult(true),
        baseline_output_hash: "h1",
        target_output_hash: "h1",
      },
      step_2: {
        step_id: "step_2",
        operation: "derive_column",
        diff_result: createMockDiffResult(true),
        baseline_output_hash: "h2",
        target_output_hash: "h2",
      },
      step_3: {
        step_id: "step_3",
        operation: "filter_rows",
        diff_result: createMockDiffResult(true),
        baseline_output_hash: "h3",
        target_output_hash: "h3",
      },
    };

    const res = EODDetector.detectEOD({
      topologicalOrder: topo,
      stepContexts,
    });

    expect(res.status).toBe(EODStatus.NO_DIVERGENCE);
    expect(res.primary_eod_step).toBeNull();
    expect(res.divergence_category).toBe("NO_DIVERGENCE");
  });

  it("detects exact EOD at a middle transformation node", () => {
    const topo = ["step_1", "step_2", "step_3"];
    const stepContexts: Record<string, StepDiagnosticContext> = {
      step_1: {
        step_id: "step_1",
        operation: "select_columns",
        diff_result: createMockDiffResult(true),
        baseline_output_hash: "h1",
        target_output_hash: "h1",
      },
      step_2: {
        step_id: "step_2",
        operation: "derive_column",
        diff_result: createMockDiffResult(false, 3), // divergence starts here!
        baseline_output_hash: "h2_base",
        target_output_hash: "h2_targ",
        baseline_parameters: { expression: "price * 1.0" },
        target_parameters: { expression: "price * 1.2" },
      },
      step_3: {
        step_id: "step_3",
        operation: "filter_rows",
        diff_result: createMockDiffResult(false, 3),
        baseline_output_hash: "h3_base",
        target_output_hash: "h3_targ",
      },
    };

    const res = EODDetector.detectEOD({
      topologicalOrder: topo,
      stepContexts,
    });

    expect(res.status).toBe(EODStatus.EXACT_EOD);
    expect(res.primary_eod_step).toBe("step_2");
    expect(res.evidence_tier).toBe(EvidenceTier.CAUSAL_HYPOTHESIS_DIRECT_CODE_DIFF);
  });

  it("classifies Step 1 divergence as UPSTREAM_INPUT_DATA_DRIFT", () => {
    const topo = ["step_1", "step_2"];
    const stepContexts: Record<string, StepDiagnosticContext> = {
      step_1: {
        step_id: "step_1",
        operation: "select_columns",
        is_ingestion_node: true,
        diff_result: createMockDiffResult(false, 5),
        baseline_output_hash: "h1_base",
        target_output_hash: "h1_targ",
      },
      step_2: {
        step_id: "step_2",
        operation: "derive_column",
        diff_result: createMockDiffResult(false, 5),
      },
    };

    const res = EODDetector.detectEOD({
      topologicalOrder: topo,
      stepContexts,
    });

    expect(res.status).toBe(EODStatus.UPSTREAM_INPUT_DATA_DRIFT);
    expect(res.primary_eod_step).toBe("step_1");
    expect(res.divergence_category).toBe("UPSTREAM_INPUT_DATA_DRIFT");
  });

  it("handles unmaterialized intermediate checkpoints with COARSE_GRAINED_EOD", () => {
    const topo = ["step_1", "step_2", "step_3"];
    const stepContexts: Record<string, StepDiagnosticContext> = {
      step_3: {
        step_id: "step_3",
        operation: "filter_rows",
        diff_result: createMockDiffResult(false, 2),
      },
    };

    const res = EODDetector.detectEOD({
      topologicalOrder: topo,
      stepContexts,
      hasUnmaterializedIntermediates: true,
      terminalStepIds: ["step_3"],
    });

    expect(res.status).toBe(EODStatus.COARSE_GRAINED_EOD);
    expect(res.is_coarse_grained).toBe(true);
    expect(res.evidence_tier).toBe(EvidenceTier.PROVEN_OBSERVATION);
  });

  it("identifies concurrent divergence points across independent parallel branches", () => {
    // Branch A: step_1 -> step_2a
    // Branch B: step_1 -> step_2b
    // Sink: step_3 joins 2a and 2b
    const topo = ["step_1", "step_2a", "step_2b", "step_3"];
    const stepDependencies = {
      step_1: [],
      step_2a: ["step_1"],
      step_2b: ["step_1"],
      step_3: ["step_2a", "step_2b"],
    };

    const stepContexts: Record<string, StepDiagnosticContext> = {
      step_1: {
        step_id: "step_1",
        operation: "select_columns",
        diff_result: createMockDiffResult(true),
      },
      step_2a: {
        step_id: "step_2a",
        operation: "derive_column",
        diff_result: createMockDiffResult(false, 2), // Divergence in branch A
      },
      step_2b: {
        step_id: "step_2b",
        operation: "filter_rows",
        diff_result: createMockDiffResult(false, 3), // Divergence in branch B
      },
      step_3: {
        step_id: "step_3",
        operation: "join_datasets",
        diff_result: createMockDiffResult(false, 5),
      },
    };

    const res = EODDetector.detectEOD({
      topologicalOrder: topo,
      stepContexts,
      stepDependencies,
    });

    expect(res.status).toBe(EODStatus.CONCURRENT_DIVERGENCE_POINTS);
    expect(res.divergent_step_ids).toContain("step_2a");
    expect(res.divergent_step_ids).toContain("step_2b");
  });

  it("detects non-deterministic transformations when inputs and parameters are identical", () => {
    const topo = ["step_1"];
    const stepContexts: Record<string, StepDiagnosticContext> = {
      step_1: {
        step_id: "step_1",
        operation: "derive_column",
        is_ingestion_node: false,
        baseline_input_hashes: ["input_hash_123"],
        target_input_hashes: ["input_hash_123"], // identical input hashes
        baseline_parameters: { expr: "random()" },
        target_parameters: { expr: "random()" }, // identical parameters
        baseline_output_hash: "out_A",
        target_output_hash: "out_B", // divergent output!
        diff_result: createMockDiffResult(false, 4),
      },
    };

    const res = EODDetector.detectEOD({
      topologicalOrder: topo,
      stepContexts,
    });

    expect(res.status).toBe(EODStatus.NONDETERMINISTIC_TRANSFORMATION);
    expect(res.divergence_category).toBe("Non-Deterministic Transformation Detected");
  });
});

describe("Forensic Diagnostic Rules Engine (DR-01 to DR-06) — SPEC-MOD-04 §2.2", () => {
  // DR-01: Upstream Input Data Drift
  it("DR-01: evaluates upstream input data drift with CAUSAL_HYPOTHESIS_INPUT_DRIFT", () => {
    const ctx: StepDiagnosticContext = {
      step_id: "step_1_ingest",
      operation: "select_columns",
      is_ingestion_node: true,
      input_dataset_name: "sales_data.csv",
      diff_result: createMockDiffResult(false, 10),
    };

    const finding = DiagnosticRuleEngine.evaluateDR01(ctx);
    expect(finding).not.toBeNull();
    expect(finding?.rule_id).toBe(DiagnosticRuleID.DR_01_UPSTREAM_INPUT_DATA_DRIFT);
    expect(finding?.evidence_tier).toBe(EvidenceTier.CAUSAL_HYPOTHESIS_INPUT_DRIFT);
    expect(finding?.observed).toContain("Ingestion hash");
    expect(finding?.interpretation).toContain("raw external dataset was modified");
    expect(finding?.limitations).toBeDefined();
    expect(finding?.next_investigation).toBeDefined();
  });

  // DR-02: Arithmetic Expression Mutation
  it("DR-02: identifies code/expression mutations with CAUSAL_HYPOTHESIS_DIRECT_CODE_DIFF", () => {
    const ctx: StepDiagnosticContext = {
      step_id: "step_2_tax",
      operation: "derive_column",
      baseline_parameters: { expression: "subtotal * 0.08" },
      target_parameters: { expression: "subtotal * 0.18" },
      diff_result: createMockDiffResult(false, 5),
    };

    const finding = DiagnosticRuleEngine.evaluateDR02(ctx);
    expect(finding).not.toBeNull();
    expect(finding?.rule_id).toBe(DiagnosticRuleID.DR_02_ARITHMETIC_EXPRESSION_MUTATION);
    expect(finding?.evidence_tier).toBe(EvidenceTier.CAUSAL_HYPOTHESIS_DIRECT_CODE_DIFF);
    expect(finding?.message).toContain("subtotal * 0.08");
    expect(finding?.observed).toContain("value drift");
    expect(finding?.interpretation).toContain("Formula change");
  });

  // DR-03: Unmatched Join Drop
  it("DR-03: flags significant join drop with PROVEN_OBSERVATION tier", () => {
    // Baseline output 100 rows, target output only 40 rows (60% drop, >30% threshold)
    const mockDiff = createMockDiffResult(false);
    mockDiff.baseline_row_count = 100;
    mockDiff.target_row_count = 40;

    const ctx: StepDiagnosticContext = {
      step_id: "step_join",
      operation: "join_datasets",
      diff_result: mockDiff,
      left_input_rows: 100,
      right_input_rows: 100,
    };

    const finding = DiagnosticRuleEngine.evaluateDR03(ctx);
    expect(finding).not.toBeNull();
    expect(finding?.rule_id).toBe(DiagnosticRuleID.DR_03_UNMATCHED_JOIN_DROP);
    expect(finding?.evidence_tier).toBe(EvidenceTier.PROVEN_OBSERVATION);
    expect(finding?.observed).toContain("60.0%");
  });

  // DR-04: Duplication Cardinality Burst
  it("DR-04: flags cardinality explosion and duplicate primary keys", () => {
    const mockDiff = createMockDiffResult(false, 0, 50, 0); // 50 added rows
    mockDiff.baseline_row_count = 100;
    mockDiff.target_row_count = 150; // 50% burst
    mockDiff.duplicate_keys_detected = ['["dup_id_1"]'];

    const ctx: StepDiagnosticContext = {
      step_id: "step_enrich",
      operation: "join_datasets",
      diff_result: mockDiff,
    };

    const finding = DiagnosticRuleEngine.evaluateDR04(ctx);
    expect(finding).not.toBeNull();
    expect(finding?.rule_id).toBe(DiagnosticRuleID.DR_04_DUPLICATION_CARDINALITY_BURST);
    expect(finding?.evidence_tier).toBe(EvidenceTier.PROVEN_OBSERVATION);
    expect(finding?.observed).toContain("+50.0%");
    expect(finding?.observed).toContain("duplicate key collisions");
  });

  // DR-05: Null Sentinel Surge
  it("DR-05: detects null transitions from valid baseline values", () => {
    const mockDiff = createMockDiffResult(false, 5);
    mockDiff.sample_row_diffs = [
      {
        category: "MODIFIED",
        _diff_status: "MODIFIED",
        key_values: { id: "1" },
        _key_values: { id: "1" },
        field_diffs: [
          {
            column: "discount_rate",
            baseline_value: 0.15,
            target_value: null,
            is_numeric_tolerant_match: false,
            is_null_transition: true,
            is_numeric_corruption: false,
          },
        ],
      },
    ];

    const ctx: StepDiagnosticContext = {
      step_id: "step_discount",
      operation: "derive_column",
      diff_result: mockDiff,
    };

    const finding = DiagnosticRuleEngine.evaluateDR05(ctx);
    expect(finding).not.toBeNull();
    expect(finding?.rule_id).toBe(DiagnosticRuleID.DR_05_NULL_SENTINEL_SURGE);
    expect(finding?.evidence_tier).toBe(EvidenceTier.PROVEN_OBSERVATION);
    expect(finding?.affected_columns).toContain("discount_rate");
  });

  // DR-06: Non-Deterministic Transformation Detected
  it("DR-06: proves non-determinism when identical inputs yield divergent hashes", () => {
    const ctx: StepDiagnosticContext = {
      step_id: "step_sample",
      operation: "filter_rows",
      is_ingestion_node: false,
      baseline_input_hashes: ["input_hash_xyz"],
      target_input_hashes: ["input_hash_xyz"],
      baseline_parameters: { sample_size: 10 },
      target_parameters: { sample_size: 10 },
      baseline_output_hash: "hash_alpha",
      target_output_hash: "hash_beta",
      diff_result: createMockDiffResult(false, 3),
    };

    const finding = DiagnosticRuleEngine.evaluateDR06(ctx);
    expect(finding).not.toBeNull();
    expect(finding?.rule_id).toBe(DiagnosticRuleID.DR_06_NONDETERMINISTIC_TRANSFORMATION);
    expect(finding?.evidence_tier).toBe(EvidenceTier.PROVEN_OBSERVATION);
    expect(finding?.observed).toContain("Step produced different output hashes");
  });
});
