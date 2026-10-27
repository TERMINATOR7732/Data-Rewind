"""Comprehensive Tests for Tri-Run Fix Verification & Evaluator.

Conforms strictly to Section 1 of SPEC-MOD-05.
Covers:
- All 8 canonical verification verdicts:
  1. VERIFIED_CLEAN
  2. INTENTIONAL_UPDATE
  3. PARTIAL_RESTORATION
  4. REGRESSION_UNRESOLVED
  5. NEW_FAULT_INTRODUCED
  6. BASELINE_UNAVAILABLE
  7. FAULT_UNREPRODUCIBLE
  8. INCONCLUSIVE_VERIFICATION
- Pre-flight validation and run association checks
- Dual-axis evaluation (Remediation Axis vs. Baseline Equivalence Axis)
- Intentional update contracts (step and column scoping)
- Full orchestration via FixVerificationOrchestrator
"""

from __future__ import annotations

from pathlib import Path
from uuid import uuid4

import pytest

from data_rewind.comparator.models import (
    CaseClassification,
    DatasetFingerprint,
    DiffCategory,
    RowDiff,
    SchemaDiff,
    TabularDiffResult,
    ValueDiff,
)
from data_rewind.core.domain.models import OperationType, TransformationStep
from data_rewind.verification.evaluator import TriRunEvaluator, TriRunValidationError
from data_rewind.verification.models import (
    IntentionalUpdateContract,
    VerificationVerdict,
)
from data_rewind.verification.orchestrator import FixVerificationOrchestrator
from data_rewind.verification.persistence import VerificationRepository


def make_diff_result(
    is_equal: bool,
    identical: int = 10,
    modified: int = 0,
    added: int = 0,
    removed: int = 0,
    cases: list[CaseClassification] | None = None,
    sample_diffs: list[RowDiff] | None = None,
) -> TabularDiffResult:
    """Helper to construct TabularDiffResult fixtures."""
    cnt_a = identical + modified + removed
    cnt_b = identical + modified + added
    return TabularDiffResult(
        is_equal=is_equal,
        case_classifications=cases or [],
        schema_diff=SchemaDiff(added_columns=[], removed_columns=[], common_columns=["id", "val"]),
        baseline_fingerprint=DatasetFingerprint(
            schema_hash="0" * 64,
            multiset_hash="1" * 64,
            row_count=cnt_a,
            fingerprint_hash="2" * 64,
        ),
        target_fingerprint=DatasetFingerprint(
            schema_hash="0" * 64,
            multiset_hash="1" * 64 if is_equal else "3" * 64,
            row_count=cnt_b,
            fingerprint_hash="4" * 64,
        ),
        identical_count=identical,
        modified_count=modified,
        added_count=added,
        removed_count=removed,
        baseline_row_count=cnt_a,
        target_row_count=cnt_b,
        sample_row_diffs=sample_diffs or [],
    )


# --- 1. Pre-flight Validation Tests ---


def test_validation_rejects_identical_candidate_and_faulted_run() -> None:
    """Verify that R2 cannot be identical to R1."""
    same_id = uuid4()
    with pytest.raises(TriRunValidationError) as exc:
        TriRunEvaluator.evaluate(
            title="Invalid Tri-Run",
            faulted_run_id=same_id,
            candidate_run_id=same_id,
            topological_order=["step1"],
            sink_step_ids=["step1"],
            step_comparisons_r2_r1={"step1": make_diff_result(True)},
        )
    assert "cannot be identical to Faulted run R1" in str(exc.value)


def test_validation_rejects_identical_candidate_and_baseline_run() -> None:
    """Verify that R2 cannot be identical to R0."""
    same_id = uuid4()
    with pytest.raises(TriRunValidationError) as exc:
        TriRunEvaluator.evaluate(
            title="Invalid Tri-Run",
            baseline_run_id=same_id,
            faulted_run_id=uuid4(),
            candidate_run_id=same_id,
            topological_order=["step1"],
            sink_step_ids=["step1"],
            step_comparisons_r2_r1={"step1": make_diff_result(True)},
        )
    assert "cannot be identical to Baseline run R0" in str(exc.value)


# --- 2. Canonical Verdict Taxonomy Tests (SPEC-MOD-05 §1.3) ---


