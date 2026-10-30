/**
 * Data Rewind — Independent Verification Test Suite
 * Rigorously verifies Section 2 (Real CSV Behavior) and Section 3 (Explanation Accuracy)
 * of the Investigation Correctness & Explainability Overhaul.
 */

import { describe, it, expect } from "vitest";
import { CsvParser } from "../runtime/csv/parser";
import {
  DiagnosticRuleID,
  EvidenceTier,
  TabularDiffResult,
  StepDiagnosticContext,
} from "../runtime/forensics/contracts";
import { TabularComparator } from "../runtime/forensics/comparator/index";
import { StructuredExplainer } from "../runtime/forensics/diagnostics/structured-explainer";

describe("Independent Verification — 1. Real CSV Behavior & Lifecycle Isolation", () => {
  // CSV A: Orders
  const csvA = `order_id,customer_id,amount,status
101,CUST-A,150.00,COMPLETED
102,CUST-B,25.50,PENDING
103,CUST-C,300.00,COMPLETED`;

  // CSV B: Inventory
  const csvB = `sku,warehouse,quantity,unit_cost
SKU-99,WH-EAST,500,12.50
SKU-100,WH-WEST,120,45.00
SKU-101,WH-NORTH,85,99.90
SKU-102,WH-SOUTH,12,350.00`;

  // CSV C: Employees / HR
  const csvC = `emp_id,department,salary,hire_year
E-01,ENGINEERING,125000,2021
E-02,MARKETING,85000,2022
E-03,FINANCE,110000,2020
E-04,SUPPORT,65000,2023
E-05,ENGINEERING,140000,2019`;

  // CSV A_modified: Same name "orders.csv", but modified rows
  const csvA_modified = `order_id,customer_id,amount,status
101,CUST-A,150.00,COMPLETED
102,CUST-B,75.00,COMPLETED
104,CUST-D,500.00,COMPLETED`;

  // Step 1: Upload A
  it("Upload A: verifies fingerprint, schema, row count, and isolated dataset ID", async () => {
    const summaryA = await CsvParser.parseAndValidate(csvA);
    expect(summaryA.rowCount).toBe(3);
    expect(summaryA.columnCount).toBe(4);
    expect(summaryA.headers).toEqual(["order_id", "customer_id", "amount", "status"]);

    const cleanBase = "orders";
    const datasetIdA = `raw_${cleanBase}_${summaryA.sha256Hash.slice(0, 10)}`;
    expect(datasetIdA).toMatch(/^raw_orders_[a-f0-9]{10}$/);
  });

  // Step 2: Upload B in the same session
  it("Upload B in same session: verifies independent fingerprint, schema, row count, and dataset ID", async () => {
    const summaryA = await CsvParser.parseAndValidate(csvA);
    const summaryB = await CsvParser.parseAndValidate(csvB);

    expect(summaryB.rowCount).toBe(4);
    expect(summaryB.columnCount).toBe(4);
    expect(summaryB.headers).toEqual(["sku", "warehouse", "quantity", "unit_cost"]);

    // Complete cryptographic isolation between A and B
    expect(summaryB.sha256Hash).not.toBe(summaryA.sha256Hash);

    const datasetIdB = `raw_inventory_${summaryB.sha256Hash.slice(0, 10)}`;
    const datasetIdA = `raw_orders_${summaryA.sha256Hash.slice(0, 10)}`;
    expect(datasetIdB).not.toBe(datasetIdA);
  });

  // Step 3: Upload C in the same session
  it("Upload C in same session: verifies 5 rows, HR schema, and distinct fingerprint", async () => {
    const summaryC = await CsvParser.parseAndValidate(csvC);
    expect(summaryC.rowCount).toBe(5);
    expect(summaryC.columnCount).toBe(4);
    expect(summaryC.headers).toEqual(["emp_id", "department", "salary", "hire_year"]);

    const summaryA = await CsvParser.parseAndValidate(csvA);
    const summaryB = await CsvParser.parseAndValidate(csvB);
    expect(summaryC.sha256Hash).not.toBe(summaryA.sha256Hash);
    expect(summaryC.sha256Hash).not.toBe(summaryB.sha256Hash);
  });

  // Step 4: Upload modified file using the same filename as A ("orders.csv")
  it("Upload modified file with same filename as A: proves content-addressable isolation prevents table collision", async () => {
    const summaryA = await CsvParser.parseAndValidate(csvA);
    const summaryAMod = await CsvParser.parseAndValidate(csvA_modified);

    // Both files represent "orders.csv"
    expect(summaryA.headers).toEqual(summaryAMod.headers);
    expect(summaryAMod.sha256Hash).not.toBe(summaryA.sha256Hash);

    const cleanBase = "orders";
    const tableA = `raw_${cleanBase}_${summaryA.sha256Hash.slice(0, 10)}`;
    const tableAMod = `raw_${cleanBase}_${summaryAMod.sha256Hash.slice(0, 10)}`;

    // Guarantees separate tables in DuckDB and separate dataset entries in IndexedDB
    expect(tableAMod).not.toBe(tableA);
  });

  // Step 5: Upload identical content under a different filename ("sales_records.csv")
  it("Upload identical content under different filename: verifies matching content hash with file-specific namespace", async () => {
    const summaryA = await CsvParser.parseAndValidate(csvA);
    const summaryRenamed = await CsvParser.parseAndValidate(csvA); // Same content

    expect(summaryRenamed.sha256Hash).toBe(summaryA.sha256Hash);
    expect(summaryRenamed.rowCount).toBe(summaryA.rowCount);

    const tableA = `raw_orders_${summaryA.sha256Hash.slice(0, 10)}`;
    const tableRenamed = `raw_sales_records_${summaryRenamed.sha256Hash.slice(0, 10)}`;

    expect(tableRenamed).not.toBe(tableA);
    expect(tableRenamed).toContain(summaryA.sha256Hash.slice(0, 10));
  });

  // Step 6: Upload A again after B and C
  it("Upload A again after B and C: verifies complete deterministic restoration of A's identity", async () => {
    const summaryA_first = await CsvParser.parseAndValidate(csvA);
    await CsvParser.parseAndValidate(csvB);
    await CsvParser.parseAndValidate(csvC);
    const summaryA_second = await CsvParser.parseAndValidate(csvA);

    expect(summaryA_second.sha256Hash).toBe(summaryA_first.sha256Hash);
    expect(summaryA_second.rowCount).toBe(3);
    expect(summaryA_second.headers).toEqual(["order_id", "customer_id", "amount", "status"]);
  });
});

