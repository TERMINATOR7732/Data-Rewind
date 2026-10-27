"""Tests for Forensic Investigation Dossier Exporters (JSON, Markdown, CSV).

Conforms strictly to Section 2 of SPEC-MOD-05.
Includes exact verification of the Type-Aware Formula-Injection Protection matrix.
"""

from __future__ import annotations

import json
from typing import Any
from uuid import uuid4

import pytest

from data_rewind.comparator.models import (
    DatasetFingerprint,
    DiffCategory,
    RowDiff,
    SchemaDiff,
    TabularDiffResult,
    ValueDiff,
)
from data_rewind.core.domain.models import DataType, utc_now
from data_rewind.verification.models import (
    BaselineEquivalenceAxisResult,
    DualAxisEvaluation,
    EvidenceItem,
    EvidenceTier,
    ForensicDossier,
    ForensicDossierMetadata,
    MissingEvidenceDeclaration,
    RemediationAxisResult,
    TriRunVerification,
    VerificationVerdict,
)
from data_rewind.verification.reports import (
    CSVDossierExporter,
    CSVFormulaEscaper,
    JSONDossierExporter,
    MarkdownDossierExporter,
)


@pytest.fixture
def sample_dossier() -> ForensicDossier:
    """Construct a deterministic ForensicDossier fixture for export testing."""
    v_id = uuid4()
    r0_id = uuid4()
    r1_id = uuid4()
    r2_id = uuid4()

    verification = TriRunVerification(
        verification_id=v_id,
        title="Test Fix Verification: Revenue Pipeline",
        baseline_run_id=r0_id,
        faulted_run_id=r1_id,
        candidate_run_id=r2_id,
        verdict=VerificationVerdict.VERIFIED_CLEAN,
        verdict_meaning="VERIFIED CLEAN: Baseline equivalence restored 100%. Zero secondary regressions detected.",
        verdict_reason_codes=["BASELINE_EQUIVALENCE_RESTORED_100%", "ZERO_SECONDARY_REGRESSIONS"],
        dual_axis=DualAxisEvaluation(
            remediation_axis=RemediationAxisResult(
                eod_step="clean_orders",
                eod_remediated=True,
                eod_severity_reduced=True,
                explanation="EOD defect in clean_orders was remediated.",
            ),
            baseline_axis=BaselineEquivalenceAxisResult(
                baseline_equivalent_at_sinks=True,
                baseline_equivalent_across_all_steps=True,
                sink_step_ids=["sink_mart"],
                explanation="All sinks match baseline 100%.",
            ),
        ),
        evidence_chain=[
            EvidenceItem(
                tier=EvidenceTier.PROVEN_OBSERVATION,
                code="EV-SINK-MATCH",
                summary="Sink output multiset hash matches baseline R0 exactly.",
                step_id="sink_mart",
                is_observed_fact=True,
            ),
            EvidenceItem(
                tier=EvidenceTier.CAUSAL_HYPOTHESIS_DIRECT_CODE_DIFF,
                code="EV-CODE-PATCH",
                summary="Null filter condition restored to predicate.",
                step_id="clean_orders",
                is_observed_fact=False,
            ),
        ],
        missing_evidence=[
            MissingEvidenceDeclaration(
                category="AUDIT_LOG",
                description="Optional developer session log was omitted.",
                remediation_advice="Retain developer shell logs if interactive investigation trace is needed.",
            )
        ],
        created_at=utc_now(),
        duration_ms=45.2,
    )

    metadata = ForensicDossierMetadata(
        dossier_id=uuid4(),
        pipeline_name="Revenue Pipeline",
        pipeline_version_hash="a" * 64,
        investigator_session="session_qa_01",
        baseline_run_id=r0_id,
        faulted_run_id=r1_id,
        candidate_run_id=r2_id,
    )

    return ForensicDossier(
        metadata=metadata,
        verification=verification,
        reproducibility_signatures={
            "input_orders_csv": "b" * 64,
            "step_clean_orders_artifact": "c" * 64,
        },
    )


# --- 1. Formula Injection Protection Matrix Tests (SPEC-MOD-05 §2.2) ---


@pytest.mark.parametrize(
    ("raw_val", "col_type", "expected_safe", "expected_raw", "should_escape"),
    [
        # Case 1: Valid negative float
        ("-42.50", DataType.FLOAT, "-42.50", "-42.50", False),
        ("-42.50", "FLOAT", "-42.50", "-42.50", False),
        # Case 2: Valid positive integer
        ("+100", DataType.INTEGER, "+100", "+100", False),
        ("+100", "INTEGER", "+100", "+100", False),
        # Case 3: Excel formula
        ("=SUM(A1:B10)", DataType.STRING, "'=SUM(A1:B10)", "=SUM(A1:B10)", True),
        # Case 4: Whitespace-prefixed formula
        ("  =1+1", "STRING", "'  =1+1", "  =1+1", True),
        # Case 5: DDE cmd execution payload with minus
        ("-cmd|' /C calc'!A0", DataType.STRING, "'-cmd|' /C calc'!A0", "-cmd|' /C calc'!A0", True),
        # Case 6: Command payload with plus
        ("+cmd|' /C calc'!A0", "STRING", "'+cmd|' /C calc'!A0", "+cmd|' /C calc'!A0", True),
        # Case 7: At-symbol function prefix
        ("@SUM(A1)", DataType.STRING, "'@SUM(A1)", "@SUM(A1)", True),
        # Case 8: Tab-prefixed formula
        ("\t=1+1", "STRING", "'\t=1+1", "\t=1+1", True),
        # Case 9: Normal safe text
        ("Normal Text", DataType.STRING, "Normal Text", "Normal Text", False),
        # Case 10: Empty string
        ("", DataType.STRING, "", "", False),
        # Case 11: SQL NULL (None)
        (None, DataType.STRING, "", "", False),
        (None, DataType.INTEGER, "", "", False),
        # Pipe character without leading formula prefix remains unescaped
        ("A|B", "STRING", "A|B", "A|B", False),
    ],
)
def test_csv_formula_injection_protection_cases(
    raw_val: Any,
    col_type: Any,
    expected_safe: str,
    expected_raw: str,
    should_escape: bool,
) -> None:
    """Verify exact formula injection defense behavior matching the canonical specification table."""
    # Test safe mode
    safe_out, was_esc = CSVFormulaEscaper.sanitize_cell(
        raw_val, col_type=col_type, export_mode="safe"
    )
    assert safe_out == expected_safe
    assert was_esc is should_escape

    # Test raw mode (never prepends apostrophe)
    raw_out, was_esc_raw = CSVFormulaEscaper.sanitize_cell(
        raw_val, col_type=col_type, export_mode="raw"
    )
    assert raw_out == expected_raw
    assert was_esc_raw is False


