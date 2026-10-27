"""Data Rewind Tri-Run Fix Verification Evaluator.

Conforms strictly to SPEC-MOD-05 (Fix Verification & Forensic Reports §1).
Executes dual-axis evaluation and synthesizes the canonical verdict matrix.
"""

from __future__ import annotations

from uuid import UUID

from data_rewind.comparator.models import CaseClassification, TabularDiffResult
from data_rewind.lineage.models import BlastRadiusReport
from data_rewind.verification.models import (
    BaselineEquivalenceAxisResult,
    DualAxisEvaluation,
    EvidenceItem,
    EvidenceTier,
    IntentionalUpdateContract,
    MissingEvidenceDeclaration,
    RemediationAxisResult,
    TriRunVerification,
    VerificationVerdict,
)


class TriRunValidationError(Exception):
    """Raised when tri-run execution parameters or associations are invalid."""


class TriRunEvaluator:
    """Evaluates candidate fix runs across the dual-axis verification protocol."""

    @classmethod
    def evaluate(
        cls,
        title: str,
        faulted_run_id: UUID,
        candidate_run_id: UUID,
        topological_order: list[str],
        sink_step_ids: list[str],
        step_comparisons_r2_r1: dict[str, TabularDiffResult],
        baseline_run_id: UUID | None = None,
        step_comparisons_r2_r0: dict[str, TabularDiffResult] | None = None,
        step_comparisons_r1_r0: dict[str, TabularDiffResult] | None = None,
        eod_step_id: str | None = None,
        intentional_contract: IntentionalUpdateContract | None = None,
        blast_radius: BlastRadiusReport | None = None,
        missing_evidence_declarations: list[MissingEvidenceDeclaration] | None = None,
        execution_duration_ms: float = 0.0,
    ) -> TriRunVerification:
        """Execute complete tri-run verification evaluation conforming to SPEC-MOD-05 §1."""
        # 1. Pre-flight Validation of Run Associations
        if candidate_run_id == faulted_run_id:
            raise TriRunValidationError(
                f"Candidate fix run R2 ({candidate_run_id}) cannot be identical to Faulted run R1 ({faulted_run_id})."
            )

        if baseline_run_id is not None and candidate_run_id == baseline_run_id:
            raise TriRunValidationError(
                f"Candidate fix run R2 ({candidate_run_id}) cannot be identical to Baseline run R0 ({baseline_run_id})."
            )

        missing_evidence = list(missing_evidence_declarations or [])
        evidence_chain: list[EvidenceItem] = []
        reason_codes: list[str] = []

        # 2. Handle Missing Baseline (R0 is None)
        if baseline_run_id is None:
            missing_evidence.append(
                MissingEvidenceDeclaration(
                    category="BASELINE_RUN",
                    description="Baseline execution R0 was omitted or is unavailable.",
                    remediation_advice="Provide a trusted baseline run to mathematically verify baseline equivalence.",
                )
            )

            # Evaluate remediation axis against R1 alone
            eod_target = eod_step_id or (topological_order[0] if topological_order else None)
            eod_diff_r2_r1 = step_comparisons_r2_r1.get(eod_target) if eod_target else None

            if eod_diff_r2_r1 is not None and eod_diff_r2_r1.is_equal:
                # Candidate is completely identical to faulted run
                verdict = VerificationVerdict.REGRESSION_UNRESOLVED
                meaning = "FIX FAILED: Proposed modification did not eliminate the defect."
                reason_codes = ["EOD_IDENTICAL_TO_FAULT", "NO_REMEDIATION_OBSERVED"]
                remediation_axis = RemediationAxisResult(
                    eod_step=eod_target,
                    eod_remediated=False,
                    eod_severity_reduced=False,
                    unresolved_eod_differences=["Output identical to faulted run R1"],
                    eod_diff=eod_diff_r2_r1,
                    explanation="Candidate output matches faulted run R1 at EOD node.",
                )
            else:
                verdict = VerificationVerdict.BASELINE_UNAVAILABLE
                meaning = "REMEDIATION ONLY: Defect eliminated, but baseline equivalence unverified due to missing R0."
                reason_codes = ["REMEDIATION_OBSERVED", "BASELINE_UNAVAILABLE"]
                remediation_axis = RemediationAxisResult(
                    eod_step=eod_target,
                    eod_remediated=True,
                    eod_severity_reduced=True,
                    eod_diff=eod_diff_r2_r1,
                    explanation="Candidate modified output relative to faulted run R1, but R0 is absent.",
                )

            evidence_chain.append(
                EvidenceItem(
                    tier=EvidenceTier.PROVEN_OBSERVATION,
                    code="EV-MISSING-BASELINE",
                    summary="Baseline R0 run was not provided in verification request.",
                    is_observed_fact=True,
                    details={"baseline_run_id": None},
                )
            )

            return TriRunVerification(
                title=title,
                baseline_run_id=None,
                faulted_run_id=faulted_run_id,
                candidate_run_id=candidate_run_id,
                verdict=verdict,
                verdict_meaning=meaning,
                verdict_reason_codes=reason_codes,
                dual_axis=DualAxisEvaluation(
                    remediation_axis=remediation_axis,
                    baseline_axis=None,
                ),
                intentional_contract=intentional_contract,
                evidence_chain=evidence_chain,
                missing_evidence=missing_evidence,
                blast_radius=blast_radius,
                duration_ms=execution_duration_ms,
            )

        # Baseline R0 is present
        comp_r2_r0 = step_comparisons_r2_r0 or {}
        comp_r1_r0 = step_comparisons_r1_r0 or {}

        # 3. Verify Fault Reproduction (R1 vs R0)
        # If R1 matches R0 across all steps, defect was never reproduced!
        if comp_r1_r0:
            r1_has_divergence = any(not diff.is_equal for diff in comp_r1_r0.values())
            if not r1_has_divergence:
                verdict = VerificationVerdict.FAULT_UNREPRODUCIBLE
                meaning = "VERIFICATION BLOCKED: Faulted behavior is unverified; cannot prove remediation."
                reason_codes = ["FAULT_NOT_REPRODUCED", "R1_EQUALS_R0"]
                evidence_chain.append(
                    EvidenceItem(
                        tier=EvidenceTier.PROVEN_OBSERVATION,
                        code="EV-FAULT-UNREPRODUCED",
                        summary="Faulted run R1 output matches baseline R0 across all steps.",
                        is_observed_fact=True,
                    )
                )
                return TriRunVerification(
                    title=title,
                    baseline_run_id=baseline_run_id,
                    faulted_run_id=faulted_run_id,
                    candidate_run_id=candidate_run_id,
                    verdict=verdict,
                    verdict_meaning=meaning,
                    verdict_reason_codes=reason_codes,
                    dual_axis=DualAxisEvaluation(
                        remediation_axis=RemediationAxisResult(
                            eod_step=eod_step_id,
                            eod_remediated=False,
                            explanation="Fault was not observed in R1 relative to R0.",
                        ),
                        baseline_axis=BaselineEquivalenceAxisResult(
                            baseline_equivalent_at_sinks=True,
                            baseline_equivalent_across_all_steps=True,
                            step_comparisons=comp_r2_r0,
                        ),
                    ),
                    intentional_contract=intentional_contract,
                    evidence_chain=evidence_chain,
                    missing_evidence=missing_evidence,
                    blast_radius=blast_radius,
                    duration_ms=execution_duration_ms,
                )

        # 4. Resolve EOD Step
        target_eod = eod_step_id
        if not target_eod and comp_r1_r0:
            for sid in topological_order:
                d = comp_r1_r0.get(sid)
                if d and not d.is_equal:
                    target_eod = sid
                    break
        if not target_eod and topological_order:
            target_eod = topological_order[0]

        # 5. Evaluate Axis 1: Remediation Evaluation (R2 vs R1)
        eod_diff_r2_r1 = step_comparisons_r2_r1.get(target_eod) if target_eod else None
        eod_diff_r2_r0 = comp_r2_r0.get(target_eod) if target_eod else None
        eod_diff_r1_r0 = comp_r1_r0.get(target_eod) if target_eod else None

        eod_remediated = False
        eod_severity_reduced = False
        unresolved_eod_diffs: list[str] = []

        if eod_diff_r2_r1 is not None and eod_diff_r2_r1.is_equal:
            # R2 is identical to R1 at EOD -> Proposed fix did not change faulted output
            eod_remediated = False
            eod_severity_reduced = False
            unresolved_eod_diffs.append(
                f"Output at step '{target_eod}' is 100% identical to faulted run R1."
            )
        else:
            # R2 changed relative to R1 at EOD
            if eod_diff_r2_r0 is not None and eod_diff_r2_r0.is_equal:
                # R2 matches R0 100% at EOD!
                eod_remediated = True
                eod_severity_reduced = True
            elif eod_diff_r2_r0 is not None and eod_diff_r1_r0 is not None:
                # Check if severity is reduced
                # Severity metric: sum of modified, added, removed rows
                err_r1 = (
                    eod_diff_r1_r0.modified_count
                    + eod_diff_r1_r0.added_count
                    + eod_diff_r1_r0.removed_count
                )
                err_r2 = (
                    eod_diff_r2_r0.modified_count
                    + eod_diff_r2_r0.added_count
                    + eod_diff_r2_r0.removed_count
                )
                if err_r2 < err_r1:
                    eod_remediated = True
                    eod_severity_reduced = True
                    unresolved_eod_diffs.append(
                        f"Discrepancy count reduced from {err_r1} to {err_r2} rows."
                    )
                else:
                    eod_remediated = False
                    eod_severity_reduced = False
                    unresolved_eod_diffs.append(
                        f"Residual discrepancies at EOD node: {err_r2} rows."
                    )
            else:
                eod_remediated = True

        remediation_axis = RemediationAxisResult(
            eod_step=target_eod,
            eod_remediated=eod_remediated,
            eod_severity_reduced=eod_severity_reduced,
            unresolved_eod_differences=unresolved_eod_diffs,
            eod_diff=eod_diff_r2_r1,
            explanation=(
                f"EOD step '{target_eod}' defect was fully remediated."
                if eod_remediated and (eod_diff_r2_r0 is not None and eod_diff_r2_r0.is_equal)
                else (
                    f"EOD step '{target_eod}' defect severity was reduced."
                    if eod_severity_reduced
                    else f"EOD step '{target_eod}' defect remains unresolved."
                )
            ),
        )

        evidence_chain.append(
            EvidenceItem(
                tier=EvidenceTier.PROVEN_OBSERVATION,
                code="EV-AXIS1-REMEDIATION",
                step_id=target_eod,
                summary=remediation_axis.explanation,
                is_observed_fact=True,
                details={
                    "eod_step": target_eod,
                    "remediated": eod_remediated,
                    "severity_reduced": eod_severity_reduced,
                },
            )
        )

        # 6. Evaluate Axis 2: Baseline Equivalence (R2 vs R0)
        collateral_regressions: list[str] = []
        sink_steps = sink_step_ids or ([topological_order[-1]] if topological_order else [])
        sink_diffs: dict[str, TabularDiffResult] = {}
        all_steps_match = True
        sinks_match = True
        inconclusive_flag = False

        # Identify tainted steps in R1 vs R0 to distinguish expected fix propagation from collateral regressions
        r1_divergent_steps = {sid for sid, d in comp_r1_r0.items() if not d.is_equal}

        for sid in topological_order:
            diff_r2_r0 = comp_r2_r0.get(sid)
            if diff_r2_r0 is None:
                missing_evidence.append(
                    MissingEvidenceDeclaration(
                        category="STEP_CHECKPOINT",
                        description=f"Step checkpoint '{sid}' is missing for baseline comparison.",
                        remediation_advice=f"Ensure step '{sid}' is materialized during pipeline execution.",
                    )
                )
                all_steps_match = False
                continue

            if sid in sink_steps:
                sink_diffs[sid] = diff_r2_r0
                if not diff_r2_r0.is_equal:
                    sinks_match = False

            if not diff_r2_r0.is_equal:
                all_steps_match = False

                # Check if this divergence is a collateral regression:
                # A step that was clean in R1 vs R0, and is not the intended EOD/fix step
                if comp_r1_r0 and sid not in r1_divergent_steps and sid != target_eod:
                    collateral_regressions.append(sid)

                # Check for inconclusive keyless correspondence
                if (
                    CaseClassification.CASE_5_KEYLESS_MULTISET in diff_r2_r0.case_classifications
                    and (diff_r2_r0.added_count > 0 or diff_r2_r0.removed_count > 0)
                ):
                    # Keyless row matching cannot track individual record identity
                    inconclusive_flag = True

        baseline_axis = BaselineEquivalenceAxisResult(
            baseline_equivalent_at_sinks=sinks_match,
            baseline_equivalent_across_all_steps=all_steps_match,
            collateral_regressions=collateral_regressions,
            sink_step_ids=sink_steps,
            step_comparisons=comp_r2_r0,
            explanation=(
                "All downstream sinks and upstream steps match baseline R0 100%."
                if all_steps_match
                else (
                    "Downstream sinks match baseline R0, but intermediate steps exhibit differences."
                    if sinks_match
                    else f"Downstream sinks diverge from baseline R0. Regressions detected at: {collateral_regressions or 'sinks'}."
                )
            ),
        )

        evidence_chain.append(
            EvidenceItem(
                tier=EvidenceTier.PROVEN_OBSERVATION,
                code="EV-AXIS2-BASELINE-EQUIVALENCE",
                summary=baseline_axis.explanation,
                is_observed_fact=True,
                details={
                    "all_steps_match": all_steps_match,
                    "sinks_match": sinks_match,
                    "collateral_regressions": collateral_regressions,
                },
            )
        )

        # 7. Synthesize Canonical Verdict Matrix (SPEC-MOD-05 §1.3)
        if not eod_remediated and not eod_severity_reduced:
            verdict = VerificationVerdict.REGRESSION_UNRESOLVED
            meaning = "FIX FAILED: Proposed modification did not eliminate the defect."
            reason_codes = ["EOD_DEFECT_PERSISTS", "REGRESSION_UNRESOLVED"]

        elif collateral_regressions:
            verdict = VerificationVerdict.NEW_FAULT_INTRODUCED
            first_collat = collateral_regressions[0]
            meaning = f"CRITICAL WARNING: Fix introduced secondary regression at Step '{first_collat}'. Deployment blocked."
            reason_codes = ["SECONDARY_REGRESSION_DETECTED", f"FAULT_STEP_{first_collat}"]

        elif inconclusive_flag and not sinks_match:
            verdict = VerificationVerdict.INCONCLUSIVE_VERIFICATION
            meaning = "INCONCLUSIVE: Verification cannot be proven with mathematical certainty due to keyless ambiguity."
            reason_codes = ["KEYLESS_CORRESPONDENCE_AMBIGUOUS", "UNTRACKABLE_ROW_IDENTITY"]

        elif not all_steps_match or not sinks_match:
            # Residual differences exist against R0. Check Intentional Update Contract!
            contract_satisfied = False
            if intentional_contract is not None:
                contract_satisfied = cls._verify_intentional_contract(
                    contract=intentional_contract,
                    comparisons=comp_r2_r0,
                )

            if contract_satisfied and intentional_contract is not None:
                verdict = VerificationVerdict.INTENTIONAL_UPDATE
                meaning = "INTENTIONAL DRIFT VERIFIED: Pipeline logic updated as intended. Expected changes confirmed."
                reason_codes = ["INTENTIONAL_DRIFT_CONFIRMED", "CONTRACT_SATISFIED"]
                evidence_chain.append(
                    EvidenceItem(
                        tier=EvidenceTier.CAUSAL_HYPOTHESIS_DIRECT_CODE_DIFF,
                        code="EV-INTENTIONAL-CONTRACT-SATISFIED",
                        summary="Divergences from baseline strictly match declared intentional update contract.",
                        is_observed_fact=False,
                        details={"justification": intentional_contract.justification},
                    )
                )
            else:
                verdict = VerificationVerdict.PARTIAL_RESTORATION
                meaning = "PARTIAL RESTORATION: Primary defect mitigated, but outputs remain divergent from baseline."
                reason_codes = ["PRIMARY_DEFECT_MITIGATED", "RESIDUAL_BASELINE_DRIFT"]

        else:
            # 100% equivalence across all steps and sinks!
            verdict = VerificationVerdict.VERIFIED_CLEAN
            meaning = "VERIFIED CLEAN: Baseline equivalence restored 100%. Zero secondary regressions detected."
            reason_codes = ["BASELINE_EQUIVALENCE_RESTORED_100%", "ZERO_SECONDARY_REGRESSIONS"]

        return TriRunVerification(
            title=title,
            baseline_run_id=baseline_run_id,
            faulted_run_id=faulted_run_id,
            candidate_run_id=candidate_run_id,
            verdict=verdict,
            verdict_meaning=meaning,
            verdict_reason_codes=reason_codes,
            dual_axis=DualAxisEvaluation(
                remediation_axis=remediation_axis,
                baseline_axis=baseline_axis,
            ),
            intentional_contract=intentional_contract,
            evidence_chain=evidence_chain,
            missing_evidence=missing_evidence,
            blast_radius=blast_radius,
            duration_ms=execution_duration_ms,
        )

    @classmethod
    def _verify_intentional_contract(
        cls,
        contract: IntentionalUpdateContract,
        comparisons: dict[str, TabularDiffResult],
    ) -> bool:
        """Verify whether all differences between R2 and R0 conform strictly to the intentional contract."""
        allowed_steps_set = set(contract.allowed_steps)
        for sid, diff in comparisons.items():
            if not diff.is_equal:
                if sid not in allowed_steps_set:
                    return False

                # If allowed columns are declared for this step, verify column footprint
                allowed_cols = set(contract.allowed_columns_by_step.get(sid, []))
                if allowed_cols:
                    # Check modified fields in sample row diffs
                    for r_diff in diff.sample_row_diffs:
                        for f_diff in r_diff.field_diffs:
                            if f_diff.column not in allowed_cols:
                                return False

                if (
                    not contract.allow_row_count_change
                    and diff.baseline_row_count != diff.target_row_count
                ):
                    return False

        return True