def test_verdict_verified_clean() -> None:
    """Verdict 1: VERIFIED_CLEAN (R2 remediates R1 fault AND R2 == R0 across all sinks)."""
    r0 = uuid4()
    r1 = uuid4()
    r2 = uuid4()

    # R1 vs R0 diverged at step1 and step2
    comp_r1_r0 = {
        "step1": make_diff_result(is_equal=False, modified=2),
        "step2": make_diff_result(is_equal=False, modified=2),
    }
    # R2 vs R1 diverged at step1 (remediated)
    comp_r2_r1 = {
        "step1": make_diff_result(is_equal=False, modified=2),
        "step2": make_diff_result(is_equal=False, modified=2),
    }
    # R2 vs R0 is 100% equal across all steps
    comp_r2_r0 = {
        "step1": make_diff_result(is_equal=True, identical=10),
        "step2": make_diff_result(is_equal=True, identical=10),
    }

    res = TriRunEvaluator.evaluate(
        title="Test Clean Fix",
        baseline_run_id=r0,
        faulted_run_id=r1,
        candidate_run_id=r2,
        topological_order=["step1", "step2"],
        sink_step_ids=["step2"],
        eod_step_id="step1",
        step_comparisons_r1_r0=comp_r1_r0,
        step_comparisons_r2_r1=comp_r2_r1,
        step_comparisons_r2_r0=comp_r2_r0,
    )

    assert res.verdict == VerificationVerdict.VERIFIED_CLEAN
    assert "Baseline equivalence restored 100%" in res.verdict_meaning
    assert res.dual_axis.remediation_axis.eod_remediated is True
    assert res.dual_axis.baseline_axis.baseline_equivalent_at_sinks is True
    assert res.dual_axis.baseline_axis.baseline_equivalent_across_all_steps is True
    assert len(res.dual_axis.baseline_axis.collateral_regressions) == 0


def test_verdict_regression_unresolved_identical_to_fault() -> None:
    """Verdict 4: REGRESSION_UNRESOLVED (R2 produces identical outputs to R1 at EOD)."""
    r0 = uuid4()
    r1 = uuid4()
    r2 = uuid4()

    comp_r1_r0 = {"step1": make_diff_result(is_equal=False, modified=3)}
    # R2 is identical to R1 at EOD step!
    comp_r2_r1 = {"step1": make_diff_result(is_equal=True, identical=10)}
    comp_r2_r0 = {"step1": make_diff_result(is_equal=False, modified=3)}

    res = TriRunEvaluator.evaluate(
        title="Test Unresolved Fix",
        baseline_run_id=r0,
        faulted_run_id=r1,
        candidate_run_id=r2,
        topological_order=["step1"],
        sink_step_ids=["step1"],
        eod_step_id="step1",
        step_comparisons_r1_r0=comp_r1_r0,
        step_comparisons_r2_r1=comp_r2_r1,
        step_comparisons_r2_r0=comp_r2_r0,
    )

    assert res.verdict == VerificationVerdict.REGRESSION_UNRESOLVED
    assert res.dual_axis.remediation_axis.eod_remediated is False
    assert "EOD_DEFECT_PERSISTS" in res.verdict_reason_codes


def test_verdict_new_fault_introduced() -> None:
    """Verdict 5: NEW_FAULT_INTRODUCED (EOD resolved, but secondary regression at another step)."""
    r0 = uuid4()
    r1 = uuid4()
    r2 = uuid4()

    # In R1 vs R0: step1 diverged (EOD), step2 was clean!
    comp_r1_r0 = {
        "step1": make_diff_result(is_equal=False, modified=2),
        "step2": make_diff_result(is_equal=True, identical=10),
    }
    # In R2 vs R1: step1 changed
    comp_r2_r1 = {
        "step1": make_diff_result(is_equal=False, modified=2),
        "step2": make_diff_result(is_equal=False, modified=5),
    }
    # In R2 vs R0: step1 matches baseline R0! But step2 (which was clean in R1) now diverged!
    comp_r2_r0 = {
        "step1": make_diff_result(is_equal=True, identical=10),
        "step2": make_diff_result(is_equal=False, modified=5),
    }

    res = TriRunEvaluator.evaluate(
        title="Test Collateral Fault",
        baseline_run_id=r0,
        faulted_run_id=r1,
        candidate_run_id=r2,
        topological_order=["step1", "step2"],
        sink_step_ids=["step2"],
        eod_step_id="step1",
        step_comparisons_r1_r0=comp_r1_r0,
        step_comparisons_r2_r1=comp_r2_r1,
        step_comparisons_r2_r0=comp_r2_r0,
    )

    assert res.verdict == VerificationVerdict.NEW_FAULT_INTRODUCED
    assert "step2" in res.dual_axis.baseline_axis.collateral_regressions
    assert "SECONDARY_REGRESSION_DETECTED" in res.verdict_reason_codes