def test_csv_step_diff_export() -> None:
    """Test exporting a TabularDiffResult to CSV with formula sanitization."""
    diff = TabularDiffResult(
        is_equal=False,
        case_classifications=[],
        schema_diff=SchemaDiff(
            added_columns=[], removed_columns=[], common_columns=["id", "name", "formula_col"]
        ),
        baseline_fingerprint=DatasetFingerprint(
            schema_hash="0" * 64, multiset_hash="0" * 64, row_count=1, fingerprint_hash="0" * 64
        ),
        target_fingerprint=DatasetFingerprint(
            schema_hash="0" * 64, multiset_hash="0" * 64, row_count=1, fingerprint_hash="0" * 64
        ),
        identical_count=0,
        modified_count=1,
        added_count=0,
        removed_count=0,
        baseline_row_count=1,
        target_row_count=1,
        sample_row_diffs=[
            RowDiff(
                category=DiffCategory.MODIFIED,
                key_values={"id": 1},
                baseline_row={"id": 1, "name": "Alice", "formula_col": "safe"},
                target_row={"id": 1, "name": "Alice", "formula_col": "=SUM(B1:B2)"},
                field_diffs=[
                    ValueDiff(
                        column="formula_col", baseline_value="safe", target_value="=SUM(B1:B2)"
                    )
                ],
            )
        ],
    )

    # Safe export
    csv_safe, escaped_count = CSVDossierExporter.export_step_diff(
        diff,
        column_types={
            "id": DataType.INTEGER,
            "name": DataType.STRING,
            "formula_col": DataType.STRING,
        },
        export_mode="safe",
    )
    assert escaped_count == 1
    assert "'=SUM(B1:B2)" in csv_safe

    # Raw export
    csv_raw, escaped_raw_count = CSVDossierExporter.export_step_diff(
        diff,
        column_types={
            "id": DataType.INTEGER,
            "name": DataType.STRING,
            "formula_col": DataType.STRING,
        },
        export_mode="raw",
    )
    assert escaped_raw_count == 0
    assert "=SUM(B1:B2)" in csv_raw
    assert "'=SUM" not in csv_raw


# --- 2. JSON Dossier Exporter Tests ---


def test_json_dossier_exporter_roundtrip(sample_dossier: ForensicDossier) -> None:
    """Verify that JSON export produces valid, parseable JSON conforming to ForensicDossier schema."""
    json_str = JSONDossierExporter.export(sample_dossier, indent=2)

    # Must be parseable JSON
    data = json.loads(json_str)
    assert "metadata" in data
    assert "verification" in data
    assert "reproducibility_signatures" in data
    assert data["verification"]["verdict"] == "VERIFIED_CLEAN"
    assert data["metadata"]["pipeline_name"] == "Revenue Pipeline"

    # Must round-trip validate back to model
    restored = ForensicDossier.model_validate(data)
    assert restored.metadata.dossier_id == sample_dossier.metadata.dossier_id
    assert restored.verification.verdict == VerificationVerdict.VERIFIED_CLEAN
    assert len(restored.verification.evidence_chain) == 2


# --- 3. Markdown Dossier Exporter Tests ---


def test_markdown_dossier_exporter_structure(sample_dossier: ForensicDossier) -> None:
    """Verify that Markdown export produces comprehensive, readable dossier matching specifications."""
    md = MarkdownDossierExporter.export(sample_dossier)

    # Required sections
    assert "# Forensic Investigation Dossier: Test Fix Verification: Revenue Pipeline" in md
    assert "## 1. Executive Summary & Verdict" in md
    assert "[PASS] **VERIFIED CLEAN**" in md
    assert "## 2. Tri-Run Association Overview" in md
    assert "## 3. Dual-Axis Fix Verification Evaluation" in md
    assert "### Axis 1: Remediation Evaluation" in md
    assert "### Axis 2: Baseline Equivalence" in md
    assert "## 4. Itemized Evidence Chain" in md
    assert "### 4.1 Proven Observations (Direct Mathematical Facts)" in md
    assert "### 4.2 Causal Hypotheses & Derived Inferences" in md
    assert "## 5. Downstream Lineage & Blast Radius" in md
    assert "## 6. Missing or Limited Evidence Declarations" in md
    assert "## 7. Cryptographic Reproducibility Signatures" in md
    assert "## 8. Limitations & Engineering Disclaimer" in md

    # Separation of facts vs hypotheses
    assert "EV-SINK-MATCH" in md
    assert "EV-CODE-PATCH" in md
    assert "input_orders_csv" in md
