"""Data Rewind Forensic Investigation Dossier Exporters (JSON, Markdown, CSV).

Conforms strictly to SPEC-MOD-05 §2 (Forensic Investigation Dossier & Type-Aware Export Specification).
Provides:
- JSON Dossier Export (Machine-readable structured evidence)
- Markdown Dossier Export (Professional engineering dossier)
- CSV Export with Type-Aware Formula-Injection Protection (Safe vs. Raw modes)
"""

from __future__ import annotations

import csv
import io
from typing import Any

from data_rewind.comparator.models import TabularDiffResult
from data_rewind.core.domain.models import DataType
from data_rewind.verification.models import (
    ForensicDossier,
    TriRunVerification,
    VerificationVerdict,
)

DANGEROUS_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


class CSVFormulaEscaper:
    """Type-Aware Formula-Injection sanitizer conforming to SPEC-MOD-05 §2.2."""

    @classmethod
    def sanitize_cell(
        cls,
        value: Any,
        col_type: str | DataType | None = None,
        export_mode: str = "safe",
    ) -> tuple[str, bool]:
        """Sanitize an individual tabular cell according to the type-aware policy.

        Returns:
            Tuple of (sanitized_string_value, was_escaped_boolean).
        """
        # SQL NULL / None is always exported as an empty unquoted field
        if value is None:
            return "", False

        val_str = str(value)

        # Raw Data Export Mode: bit-for-bit logical value preservation
        if export_mode == "raw":
            return val_str, False

        # Mode 2: Spreadsheet-Safe Export Mode
        # Rule 1: Numeric Preservation Rule - INTEGER and FLOAT columns are NEVER prefixed
        if col_type is not None:
            type_str = col_type.value if hasattr(col_type, "value") else str(col_type).upper()
            if type_str in (
                "INTEGER",
                "FLOAT",
                "INT",
                "DOUBLE",
                "BIGINT",
                "SMALLINT",
                "TINYINT",
                "NUMERIC",
                "DECIMAL",
            ):
                return val_str, False

        # Rule 2: Untrusted String / Text Sanitization Rule
        # Inspect leading non-whitespace character
        stripped = val_str.lstrip(" \t\r\n")
        if not stripped:
            return val_str, False

        first_char = stripped[0]
        if first_char in DANGEROUS_FORMULA_PREFIXES:
            # Rule 2b: Attempt strict numeric parse
            try:
                # If the string cleanly parses as integer or float, it is a legitimate numeric literal
                float(stripped)
                return val_str, False
            except ValueError:
                # Not a valid number: prepend apostrophe to neutralize spreadsheet formula execution
                return f"'{val_str}", True

        # Normal text and standalone pipe (|) preserved unescaped
        return val_str, False


class JSONDossierExporter:
    """Exports forensic investigation dossiers to standardized JSON."""

    @classmethod
    def export(cls, dossier: ForensicDossier, indent: int = 2) -> str:
        """Serialize dossier to structured, indented JSON."""
        return dossier.model_dump_json(indent=indent)