def test_verdict_partial_restoration() -> None:
    """Verdict 3: PARTIAL_RESTORATION (EOD severity reduced, but residual baseline drift remains)."""
    r0 = uuid4()
    r1 = uuid4()
    r2 = uuid4()

    # R1 had 10 corrupted rows compared to R0
    comp_r1_r0 = {"step1": make_diff_result(is_equal=False, modified=10)}
    # R2 changed relative to R1
    comp_r2_r1 = {"step1": make_diff_result(is_equal=False, modified=8)}
    # R2 still differs from R0, but only 2 corrupted rows remain (severity reduced from 10 to 2)
    comp_r2_r0 = {"step1": make_diff_result(is_equal=False, modified=2)}

    res = TriRunEvaluator.evaluate(
        title="Test Partial Fix",
        baseline_run_id=r0,
        faulted_run_id=r1,
        candidate_run_id=r2,
        topological_order=["step1"],
        sink_step_ids=["step1"],
        eod_step_id="step1",
        step_comparisons_r1_r0=comp_r1_r0,
        step_comparisons_r2_r1=comp_r2_r1,
        step_comparisons_r2_r0=comp_r2_r0,
    )

    assert res.verdict == VerificationVerdict.PARTIAL_RESTORATION
    assert res.dual_axis.remediation_axis.eod_severity_reduced is True
    assert "PRIMARY_DEFECT_MITIGATED" in res.verdict_reason_codes


def test_verdict_intentional_update_satisfies_contract() -> None:
    """Verdict 2: INTENTIONAL_UPDATE (R2 differs from R0 strictly within declared contract)."""
    r0 = uuid4()
    r1 = uuid4()
    r2 = uuid4()

    # Contract explicitly authorizes column 'tax_rate' in step 'compute_tax' to drift
    contract = IntentionalUpdateContract(
        allowed_steps=["compute_tax"],
        allowed_columns_by_step={"compute_tax": ["tax_rate"]},
        allow_row_count_change=False,
        justification="Statutory tax rate increase from 18% to 20% effective Nov 1.",
    )

    comp_r1_r0 = {"compute_tax": make_diff_result(is_equal=False, modified=5)}
    comp_r2_r1 = {"compute_tax": make_diff_result(is_equal=False, modified=5)}
    # R2 differs from R0 strictly on column 'tax_rate'
    sample_diffs = [
        RowDiff(
            category=DiffCategory.MODIFIED,
            key_values={"id": 1},
            baseline_row={"id": 1, "tax_rate": 0.18},
            target_row={"id": 1, "tax_rate": 0.20},
            field_diffs=[ValueDiff(column="tax_rate", baseline_value=0.18, target_value=0.20)],
        )
    ]
    comp_r2_r0 = {
        "compute_tax": make_diff_result(is_equal=False, modified=1, sample_diffs=sample_diffs)
    }

    res = TriRunEvaluator.evaluate(
        title="Test Intentional Tax Update",
        baseline_run_id=r0,
        faulted_run_id=r1,
        candidate_run_id=r2,
        topological_order=["compute_tax"],
        sink_step_ids=["compute_tax"],
        eod_step_id="compute_tax",
        step_comparisons_r1_r0=comp_r1_r0,
        step_comparisons_r2_r1=comp_r2_r1,
        step_comparisons_r2_r0=comp_r2_r0,
        intentional_contract=contract,
    )

    assert res.verdict == VerificationVerdict.INTENTIONAL_UPDATE
    assert "INTENTIONAL_DRIFT_CONFIRMED" in res.verdict_reason_codes
    assert res.intentional_contract is not None
    assert "Statutory tax rate increase" in res.intentional_contract.justification


def test_verdict_baseline_unavailable() -> None:
    """Verdict 6: BASELINE_UNAVAILABLE (R0 is None, but R2 remediates R1)."""
    r1 = uuid4()
    r2 = uuid4()

    # R2 changed relative to R1 at EOD step
    comp_r2_r1 = {"step1": make_diff_result(is_equal=False, modified=4)}

    res = TriRunEvaluator.evaluate(
        title="Missing Baseline Verification",
        baseline_run_id=None,
        faulted_run_id=r1,
        candidate_run_id=r2,
        topological_order=["step1"],
        sink_step_ids=["step1"],
        eod_step_id="step1",
        step_comparisons_r2_r1=comp_r2_r1,
    )

    assert res.verdict == VerificationVerdict.BASELINE_UNAVAILABLE
    assert res.baseline_run_id is None
    assert any(me.category == "BASELINE_RUN" for me in res.missing_evidence)


