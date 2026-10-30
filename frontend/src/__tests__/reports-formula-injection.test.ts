/**
 * Data Rewind Type-Aware Formula-Injection & Report Exporters Tests.
 * Conforms strictly to SPEC-MOD-05 §2.2.
 */

import { describe, it, expect } from "vitest";
import { CSVFormulaEscaper } from "../runtime/reports/formula-escaper";
import { CSVExporter } from "../runtime/reports/csv-exporter";
import { JSONDossierExporter } from "../runtime/reports/json-exporter";
import { MarkdownDossierExporter } from "../runtime/reports/markdown-exporter";
import { ForensicDossier } from "../types/api";

describe("Type-Aware Formula-Injection Sanitization (SPEC-MOD-05 §2.2)", () => {
  describe("CSVFormulaEscaper.sanitizeCell", () => {
    it("preserves SQL NULL / undefined as empty string", () => {
      expect(CSVFormulaEscaper.sanitizeCell(null)).toEqual(["", false]);
      expect(CSVFormulaEscaper.sanitizeCell(undefined)).toEqual(["", false]);
    });

    it("Numeric Preservation Rule: INTEGER and FLOAT columns are NEVER prefixed", () => {
      // Negative numbers
      expect(CSVFormulaEscaper.sanitizeCell(-42.5, "FLOAT")).toEqual(["-42.5", false]);
      expect(CSVFormulaEscaper.sanitizeCell(-100, "INTEGER")).toEqual(["-100", false]);
      expect(CSVFormulaEscaper.sanitizeCell("-42.50", "FLOAT")).toEqual(["-42.50", false]);
      expect(CSVFormulaEscaper.sanitizeCell("-100", "DECIMAL")).toEqual(["-100", false]);

      // Positive numbers with leading +
      expect(CSVFormulaEscaper.sanitizeCell("+100", "INTEGER")).toEqual(["+100", false]);
      expect(CSVFormulaEscaper.sanitizeCell("+42.5", "DOUBLE")).toEqual(["+42.5", false]);
    });

    it("String sanitization: escapes dangerous formula prefixes", () => {
      // Equals formula prefix
      const [res1, esc1] = CSVFormulaEscaper.sanitizeCell("=CMD|' /C calc'!A0", "STRING");
      expect(res1).toBe("'=CMD|' /C calc'!A0");
      expect(esc1).toBe(true);

      // At symbol formula prefix
      const [res2, esc2] = CSVFormulaEscaper.sanitizeCell("@SUM(A1:B10)", "STRING");
      expect(res2).toBe("'@SUM(A1:B10)");
      expect(esc2).toBe(true);

      // Arithmetic string expressions that are NOT pure numbers
      const [res3, esc3] = CSVFormulaEscaper.sanitizeCell("-2+3", "STRING");
      expect(res3).toBe("'-2+3");
      expect(esc3).toBe(true);

      const [res4, esc4] = CSVFormulaEscaper.sanitizeCell("+1+1", "STRING");
      expect(res4).toBe("'+1+1");
      expect(esc4).toBe(true);

      // Tab prefix
      const [res5, esc5] = CSVFormulaEscaper.sanitizeCell("\t=cmd", "STRING");
      expect(res5).toBe("'\t=cmd");
      expect(esc5).toBe(true);
    });

    it("String sanitization: preserves valid numeric literals in text columns unescaped", () => {
      // Pure signed numbers in text columns
      const [res1, esc1] = CSVFormulaEscaper.sanitizeCell("-42.50", "STRING");
      expect(res1).toBe("-42.50");
      expect(esc1).toBe(false);

      const [res2, esc2] = CSVFormulaEscaper.sanitizeCell("+100", "STRING");
      expect(res2).toBe("+100");
      expect(esc2).toBe(false);
    });

    it("Preserves standalone pipe | unescaped", () => {
      const [res, esc] = CSVFormulaEscaper.sanitizeCell("|", "STRING");
      expect(res).toBe("|");
      expect(esc).toBe(false);
    });

    it("Raw Export Mode preserves bit-for-bit raw values without escaping", () => {
      const dangerous = "=CMD|' /C calc'!A0";
      const [res, esc] = CSVFormulaEscaper.sanitizeCell(dangerous, "STRING", "raw");
      expect(res).toBe(dangerous);
      expect(esc).toBe(false);
    });
  });

  describe("CSVExporter", () => {
    it("exports rows with RFC 4180 quotes and formula neutralization", () => {
      const rows = [
        { id: 1, name: "Alice", formula_col: "=1+1", balance: -42.5 },
        { id: 2, name: "Bob, Jr.", formula_col: "normal", balance: 100 },
      ];

      const { csvContent, escapedCount } = CSVExporter.exportRows(
        rows,
        ["id", "name", "formula_col", "balance"],
        {
          mode: "safe",
          columnTypes: { balance: "FLOAT" },
        }
      );

      expect(escapedCount).toBe(1); // '=1+1 was escaped
      expect(csvContent).toContain("id,name,formula_col,balance");
      expect(csvContent).toContain("1,Alice,'=1+1,-42.5");
      expect(csvContent).toContain('2,"Bob, Jr.",normal,100');
    });

    it("includes warning comment in raw mode", () => {
      const rows = [{ id: 1, cmd: "=evil()" }];
      const { csvContent, escapedCount } = CSVExporter.exportRows(rows, ["id", "cmd"], {
        mode: "raw",
        includeHeaderComment: true,
      });

      expect(escapedCount).toBe(0);
      expect(csvContent).toContain("# WARNING: Raw Export Mode");
      expect(csvContent).toContain("1,=evil()");
    });
  });

  describe("JSON & Markdown Dossier Exporters", () => {
    const mockDossier: ForensicDossier = {
      metadata: {
        dossier_id: "dossier_test_01",
        pipeline_name: "Test Pipeline",
        pipeline_version_hash: "v_hash_01",
        investigator_session: "session_01",
        faulted_run_id: "r1",
        candidate_run_id: "r2",
        created_at: new Date().toISOString(),
      },
      verification: {
        verification_id: "v_01",
        title: "Fix Verification Dossier",
        faulted_run_id: "r1",
        candidate_run_id: "r2",
        verdict: "VERIFIED_CLEAN",
        verdict_meaning: "Candidate fix completely eliminates the reported regression with zero collateral divergence.",
        verdict_reason_codes: ["REASON_CLEAN_REMEDIATION"],
        dual_axis: {
          remediation_axis: {
            eod_step: "step_calc",
            eod_remediated: true,
            eod_severity_reduced: true,
            unresolved_eod_differences: [],
            explanation: "EOD defect eliminated.",
          },
          baseline_axis: {
            baseline_equivalent_at_sinks: true,
            baseline_equivalent_across_all_steps: true,
            collateral_regressions: [],
            sink_step_ids: ["sink_step"],
            step_comparisons: {},
            explanation: "100% equivalent to golden baseline.",
          },
        },
        evidence_chain: [
          {
            tier: "PROVEN_OBSERVATION",
            step_id: "step_calc",
            category: "EOD_REMEDIATION",
            description: "Step multiset hashes matched golden baseline.",
            remediation_advice: "Fix verified.",
          },
        ],
        missing_evidence: [],
        created_at: new Date().toISOString(),
        duration_ms: 12.5,
      },
      reproducibility_signatures: {
        r0_hash: "r0_h",
        r1_hash: "r1_h",
        r2_hash: "r2_h",
      },
      limitations_disclaimer: "Forensic evidence is compiled locally via deterministic tabular comparisons.",
    };

    it("exports clean structured JSON", () => {
      const jsonStr = JSONDossierExporter.export(mockDossier);
      const parsed = JSON.parse(jsonStr);
      expect(parsed.metadata.dossier_id).toBe("dossier_test_01");
      expect(parsed.verification.verdict).toBe("VERIFIED_CLEAN");
    });

    it("renders audit-ready Markdown document", () => {
      const md = MarkdownDossierExporter.export(mockDossier);
      expect(md).toContain("# Forensic Investigation Dossier: Fix Verification Dossier");
      expect(md).toContain("### Verdict: [PASS] **VERIFIED CLEAN**");
      expect(md).toContain("## 3. Dual-Axis Fix Verification Evaluation");
      expect(md).toContain("Axis 1: Remediation Evaluation");
      expect(md).toContain("Axis 2: Baseline Equivalence");
      expect(md).toContain("## 4. Itemized Evidence Chain");
      expect(md).toContain("## 7. Limitations & Integrity Disclaimer");
    });
  });
});