class MarkdownDossierExporter:
    """Exports forensic investigation dossiers to professional Markdown dossiers."""

    @classmethod
    def export(cls, dossier: ForensicDossier) -> str:
        """Render complete forensic investigation dossier in Markdown."""
        v = dossier.verification
        meta = dossier.metadata
        dual = v.dual_axis

        verdict_badge = {
            VerificationVerdict.VERIFIED_CLEAN: "[PASS] **VERIFIED CLEAN**",
            VerificationVerdict.INTENTIONAL_UPDATE: "[INTENTIONAL] **INTENTIONAL UPDATE VERIFIED**",
            VerificationVerdict.PARTIAL_RESTORATION: "[PARTIAL] **PARTIAL RESTORATION**",
            VerificationVerdict.REGRESSION_UNRESOLVED: "[FAIL] **REGRESSION UNRESOLVED (FIX FAILED)**",
            VerificationVerdict.NEW_FAULT_INTRODUCED: "[CRITICAL] **CRITICAL WARNING: NEW FAULT INTRODUCED**",
            VerificationVerdict.BASELINE_UNAVAILABLE: "[REMEDIATION ONLY] **BASELINE UNAVAILABLE**",
            VerificationVerdict.FAULT_UNREPRODUCIBLE: "[BLOCKED] **FAULT UNREPRODUCIBLE (VERIFICATION BLOCKED)**",
            VerificationVerdict.INCONCLUSIVE_VERIFICATION: "[INCONCLUSIVE] **INCONCLUSIVE VERIFICATION**",
        }.get(v.verdict, f"**{v.verdict.value}**")

        lines: list[str] = [
            f"# Forensic Investigation Dossier: {v.title}",
            "",
            "**Document Version:** 1.0 (Forensic Investigation Dossier)  ",
            f"**Dossier ID:** `{meta.dossier_id}`  ",
            f"**Pipeline Name:** `{meta.pipeline_name}`  ",
            f"**Pipeline Version Hash:** `{meta.pipeline_version_hash}`  ",
            f"**Investigator Session:** `{meta.investigator_session}`  ",
            f"**Execution Timestamp (UTC):** `{v.created_at.isoformat()}`  ",
            f"**Verification Duration:** `{v.duration_ms:.2f} ms`  ",
            "",
            "---",
            "",
            "## 1. Executive Summary & Verdict",
            "",
            f"### Verdict: {verdict_badge}",
            f"> **Meaning:** {v.verdict_meaning}",
            "",
            f"- **Verdict Reason Codes:** {', '.join(f'`{code}`' for code in v.verdict_reason_codes)}",
            "",
            "---",
            "",
            "## 2. Tri-Run Association Overview",
            "",
            "| Protocol Role | Run Identifier | Purpose & Expected Behavior |",
            "| :--- | :--- | :--- |",
            f"| **$R_0$ (Baseline Run)** | `{v.baseline_run_id or 'NOT PROVIDED'}` | Trusted historical golden truth reference. |",
            f"| **$R_1$ (Faulted Run)** | `{v.faulted_run_id}` | Reproduces regression at Earliest Observable Divergence (EOD) node. |",
            f"| **$R_2$ (Candidate Fix Run)** | `{v.candidate_run_id}` | Proposed remediation incorporating fix or patched inputs. |",
            "",
            "---",
            "",
            "## 3. Dual-Axis Fix Verification Evaluation",
            "",
            "### Axis 1: Remediation Evaluation ($R_2 \\text{ vs } R_1$)",
            f"- **Target EOD Step:** `{dual.remediation_axis.eod_step or 'N/A'}`",
            f"- **EOD Fault Remediated:** `{'YES' if dual.remediation_axis.eod_remediated else 'NO'}`",
            f"- **Fault Severity Reduced:** `{'YES' if dual.remediation_axis.eod_severity_reduced else 'NO'}`",
            f"- **Remediation Details:** {dual.remediation_axis.explanation}",
        ]

        if dual.remediation_axis.unresolved_eod_differences:
            lines.append("- **Unresolved Fault Points:**")
            for diff_item in dual.remediation_axis.unresolved_eod_differences:
                lines.append(f"  - {diff_item}")

        lines.extend(
            [
                "",
                "### Axis 2: Baseline Equivalence ($R_2 \\text{ vs } R_0$)",
            ]
        )

        if dual.baseline_axis is not None:
            lines.extend(
                [
                    f"- **Downstream Sinks Equivalent:** `{'YES' if dual.baseline_axis.baseline_equivalent_at_sinks else 'NO'}`",
                    f"- **All Steps Equivalent:** `{'YES' if dual.baseline_axis.baseline_equivalent_across_all_steps else 'NO'}`",
                    f"- **Sink Step IDs:** {', '.join(f'`{s}`' for s in dual.baseline_axis.sink_step_ids)}",
                    f"- **Baseline Evaluation Details:** {dual.baseline_axis.explanation}",
                ]
            )
            if dual.baseline_axis.collateral_regressions:
                lines.append("- **Collateral Secondary Regressions Detected:**")
                for collat in dual.baseline_axis.collateral_regressions:
                    lines.append(f"  - [WARNING] Step `{collat}`")
        else:
            lines.append(
                "- *Baseline run R0 was omitted; baseline equivalence could not be evaluated.*"
            )

        lines.extend(
            [
                "",
                "---",
                "",
                "## 4. Itemized Evidence Chain",
                "",
                "Forensic evidence is strictly partitioned between directly proven observations and derived causal hypotheses:",
                "",
                "### 4.1 Proven Observations (Direct Mathematical Facts)",
                "",
            ]
        )

        proven_facts = [item for item in v.evidence_chain if item.is_observed_fact]
        if proven_facts:
            lines.append("| Code | Tier | Step | Summary |")
            lines.append("| :--- | :--- | :--- | :--- |")
            for fact in proven_facts:
                step_str = f"`{fact.step_id}`" if fact.step_id else "Global"
                lines.append(
                    f"| `{fact.code}` | `{fact.tier.value}` | {step_str} | {fact.summary} |"
                )
        else:
            lines.append("*No proven observation items recorded.*")

        lines.extend(
            [
                "",
                "### 4.2 Causal Hypotheses & Derived Inferences",
                "",
            ]
        )

        hypotheses = [item for item in v.evidence_chain if not item.is_observed_fact]
        if hypotheses:
            lines.append("| Code | Tier | Step | Inferred Causal Explanation |")
            lines.append("| :--- | :--- | :--- | :--- |")
            for hyp in hypotheses:
                step_str = f"`{hyp.step_id}`" if hyp.step_id else "Global"
                lines.append(f"| `{hyp.code}` | `{hyp.tier.value}` | {step_str} | {hyp.summary} |")
        else:
            lines.append(
                "*No secondary causal hypotheses required; observations are mathematically deterministic.*"
            )

        # Downstream Blast Radius
        lines.extend(
            [
                "",
                "---",
                "",
                "## 5. Downstream Lineage & Blast Radius",
                "",
            ]
        )
        if v.blast_radius:
            br = v.blast_radius
            lines.extend(
                [
                    f"- **Origin Divergent Step(s):** {', '.join(f'`{s}`' for s in br.origin_divergent_step_ids)}",
                    f"- **Tainted Node Count:** {br.tainted_nodes_count} of {br.total_nodes_count} ({br.blast_radius_ratio:.1%})",
                    f"- **Confirmed Affected Steps:** {', '.join(f'`{s}`' for s in br.confirmed_affected_step_ids) or 'None'}",
                    f"- **Masked Unaffected Steps:** {br.masked_count}",
                    f"- **Affected Terminal Sinks:** {', '.join(f'`{m}`' for m in br.affected_terminal_sinks) or 'None'}",
                ]
            )
        else:
            lines.append("*Blast radius analysis was not computed or zero steps were tainted.*")

        # Missing Evidence
        lines.extend(
            [
                "",
                "---",
                "",
                "## 6. Missing or Limited Evidence Declarations",
                "",
            ]
        )
        if v.missing_evidence:
            lines.append("| Category | Description | Remediation Advice |")
            lines.append("| :--- | :--- | :--- |")
            for me in v.missing_evidence:
                lines.append(f"| `{me.category}` | {me.description} | {me.remediation_advice} |")
        else:
            lines.append(
                "[COMPLETE] *Zero missing evidence declarations. All required artifacts, checkpoints, and manifests were verified.*"
            )

        # Reproducibility Signatures
        lines.extend(
            [
                "",
                "---",
                "",
                "## 7. Cryptographic Reproducibility Signatures",
                "",
            ]
        )
        if dossier.reproducibility_signatures:
            lines.append("| Artifact / Resource | SHA-256 Digest |")
            lines.append("| :--- | :--- |")
            for name, sig in dossier.reproducibility_signatures.items():
                lines.append(f"| `{name}` | `{sig}` |")
        else:
            lines.append("*No cryptographic artifact signatures registered.*")

        # Limitations Disclaimer
        lines.extend(
            [
                "",
                "---",
                "",
                "## 8. Limitations & Engineering Disclaimer",
                "",
                f"> {dossier.limitations_disclaimer}",
                "",
                "*(Dossier generated automatically by Data Rewind Forensic Comparator & Verification Engine)*",
            ]
        )

        return "\n".join(lines)