def test_verdict_fault_unreproducible() -> None:
    """Verdict 7: FAULT_UNREPRODUCIBLE (Defect was never reproduced in R1; R1 == R0)."""
    r0 = uuid4()
    r1 = uuid4()
    r2 = uuid4()

    # In R1 vs R0: no divergence!
    comp_r1_r0 = {"step1": make_diff_result(is_equal=True, identical=10)}
    comp_r2_r1 = {"step1": make_diff_result(is_equal=True, identical=10)}
    comp_r2_r0 = {"step1": make_diff_result(is_equal=True, identical=10)}

    res = TriRunEvaluator.evaluate(
        title="Fault Unreproducible Verification",
        baseline_run_id=r0,
        faulted_run_id=r1,
        candidate_run_id=r2,
        topological_order=["step1"],
        sink_step_ids=["step1"],
        eod_step_id="step1",
        step_comparisons_r1_r0=comp_r1_r0,
        step_comparisons_r2_r1=comp_r2_r1,
        step_comparisons_r2_r0=comp_r2_r0,
    )

    assert res.verdict == VerificationVerdict.FAULT_UNREPRODUCIBLE
    assert "FAULT_NOT_REPRODUCED" in res.verdict_reason_codes


def test_verdict_inconclusive_keyless_ambiguity() -> None:
    """Verdict 8: INCONCLUSIVE_VERIFICATION (Keyless correspondence is ambiguous)."""
    r0 = uuid4()
    r1 = uuid4()
    r2 = uuid4()

    comp_r1_r0 = {"step1": make_diff_result(is_equal=False, modified=10)}
    comp_r2_r1 = {"step1": make_diff_result(is_equal=False, modified=8)}
    # In R2 vs R0: keyless bag comparison with added/removed rows without primary keys, error reduced from 10 to 2
    comp_r2_r0 = {
        "step1": make_diff_result(
            is_equal=False,
            identical=8,
            added=1,
            removed=1,
            cases=[CaseClassification.CASE_5_KEYLESS_MULTISET],
        )
    }

    res = TriRunEvaluator.evaluate(
        title="Inconclusive Verification",
        baseline_run_id=r0,
        faulted_run_id=r1,
        candidate_run_id=r2,
        topological_order=["step1"],
        sink_step_ids=["step1"],
        eod_step_id="step1",
        step_comparisons_r1_r0=comp_r1_r0,
        step_comparisons_r2_r1=comp_r2_r1,
        step_comparisons_r2_r0=comp_r2_r0,
    )

    assert res.verdict == VerificationVerdict.INCONCLUSIVE_VERIFICATION
    assert "KEYLESS_CORRESPONDENCE_AMBIGUOUS" in res.verdict_reason_codes


# --- 3. End-to-End Orchestrator Integration Tests ---


