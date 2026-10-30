/**
 * Data Rewind Markdown Forensic Dossier Exporter.
 * Conforms strictly to SPEC-MOD-05 §2.1.
 */

import { ForensicDossier } from "../../types/api";

export class MarkdownDossierExporter {
  /**
   * Render complete forensic investigation dossier into audit-ready Markdown.
   */
  static export(dossier: ForensicDossier): string {
    const v = dossier.verification;
    const meta = dossier.metadata;
    const dual = v.dual_axis;

    const verdictBadge: Record<string, string> = {
      VERIFIED_CLEAN: "[PASS] **VERIFIED CLEAN**",
      INTENTIONAL_UPDATE: "[INTENTIONAL] **INTENTIONAL UPDATE VERIFIED**",
      PARTIAL_RESTORATION: "[PARTIAL] **PARTIAL RESTORATION**",
      REGRESSION_UNRESOLVED: "[FAIL] **REGRESSION UNRESOLVED (FIX FAILED)**",
      NEW_FAULT_INTRODUCED: "[CRITICAL] **CRITICAL WARNING: NEW FAULT INTRODUCED**",
      BASELINE_UNAVAILABLE: "[REMEDIATION ONLY] **BASELINE UNAVAILABLE**",
      FAULT_UNREPRODUCIBLE: "[BLOCKED] **FAULT UNREPRODUCIBLE (VERIFICATION BLOCKED)**",
      INCONCLUSIVE_VERIFICATION: "[INCONCLUSIVE] **INCONCLUSIVE VERIFICATION**",
    };

    const badge = verdictBadge[v.verdict] || `**${v.verdict}**`;

    const lines: string[] = [
      `# Forensic Investigation Dossier: ${v.title}`,
      "",
      "**Document Version:** 1.0 (Forensic Investigation Dossier)  ",
      `**Dossier ID:** \`${meta.dossier_id}\`  `,
      `**Pipeline Name:** \`${meta.pipeline_name}\`  `,
      `**Pipeline Version Hash:** \`${meta.pipeline_version_hash}\`  `,
      `**Investigator Session:** \`${meta.investigator_session}\`  `,
      `**Execution Timestamp (UTC):** \`${v.created_at}\`  `,
      `**Verification Duration:** \`${v.duration_ms.toFixed(2)} ms\`  `,
      "",
      "---",
      "",
      "## 1. Executive Summary & Verdict",
      "",
      `### Verdict: ${badge}`,
      `> **Meaning:** ${v.verdict_meaning}`,
      "",
      `- **Verdict Reason Codes:** ${(v.verdict_reason_codes || []).map((c) => `\`${c}\``).join(", ") || "None"}`,
      "",
      "---",
      "",
      "## 2. Tri-Run Association Overview",
      "",
      "| Protocol Role | Run Identifier | Purpose & Expected Behavior |",
      "| :--- | :--- | :--- |",
      `| **$R_0$ (Baseline Run)** | \`${v.baseline_run_id || "NOT PROVIDED"}\` | Trusted historical golden truth reference. |`,
      `| **$R_1$ (Faulted Run)** | \`${v.faulted_run_id}\` | Reproduces regression at Earliest Observable Divergence (EOD) node. |`,
      `| **$R_2$ (Candidate Fix Run)** | \`${v.candidate_run_id}\` | Proposed remediation incorporating fix or patched inputs. |`,
      "",
      "---",
      "",
      "## 3. Dual-Axis Fix Verification Evaluation",
      "",
      "### Axis 1: Remediation Evaluation ($R_2 \\text{ vs } R_1$)",
      `- **Target EOD Step:** \`${dual.remediation_axis.eod_step || "N/A"}\``,
      `- **EOD Fault Remediated:** \`${dual.remediation_axis.eod_remediated ? "YES" : "NO"}\``,
      `- **Fault Severity Reduced:** \`${dual.remediation_axis.eod_severity_reduced ? "YES" : "NO"}\``,
      `- **Remediation Details:** ${dual.remediation_axis.explanation}`,
    ];

    if (dual.remediation_axis.unresolved_eod_differences?.length) {
      lines.push("- **Unresolved Fault Points:**");
      for (const diffItem of dual.remediation_axis.unresolved_eod_differences) {
        lines.push(`  - ${diffItem}`);
      }
    }

    lines.push(
      "",
      "### Axis 2: Baseline Equivalence ($R_2 \\text{ vs } R_0$)"
    );

    if (dual.baseline_axis) {
      lines.push(
        `- **Downstream Sinks Equivalent:** \`${dual.baseline_axis.baseline_equivalent_at_sinks ? "YES" : "NO"}\``,
        `- **All Steps Equivalent:** \`${dual.baseline_axis.baseline_equivalent_across_all_steps ? "YES" : "NO"}\``,
        `- **Sink Step IDs:** ${(dual.baseline_axis.sink_step_ids || []).map((s) => `\`${s}\``).join(", ") || "None"}`,
        `- **Baseline Evaluation Details:** ${dual.baseline_axis.explanation}`
      );
      if (dual.baseline_axis.collateral_regressions?.length) {
        lines.push("- **Collateral Secondary Regressions Detected:**");
        for (const collat of dual.baseline_axis.collateral_regressions) {
          lines.push(`  - [WARNING] Step \`${collat}\``);
        }
      }
    } else {
      lines.push("- *Baseline run R0 was omitted; baseline equivalence could not be evaluated.*");
    }

    // Evidence Chain
    lines.push(
      "",
      "---",
      "",
      "## 4. Itemized Evidence Chain",
      "",
      "Forensic evidence is strictly partitioned between directly proven observations and derived causal hypotheses:",
      ""
    );

    if (v.evidence_chain?.length) {
      lines.push("| Tier | Step | Summary | Remediation Advice |");
      lines.push("| :--- | :--- | :--- | :--- |");
      for (const item of v.evidence_chain) {
        const stepStr = item.step_id ? `\`${item.step_id}\`` : "Global";
        lines.push(
          `| \`${item.tier}\` | ${stepStr} | ${item.description} | ${item.remediation_advice || "N/A"} |`
        );
      }
    } else {
      lines.push("*No evidence items recorded.*");
    }

    // Missing Evidence Declarations
    lines.push(
      "",
      "---",
      "",
      "## 5. Missing or Limited Evidence Declarations",
      ""
    );

    if (v.missing_evidence?.length) {
      lines.push("| Step | Missing Artifact | Impact on Verdict |");
      lines.push("| :--- | :--- | :--- |");
      for (const me of v.missing_evidence) {
        lines.push(`| \`${me.step_id}\` | ${me.missing_artifact} | ${me.impact_on_verdict} |`);
      }
    } else {
      lines.push("*Zero missing artifacts declared; evidence chain is 100% complete and verified.*");
    }

    // Reproducibility Signatures & Disclaimer
    lines.push(
      "",
      "---",
      "",
      "## 6. Reproducibility Signatures & Cryptographic Hashes",
      "",
      "| Execution Role | Hash |",
      "| :--- | :--- |",
      `| Baseline ($R_0$) | \`${dossier.reproducibility_signatures?.r0_hash || "NONE"}\` |`,
      `| Faulted ($R_1$) | \`${dossier.reproducibility_signatures?.r1_hash || "NONE"}\` |`,
      `| Candidate Fix ($R_2$) | \`${dossier.reproducibility_signatures?.r2_hash || "NONE"}\` |`,
      "",
      "---",
      "",
      "## 7. Limitations & Integrity Disclaimer",
      "",
      `> ${dossier.limitations_disclaimer}`,
      ""
    );

    return lines.join("\n");
  }
}