class CSVDossierExporter:
    """Exports tabular step diffs and verification matrices with Type-Aware Formula-Injection Protection."""

    @classmethod
    def export_step_diff(
        cls,
        diff: TabularDiffResult,
        column_types: dict[str, str | DataType] | None = None,
        export_mode: str = "safe",
    ) -> tuple[str, int]:
        """Export sample row diffs to RFC-4180 CSV with formula sanitization.

        Returns:
            Tuple of (csv_string, total_escaped_cells_count).
        """
        col_types = column_types or {}
        output = io.StringIO()
        writer = csv.writer(output, lineterminator="\n", quoting=csv.QUOTE_MINIMAL)

        common_cols = diff.schema_diff.common_columns
        header = ["_diff_category", "_row_key"] + common_cols
        writer.writerow(header)

        escaped_count = 0

        for r_diff in diff.sample_row_diffs:
            category = r_diff.category.value
            key_repr = str(r_diff.key_values) if r_diff.key_values else ""

            row_data = r_diff.target_row or r_diff.baseline_row or {}
            row_cells: list[str] = [category, key_repr]

            for col in common_cols:
                val = row_data.get(col)
                c_type = col_types.get(col)
                sanitized, was_escaped = CSVFormulaEscaper.sanitize_cell(
                    value=val,
                    col_type=c_type,
                    export_mode=export_mode,
                )
                if was_escaped:
                    escaped_count += 1
                row_cells.append(sanitized)

            writer.writerow(row_cells)

        return output.getvalue(), escaped_count

    @classmethod
    def export_verification_summary(
        cls,
        verification: TriRunVerification,
        export_mode: str = "safe",
    ) -> tuple[str, int]:
        """Export step-by-step verification matrix to RFC-4180 CSV with formula sanitization.

        Returns:
            Tuple of (csv_string, total_escaped_cells_count).
        """
        output = io.StringIO()
        writer = csv.writer(output, lineterminator="\n", quoting=csv.QUOTE_MINIMAL)

        header = [
            "step_id",
            "r2_vs_r0_identical",
            "r2_vs_r0_modified",
            "r2_vs_r0_added",
            "r2_vs_r0_removed",
            "r2_vs_r0_is_equal",
            "remediation_status",
            "verdict_impact",
        ]
        writer.writerow(header)

        escaped_count = 0
        comp_r2_r0 = (
            verification.dual_axis.baseline_axis.step_comparisons
            if verification.dual_axis.baseline_axis
            else {}
        )

        all_steps = list(comp_r2_r0.keys())
        eod_step = verification.dual_axis.remediation_axis.eod_step

        for sid in all_steps:
            d = comp_r2_r0[sid]
            remediation_status = (
                "REMEDIATED"
                if sid == eod_step and verification.dual_axis.remediation_axis.eod_remediated
                else ("FAULT_STEP" if sid == eod_step else "PASS")
            )
            verdict_impact = (
                "COLLATERAL_FAULT"
                if sid
                in (
                    verification.dual_axis.baseline_axis.collateral_regressions
                    if verification.dual_axis.baseline_axis
                    else []
                )
                else ("CLEAN" if d.is_equal else "DIVERGENT")
            )

            raw_cells = [
                sid,
                str(d.identical_count),
                str(d.modified_count),
                str(d.added_count),
                str(d.removed_count),
                str(d.is_equal),
                remediation_status,
                verdict_impact,
            ]

            sanitized_cells: list[str] = []
            for cell in raw_cells:
                # Text column check for formula sanitization
                s_cell, was_esc = CSVFormulaEscaper.sanitize_cell(
                    cell, col_type="STRING", export_mode=export_mode
                )
                if was_esc:
                    escaped_count += 1
                sanitized_cells.append(s_cell)

            writer.writerow(sanitized_cells)

        return output.getvalue(), escaped_count