def test_fix_verification_orchestrator_end_to_end(tmp_path: Path) -> None:
    """Verify complete FixVerificationOrchestrator workflow with persistence."""
    steps = [
        TransformationStep(
            step_id="step_clean",
            operation_type=OperationType.FILTER_ROWS,
            input_step_ids=["raw_in"],
            parameters={"predicate": "amount > 0"},
        ),
        TransformationStep(
            step_id="step_sink",
            operation_type=OperationType.FILTER_ROWS,
            input_step_ids=["step_clean"],
            parameters={"predicate": "status == 'COMPLETED'"},
        ),
    ]

    # Baseline R0
    base_data = {
        "step_clean": [
            {"id": 1, "amount": 100.0, "status": "COMPLETED"},
            {"id": 2, "amount": 200.0, "status": "COMPLETED"},
        ],
        "step_sink": [
            {"id": 1, "amount": 100.0, "status": "COMPLETED"},
            {"id": 2, "amount": 200.0, "status": "COMPLETED"},
        ],
    }

    # Faulted R1 (mutated amount in step_clean)
    fault_data = {
        "step_clean": [
            {"id": 1, "amount": -99.0, "status": "COMPLETED"},
            {"id": 2, "amount": 200.0, "status": "COMPLETED"},
        ],
        "step_sink": [
            {"id": 2, "amount": 200.0, "status": "COMPLETED"},
        ],
    }

    # Candidate R2 (remediated back to baseline)
    cand_data = {
        "step_clean": [
            {"id": 1, "amount": 100.0, "status": "COMPLETED"},
            {"id": 2, "amount": 200.0, "status": "COMPLETED"},
        ],
        "step_sink": [
            {"id": 1, "amount": 100.0, "status": "COMPLETED"},
            {"id": 2, "amount": 200.0, "status": "COMPLETED"},
        ],
    }

    repo = VerificationRepository(tmp_path / "metadata.db")
    r0_id = uuid4()
    r1_id = uuid4()
    r2_id = uuid4()

    dossier = FixVerificationOrchestrator.verify_fix(
        title="E2E Clean Fix Verification",
        baseline_run_id=r0_id,
        faulted_run_id=r1_id,
        candidate_run_id=r2_id,
        steps=steps,
        baseline_step_data=base_data,  # type: ignore[arg-type]
        faulted_step_data=fault_data,  # type: ignore[arg-type]
        candidate_step_data=cand_data,  # type: ignore[arg-type]
        primary_keys_by_step={"step_clean": ["id"], "step_sink": ["id"]},
        eod_step_id="step_clean",
        pipeline_name="Order Processing",
        repository=repo,
    )

    assert dossier.verification.verdict == VerificationVerdict.VERIFIED_CLEAN
    assert dossier.verification.dual_axis.remediation_axis.eod_remediated is True
    assert dossier.verification.dual_axis.baseline_axis.baseline_equivalent_at_sinks is True

    # Check persistence
    persisted = repo.get_dossier_by_verification(dossier.verification.verification_id)
    assert persisted is not None
    assert persisted.verification.verdict == VerificationVerdict.VERIFIED_CLEAN
    assert persisted.metadata.pipeline_name == "Order Processing"


# --- 4. ScenarioRunner verify_scenario_fix Mode Coverage ---


@pytest.mark.parametrize(
    ("scenario_id", "fix_mode", "expected_verdict"),
    [
        ("scn01", "clean", VerificationVerdict.VERIFIED_CLEAN),
        ("scn01", "unresolved", VerificationVerdict.REGRESSION_UNRESOLVED),
        ("scn01", "collateral", VerificationVerdict.INCONCLUSIVE_VERIFICATION),
        ("scn02", "clean", VerificationVerdict.VERIFIED_CLEAN),
        ("scn03", "clean", VerificationVerdict.VERIFIED_CLEAN),
        ("scn04", "clean", VerificationVerdict.VERIFIED_CLEAN),
    ],
)
def test_scenario_runner_verify_modes(
    tmp_path: Path,
    scenario_id: str,
    fix_mode: str,
    expected_verdict: VerificationVerdict,
) -> None:
    """Verify ScenarioRunner.verify_scenario_fix across canonical scenarios and modes."""
    from data_rewind.scenarios.runner import ScenarioRunner

    repo = VerificationRepository(tmp_path / "metadata.db")
    dossier = ScenarioRunner.verify_scenario_fix(
        scenario_id=scenario_id,
        workspace_root=tmp_path,
        fix_mode=fix_mode,
        repository=repo,
    )
    assert dossier.verification.verdict == expected_verdict
    assert dossier.verification.candidate_run_id is not None
    assert dossier.verification.faulted_run_id is not None


def test_scenario_runner_unknown_scenario_raises(tmp_path: Path) -> None:
    """Verify that an unknown scenario ID raises an error."""
    from data_rewind.core.domain.errors import DataRewindError
    from data_rewind.scenarios.runner import ScenarioRunner

    with pytest.raises(DataRewindError) as exc:
        ScenarioRunner.verify_scenario_fix(
            scenario_id="unknown_scenario",
            workspace_root=tmp_path,
        )
    assert exc.value.code == "UNKNOWN_SCENARIO"


# --- 5. Intentional Contract Strict Validation Tests ---


def test_intentional_contract_rejects_unallowed_step() -> None:
    """Verify that intentional contract fails when an unauthorized step drifts."""
    contract = IntentionalUpdateContract(
        allowed_steps=["allowed_step"],
        justification="Allowed step only",
    )
    comparisons = {
        "unallowed_step": make_diff_result(is_equal=False, modified=1),
    }
    assert TriRunEvaluator._verify_intentional_contract(contract, comparisons) is False