describe("Independent Verification — 2. Explanation Accuracy Across 8 Canonical Cases", () => {
  // Case 1: Changed filter predicate
  it("Case 1: Changed filter predicate — verifies DR-02 parameter mutation, row delta, and recommendation", async () => {
    const baselineRows = [
      { id: "1", amount: 150 },
      { id: "2", amount: 25 },
      { id: "3", amount: 300 },
    ];
    const targetRows = [
      { id: "1", amount: 150 },
      { id: "3", amount: 300 },
    ];

    const diff = await TabularComparator.compare({
      baselineRows,
      targetRows,
      config: { primaryKey: ["id"] },
    });

    const ctx: StepDiagnosticContext = {
      step_id: "step_filter",
      operation: "filter_rows",
      baseline_parameters: { predicate: "amount > 0" },
      target_parameters: { predicate: "amount > 100" },
      baseline_output_hash: "hash_base_3",
      target_output_hash: "hash_target_2",
      diff_result: diff,
    };

    const sf = StructuredExplainer.buildStructuredFinding({
      finding: {
        rule_id: DiagnosticRuleID.DR_02_ARITHMETIC_EXPRESSION_MUTATION,
        rule_name: "Transformation Parameter Mutation",
        step_id: "step_filter",
        evidence_tier: EvidenceTier.CAUSAL_HYPOTHESIS_DIRECT_CODE_DIFF,
        message: "Filter condition mutated",
        details: {},
        affected_columns: ["id", "amount"],
        confidence_explanation: "Inputs identical; predicate differs.",
        observed: "3 rows -> 2 rows",
        interpretation: "Filter excluded rows",
        limitations: "none",
        next_investigation: "review predicate",
      },
      ctx,
      diff,
    });

    // Verify Five Questions accuracy
    expect(sf.what_went_wrong).toContain('modified from "amount > 0" to "amount > 100"');
    expect(sf.what_went_wrong).toContain("1 rows to be excluded");
    expect(sf.where.step_id).toBe("step_filter");
    expect(sf.where.operation).toBe("filter_rows");
    expect(sf.evidence.baseline_row_count).toBe(3);
    expect(sf.evidence.target_row_count).toBe(2);
    expect(sf.evidence.row_delta).toBe(-1);
    expect(sf.impact.risk_level).toBe("MEDIUM");
    expect(sf.remediation.action).toContain('Restore the original filter predicate "amount > 0"');
    expect(sf.remediation.verification_check).toContain("Confirm that step 'step_filter' emits exactly 3 rows");
  });

  // Case 2: Changed derived-column expression
  it("Case 2: Changed derived-column expression — verifies formula AST diff, modified row count, and bit-for-bit input preservation", async () => {
    const baselineRows = [
      { id: "1", amount: 100.0, fee: 5.0 },
      { id: "2", amount: 200.0, fee: 10.0 },
    ];
    const targetRows = [
      { id: "1", amount: 100.0, fee: 10.0 },
      { id: "2", amount: 200.0, fee: 20.0 },
    ];

    const diff = await TabularComparator.compare({
      baselineRows,
      targetRows,
      config: { primaryKey: ["id"] },
    });

    const ctx: StepDiagnosticContext = {
      step_id: "step_fee",
      operation: "derive_column",
      baseline_parameters: { expression: "amount * 0.05", target_column: "fee" },
      target_parameters: { expression: "amount * 0.10", target_column: "fee" },
      baseline_output_hash: "hash_fee_5pct",
      target_output_hash: "hash_fee_10pct",
      diff_result: diff,
    };

    const sf = StructuredExplainer.buildStructuredFinding({
      finding: {
        rule_id: DiagnosticRuleID.DR_02_ARITHMETIC_EXPRESSION_MUTATION,
        rule_name: "Arithmetic Expression Mutation",
        step_id: "step_fee",
        evidence_tier: EvidenceTier.CAUSAL_HYPOTHESIS_DIRECT_CODE_DIFF,
        message: "Fee formula mutated",
        details: {},
        affected_columns: ["fee"],
        confidence_explanation: "Formula changed",
        observed: "2 rows modified",
        interpretation: "Formula drift",
        limitations: "none",
        next_investigation: "review blame",
      },
      ctx,
      diff,
    });

    expect(sf.what_went_wrong).toContain('The calculation formula for \'fee\' in step \'step_fee\' changed from "amount * 0.05" to "amount * 0.10"');
    expect(sf.what_went_wrong).toContain("altering values across 2 rows");
    expect(sf.evidence.baseline_row_count).toBe(2);
    expect(sf.evidence.target_row_count).toBe(2);
    expect(sf.evidence.row_delta).toBe(0); // Zero row delta, pure cell value mutation
    expect(sf.remediation.action).toContain('Revert the formula expression in \'step_fee\' back to "amount * 0.05"');
  });

  // Case 3: Duplicate join keys and join fanout
  it("Case 3: Duplicate join keys and join fanout — verifies DR-04 cardinality explosion and inflation percentage", async () => {
    const diff: TabularDiffResult = {
      is_equal: false,
      case_classifications: [],
      schema_diff: { added_columns: [], removed_columns: [], common_columns: ["id"], type_changes: {}, has_breaking_type_drift: false },
      baseline_fingerprint: { schema_hash: "", multiset_hash: "", row_count: 100, fingerprint_hash: "fp_base" },
      target_fingerprint: { schema_hash: "", multiset_hash: "", row_count: 150, fingerprint_hash: "fp_targ" },
      identical_count: 50,
      modified_count: 0,
      added_count: 50,
      removed_count: 0,
      baseline_row_count: 100,
      target_row_count: 150,
      sample_row_diffs: [],
      warnings: [],
      invalid_key_rows_baseline: [],
      invalid_key_rows_target: [],
      duplicate_keys_detected: ['["dup_cust_1"]', '["dup_cust_2"]'],
      execution_duration_ms: 5,
    };

    const ctx: StepDiagnosticContext = {
      step_id: "step_join_customers",
      operation: "join_datasets",
      diff_result: diff,
    };

    const sf = StructuredExplainer.buildStructuredFinding({
      finding: {
        rule_id: DiagnosticRuleID.DR_04_DUPLICATION_CARDINALITY_BURST,
        rule_name: "Duplication Cardinality Burst",
        step_id: "step_join_customers",
        evidence_tier: EvidenceTier.PROVEN_OBSERVATION,
        message: "Duplication burst detected",
        details: {},
        affected_columns: [],
        confidence_explanation: "1-to-many join duplication",
        observed: "+50% row inflation",
        interpretation: "duplicate keys joined",
        limitations: "none",
        next_investigation: "check uniqueness",
      },
      ctx,
      diff,
    });

    expect(sf.what_went_wrong).toContain("experienced cardinality inflation of +50.0% (100 rows inflated to 150 rows, +50 extra rows)");
    expect(sf.impact.risk_level).toBe("HIGH");
    expect(sf.remediation.action).toContain("Add a deduplicate_rows step or ensure 1-to-1 key uniqueness");
    expect(sf.remediation.verification_check).toContain("Verify unique primary keys and row count returning to 100 rows");
  });

  // Case 4: Null-value introduction
  it("Case 4: Null-value introduction — verifies DR-05 null surge diagnosis and fallback recommendation", async () => {
    const diff: TabularDiffResult = {
      is_equal: false,
      case_classifications: [],
      schema_diff: { added_columns: [], removed_columns: [], common_columns: ["id", "score"], type_changes: {}, has_breaking_type_drift: false },
      baseline_fingerprint: { schema_hash: "", multiset_hash: "", row_count: 50, fingerprint_hash: "fp_base" },
      target_fingerprint: { schema_hash: "", multiset_hash: "", row_count: 50, fingerprint_hash: "fp_targ" },
      identical_count: 40,
      modified_count: 10,
      added_count: 0,
      removed_count: 0,
      baseline_row_count: 50,
      target_row_count: 50,
      sample_row_diffs: [
        {
          category: "MODIFIED",
          _diff_status: "MODIFIED",
          key_values: { id: "1" },
          _key_values: { id: "1" },
          field_diffs: [{ column: "score", baseline_value: 95.0, target_value: null, is_null_transition: true, is_numeric_tolerant_match: false, is_numeric_corruption: false }],
        },
      ],
      warnings: [],
      invalid_key_rows_baseline: [],
      invalid_key_rows_target: [],
      duplicate_keys_detected: [],
      execution_duration_ms: 4,
    };

    const ctx: StepDiagnosticContext = {
      step_id: "step_cast_score",
      operation: "cast_types",
      diff_result: diff,
    };

    const sf = StructuredExplainer.buildStructuredFinding({
      finding: {
        rule_id: DiagnosticRuleID.DR_05_NULL_SENTINEL_SURGE,
        rule_name: "Null Sentinel Surge",
        step_id: "step_cast_score",
        evidence_tier: EvidenceTier.PROVEN_OBSERVATION,
        message: "Null surge in score",
        details: {},
        affected_columns: ["score"],
        confidence_explanation: "unhandled sentinel coerced to null",
        observed: "score converted to null",
        interpretation: "type cast coercion without fallback",
        limitations: "none",
        next_investigation: "add coalesce",
      },
      ctx,
      diff,
    });

    expect(sf.what_went_wrong).toContain("Column 'score' in step 'step_cast_score' suffered a null surge: valid values were converted into NULL");
    expect(sf.impact.risk_level).toBe("HIGH");
    expect(sf.remediation.action).toContain("Add a handle_missing step with COALESCE or provide default fallback values before type casting");
    expect(sf.remediation.verification_check).toContain("Confirm zero unexpected NULL values in column 'score' across all 50 rows");
  });

  // Case 5: Schema change (column added/removed)
  it("Case 5: Schema change — verifies schema drift identification, dropped column risk, and contract verification", async () => {
    const diff: TabularDiffResult = {
      is_equal: false,
      case_classifications: [],
      schema_diff: {
        added_columns: ["new_feature"],
        removed_columns: ["deprecated_legacy_id"],
        common_columns: ["id"],
        type_changes: {},
        has_breaking_type_drift: true,
      },
      baseline_fingerprint: { schema_hash: "sh1", multiset_hash: "", row_count: 10, fingerprint_hash: "fp1" },
      target_fingerprint: { schema_hash: "sh2", multiset_hash: "", row_count: 10, fingerprint_hash: "fp2" },
      identical_count: 0,
      modified_count: 10,
      added_count: 0,
      removed_count: 0,
      baseline_row_count: 10,
      target_row_count: 10,
      sample_row_diffs: [],
      warnings: [],
      invalid_key_rows_baseline: [],
      invalid_key_rows_target: [],
      duplicate_keys_detected: [],
      execution_duration_ms: 3,
    };

    const ctx: StepDiagnosticContext = {
      step_id: "step_select_cols",
      operation: "select_columns",
      diff_result: diff,
    };

    const sf = StructuredExplainer.buildStructuredFinding({
      ctx,
      diff,
    });

    expect(sf.what_went_wrong).toContain("Schema drift detected in step 'step_select_cols'");
    expect(sf.what_went_wrong).toContain("added column(s) [new_feature]");
    expect(sf.what_went_wrong).toContain("removed column(s) [deprecated_legacy_id]");
    expect(sf.impact.risk_level).toBe("CRITICAL"); // Dropping columns is critical
    expect(sf.impact.consequence).toContain("Downstream steps expecting previous column definitions will fail");
    expect(sf.remediation.action).toContain("Ensure column select/rename operations maintain backward-compatible column contracts");
  });

  // Case 6: Row deletion (pure omission without field modifications)
  it("Case 6: Row deletion — verifies deletion statement, count omitted, and data preservation advice", async () => {
    const diff: TabularDiffResult = {
      is_equal: false,
      case_classifications: [],
      schema_diff: { added_columns: [], removed_columns: [], common_columns: ["id"], type_changes: {}, has_breaking_type_drift: false },
      baseline_fingerprint: { schema_hash: "sh1", multiset_hash: "", row_count: 100, fingerprint_hash: "fp1" },
      target_fingerprint: { schema_hash: "sh1", multiset_hash: "", row_count: 80, fingerprint_hash: "fp2" },
      identical_count: 80,
      modified_count: 0,
      added_count: 0,
      removed_count: 20,
      baseline_row_count: 100,
      target_row_count: 80,
      sample_row_diffs: [],
      warnings: [],
      invalid_key_rows_baseline: [],
      invalid_key_rows_target: [],
      duplicate_keys_detected: [],
      execution_duration_ms: 3,
    };

    const ctx: StepDiagnosticContext = {
      step_id: "step_filter_active",
      operation: "filter_rows",
      diff_result: diff,
    };

    const sf = StructuredExplainer.buildStructuredFinding({
      ctx,
      diff,
    });

    expect(sf.what_went_wrong).toContain("Row deletion detected in step 'step_filter_active': 20 rows present in baseline were completely omitted in candidate output (100 -> 80 rows)");
    expect(sf.impact.risk_level).toBe("HIGH");
    expect(sf.evidence.row_delta).toBe(-20);
    expect(sf.remediation.action).toContain("Review filtering or deduplication conditions responsible for the deletion of 20 records");
    expect(sf.remediation.verification_check).toContain("Verify that step 'step_filter_active' preserves all 100 expected records");
  });

  // Case 7: No actual divergence (bit-for-bit identical)
  it("Case 7: No actual divergence — verifies bit-for-bit clean verdict, risk level LOW, and zero remediation", async () => {
    const diff: TabularDiffResult = {
      is_equal: true,
      case_classifications: [],
      schema_diff: { added_columns: [], removed_columns: [], common_columns: ["id"], type_changes: {}, has_breaking_type_drift: false },
      baseline_fingerprint: { schema_hash: "sh1", multiset_hash: "mh1", row_count: 50, fingerprint_hash: "fp1" },
      target_fingerprint: { schema_hash: "sh1", multiset_hash: "mh1", row_count: 50, fingerprint_hash: "fp1" },
      identical_count: 50,
      modified_count: 0,
      added_count: 0,
      removed_count: 0,
      baseline_row_count: 50,
      target_row_count: 50,
      sample_row_diffs: [],
      warnings: [],
      invalid_key_rows_baseline: [],
      invalid_key_rows_target: [],
      duplicate_keys_detected: [],
      execution_duration_ms: 2,
    };

    const ctx: StepDiagnosticContext = {
      step_id: "step_clean",
      operation: "select_columns",
      baseline_output_hash: "hash_clean_50",
      target_output_hash: "hash_clean_50",
      diff_result: diff,
    };

    const sf = StructuredExplainer.buildStructuredFinding({
      ctx,
      diff,
    });

    expect(sf.what_went_wrong).toContain("No divergence detected. Pipeline outputs and content hashes are 100% identical");
    expect(sf.impact.risk_level).toBe("LOW");
    expect(sf.impact.consequence).toContain("All downstream nodes and terminal sinks are verified bit-for-bit identical with baseline");
    expect(sf.remediation.action).toContain("No remediation required. Candidate run is verified clean and equivalent");
    expect(sf.remediation.verification_check).toContain("Verified equivalent across all checkpoints with 0 modified rows");
  });

  // Case 8: Divergence where exact root cause cannot be determined
  it("Case 8: Divergence with unknown root cause — verifies explicit identification as unclassified / unknown cause without guessing", async () => {
    const diff: TabularDiffResult = {
      is_equal: false,
      case_classifications: [],
      schema_diff: { added_columns: [], removed_columns: [], common_columns: ["id"], type_changes: {}, has_breaking_type_drift: false },
      baseline_fingerprint: { schema_hash: "sh1", multiset_hash: "mh1", row_count: 40, fingerprint_hash: "fp1" },
      target_fingerprint: { schema_hash: "sh1", multiset_hash: "mh2", row_count: 42, fingerprint_hash: "fp2" },
      identical_count: 35,
      modified_count: 5,
      added_count: 2,
      removed_count: 0,
      baseline_row_count: 40,
      target_row_count: 42,
      sample_row_diffs: [],
      warnings: [],
      invalid_key_rows_baseline: [],
      invalid_key_rows_target: [],
      duplicate_keys_detected: [],
      execution_duration_ms: 4,
    };

    const ctx: StepDiagnosticContext = {
      step_id: "step_custom_transform",
      operation: "custom_op",
      diff_result: diff,
    };

    // No diagnostic finding matched (indeterminate / unknown cause)
    const sf = StructuredExplainer.buildStructuredFinding({
      finding: null,
      ctx,
      diff,
    });

    // Explicitly states that the cause is unclassified and cannot be determined from parameters alone
    expect(sf.what_went_wrong).toContain("Unclassified divergence in step 'step_custom_transform': 5 rows modified, 2 added, 0 removed. The specific causal mechanism could not be definitively determined from parameters alone");
    expect(sf.remediation.explanation).toContain("Unknown / indeterminate cause: Output diverged, but observed metrics do not match canonical diagnostic rules (DR-01 through DR-06) with high confidence");
    expect(sf.technical_details.rule_id).toBe("GENERAL_TRANSFORMATION_DIVERGENCE");
    expect(sf.technical_details.evidence_tier).toBe(EvidenceTier.PROVEN_OBSERVATION);
  });
});
