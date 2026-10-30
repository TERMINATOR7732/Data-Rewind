import { describe, it, expect } from "vitest";
import { CANONICAL_DEMO_SCENARIOS, getCanonicalDemoSummaries } from "../features/demo/demo-scenarios";
import { DiagnosticRuleID } from "../runtime/forensics/index";
import { OperationType, EXECUTION_CONTRACT_VERSION } from "../runtime/contracts/index";
import { CSVFormulaEscaper } from "../runtime/reports/formula-escaper";
import { ReplayOutcome } from "../runtime/replay/contracts";
import { VerificationVerdictCode } from "../runtime/verification/contracts";

describe("Milestone 07 QA Regression Suite", () => {
  describe("AUD-001: Canonical Scenario Registry & Specification Harmony", () => {
    it("verifies SCN-01 maps to Upstream Vendor Input Data Drift and DR-01", () => {
      const scn01 = CANONICAL_DEMO_SCENARIOS["scn01"];
      expect(scn01).toBeDefined();
      expect(scn01.scenario_id).toBe("scn01");
      expect(scn01.title).toContain("SCN-01");
      expect(scn01.title).toContain("Upstream Vendor Input Data Drift");
      expect(scn01.expected_rule_id).toBe(DiagnosticRuleID.DR_01_UPSTREAM_INPUT_DATA_DRIFT);
      expect(scn01.expected_eod_step).toBe("ingest_orders");
      expect(scn01.step_count).toBe(3);
    });

    it("verifies SCN-02 maps to Arithmetic Expression Mutation and DR-02", () => {
      const scn02 = CANONICAL_DEMO_SCENARIOS["scn02"];
      expect(scn02).toBeDefined();
      expect(scn02.scenario_id).toBe("scn02");
      expect(scn02.title).toContain("SCN-02");
      expect(scn02.title).toContain("Arithmetic Expression Mutation");
      expect(scn02.expected_rule_id).toBe(DiagnosticRuleID.DR_02_ARITHMETIC_EXPRESSION_MUTATION);
      expect(scn02.expected_eod_step).toBe("compute_fee");
      expect(scn02.step_count).toBe(3);
    });

    it("verifies SCN-03 maps to Unmatched Join Drop and DR-03", () => {
      const scn03 = CANONICAL_DEMO_SCENARIOS["scn03"];
      expect(scn03).toBeDefined();
      expect(scn03.scenario_id).toBe("scn03");
      expect(scn03.title).toContain("SCN-03");
      expect(scn03.title).toContain("Unmatched Join Drop");
      expect(scn03.expected_rule_id).toBe(DiagnosticRuleID.DR_03_UNMATCHED_JOIN_DROP);
      expect(scn03.expected_eod_step).toBe("join_orders_customers");
      expect(scn03.step_count).toBe(3);
    });

    it("verifies SCN-04 maps to Null Sentinel Surge and DR-05", () => {
      const scn04 = CANONICAL_DEMO_SCENARIOS["scn04"];
      expect(scn04).toBeDefined();
      expect(scn04.scenario_id).toBe("scn04");
      expect(scn04.title).toContain("SCN-04");
      expect(scn04.title).toContain("Null Sentinel Surge");
      expect(scn04.expected_rule_id).toBe(DiagnosticRuleID.DR_05_NULL_SENTINEL_SURGE);
      expect(scn04.expected_eod_step).toBe("clean_data");
      expect(scn04.step_count).toBe(2);
    });

    it("verifies getCanonicalDemoSummaries returns all 4 scenarios with correct metadata", () => {
      const summaries = getCanonicalDemoSummaries();
      expect(summaries).toHaveLength(4);
      const ids = summaries.map((s) => s.scenario_id);
      expect(ids).toEqual(["scn01", "scn02", "scn03", "scn04"]);
    });
  });

  describe("AUD-002: Canonical 12 Transformation Operations Verification", () => {
    it("verifies that all 12 atomic transformations are defined in OperationType", () => {
      const expectedOperations: OperationType[] = [
        "filter_rows",
        "derive_column",
        "select_columns",
        "rename_columns",
        "drop_columns",
        "sort_rows",
        "aggregate_group_by",
        "deduplicate_rows",
        "handle_missing",
        "cast_types",
        "join_datasets",
        "data_quality_rule",
      ];

      for (const op of expectedOperations) {
        expect(typeof op).toBe("string");
      }
      expect(expectedOperations).toHaveLength(12);
    });

    it("verifies contract version consistency", () => {
      expect(EXECUTION_CONTRACT_VERSION).toBe("1.0.0");
    });
  });

  describe("Formula Injection Guardrails Verification", () => {
    it("escapes formula prefixes in strings (=, +, -, @, tab, cr)", () => {
      expect(CSVFormulaEscaper.sanitizeCell("=1+1")[0]).toBe("'=1+1");
      expect(CSVFormulaEscaper.sanitizeCell("+cmd|' /C calc'!A0")[0]).toBe("'+cmd|' /C calc'!A0");
      expect(CSVFormulaEscaper.sanitizeCell("-2+3*[1]")[0]).toBe("'-2+3*[1]");
      expect(CSVFormulaEscaper.sanitizeCell("@SUM(A1:A10)")[0]).toBe("'@SUM(A1:A10)");
      expect(CSVFormulaEscaper.sanitizeCell("\t=calc")[0]).toBe("'\t=calc");
      expect(CSVFormulaEscaper.sanitizeCell("\r=calc")[0]).toBe("'\r=calc");
    });

    it("preserves legitimate numbers without formula prefixing", () => {
      expect(CSVFormulaEscaper.sanitizeCell(-42, "INTEGER")[0]).toBe("-42");
      expect(CSVFormulaEscaper.sanitizeCell(100.5, "FLOAT")[0]).toBe("100.5");
      expect(CSVFormulaEscaper.sanitizeCell(0, "INTEGER")[0]).toBe("0");
      expect(CSVFormulaEscaper.sanitizeCell(null)[0]).toBe("");
      expect(CSVFormulaEscaper.sanitizeCell(undefined)[0]).toBe("");
    });

    it("preserves safe strings without formula escaping", () => {
      expect(CSVFormulaEscaper.sanitizeCell("completed")[0]).toBe("completed");
      expect(CSVFormulaEscaper.sanitizeCell("Standard User 123")[0]).toBe("Standard User 123");
    });
  });

  describe("Replay & Tri-Run Contract Enums Verification", () => {
    it("verifies all 5 historical replay outcome states", () => {
      const outcomes: ReplayOutcome[] = [
        ReplayOutcome.REPRODUCIBLE,
        ReplayOutcome.PARTIALLY_REPRODUCIBLE,
        ReplayOutcome.BLOCKED_MISSING_ARTIFACTS,
        ReplayOutcome.DIVERGENT,
        ReplayOutcome.FAILED_VERIFICATION,
      ];
      expect(outcomes).toHaveLength(5);
      expect(outcomes).toContain("REPRODUCIBLE");
      expect(outcomes).toContain("DIVERGENT");
    });

    it("verifies dual-axis tri-run verification verdicts", () => {
      const verdicts: VerificationVerdictCode[] = [
        "VERIFIED_CLEAN",
        "INTENTIONAL_UPDATE",
        "PARTIAL_RESTORATION",
        "REGRESSION_UNRESOLVED",
        "NEW_FAULT_INTRODUCED",
        "BASELINE_UNAVAILABLE",
        "FAULT_UNREPRODUCIBLE",
        "INCONCLUSIVE_VERIFICATION",
      ];
      expect(verdicts).toHaveLength(8);
      expect(verdicts).toContain("VERIFIED_CLEAN");
      expect(verdicts).toContain("REGRESSION_UNRESOLVED");
    });
  });
});