def test_intentional_contract_rejects_unallowed_column() -> None:
    """Verify that intentional contract fails when an unallowed column drifts."""
    contract = IntentionalUpdateContract(
        allowed_steps=["step1"],
        allowed_columns_by_step={"step1": ["allowed_col"]},
        justification="allowed_col only",
    )
    sample_diffs = [
        RowDiff(
            category=DiffCategory.MODIFIED,
            key_values={"id": 1},
            baseline_row={"id": 1, "unallowed_col": 10},
            target_row={"id": 1, "unallowed_col": 20},
            field_diffs=[ValueDiff(column="unallowed_col", baseline_value=10, target_value=20)],
        )
    ]
    comparisons = {
        "step1": make_diff_result(is_equal=False, modified=1, sample_diffs=sample_diffs),
    }
    assert TriRunEvaluator._verify_intentional_contract(contract, comparisons) is False


def test_intentional_contract_rejects_row_count_change_when_disallowed() -> None:
    """Verify that intentional contract fails when row count changes without permission."""
    contract = IntentionalUpdateContract(
        allowed_steps=["step1"],
        allow_row_count_change=False,
        justification="No row count changes allowed",
    )
    # Baseline row count = 10, Target = 12 (added = 2)
    comparisons = {
        "step1": make_diff_result(is_equal=False, identical=10, added=2),
    }
    assert TriRunEvaluator._verify_intentional_contract(contract, comparisons) is False


# --- 6. CSV Verification Summary Export Tests ---


def test_csv_verification_summary_export() -> None:
    """Verify export_verification_summary in both safe and raw modes."""
    from data_rewind.verification.models import (
        BaselineEquivalenceAxisResult,
        DualAxisEvaluation,
        RemediationAxisResult,
        TriRunVerification,
    )
    from data_rewind.verification.reports import CSVDossierExporter

    comp = {
        "step1": make_diff_result(is_equal=True, identical=10),
        "step2": make_diff_result(is_equal=False, modified=2),
    }
    v = TriRunVerification(
        verification_id=uuid4(),
        title="Test CSV Summary",
        faulted_run_id=uuid4(),
        candidate_run_id=uuid4(),
        verdict=VerificationVerdict.PARTIAL_RESTORATION,
        verdict_meaning="Partial restoration.",
        dual_axis=DualAxisEvaluation(
            remediation_axis=RemediationAxisResult(eod_step="step1", eod_remediated=True),
            baseline_axis=BaselineEquivalenceAxisResult(step_comparisons=comp),
        ),
    )

    csv_safe, escaped_safe = CSVDossierExporter.export_verification_summary(v, export_mode="safe")
    assert "step_id,r2_vs_r0_identical,r2_vs_r0_modified" in csv_safe
    assert "step1,10,0,0,0,True,REMEDIATED,CLEAN" in csv_safe
    assert "step2,10,2,0,0,False,PASS,DIVERGENT" in csv_safe

    csv_raw, escaped_raw = CSVDossierExporter.export_verification_summary(v, export_mode="raw")
    assert "step1,10,0,0,0,True,REMEDIATED,CLEAN" in csv_raw


# --- 7. CLI End-to-End Command Tests ---


def test_cli_verify_fix_and_export_report(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Verify CLI verify-fix and export-report commands end-to-end."""
    import argparse

    from data_rewind.cli import handle_export_report, handle_verify_fix

    monkeypatch.setenv("DATA_REWIND_DATA_DIR", str(tmp_path))

    # 1. Run verify-fix
    args_clean = argparse.Namespace(
        scenario="scn01",
        fix_mode="clean",
        format="text",
        output=None,
    )
    code = handle_verify_fix(args_clean)
    assert code == 0

    # Retrieve persisted verification ID from repo
    repo = VerificationRepository(tmp_path / "metadata.db")
    summaries = repo.list_verifications()
    assert len(summaries) >= 1
    v_id = summaries[0].verification_id

    # 2. Export dossier to JSON
    json_out = tmp_path / "exported_dossier.json"
    args_export = argparse.Namespace(
        verification_id=str(v_id),
        format="json",
        output=str(json_out),
    )
    export_code = handle_export_report(args_export)
    assert export_code == 0
    assert json_out.is_file()
    assert "VERIFIED_CLEAN" in json_out.read_text(encoding="utf-8")

    # 3. Export dossier to Markdown
    md_out = tmp_path / "exported_dossier.md"
    args_export_md = argparse.Namespace(
        verification_id=str(v_id),
        format="markdown",
        output=str(md_out),
    )
    export_md_code = handle_export_report(args_export_md)
    assert export_md_code == 0
    assert md_out.is_file()
    assert "Forensic Investigation Dossier" in md_out.read_text(encoding="utf-8")
