"""Data Rewind Tri-Run Fix Verification & Forensic Reporting Domain Models.

Conforms strictly to SPEC-MOD-05 (Fix Verification & Forensic Reports) and
SPEC-MOD-02 (Shared Domain Model & Data Lifecycle).
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field

from data_rewind.comparator.models import TabularDiffResult
from data_rewind.core.domain.models import utc_now
from data_rewind.lineage.models import BlastRadiusReport


class RunRole(str, Enum):
    """The formal role of a pipeline execution within the Tri-Run Verification Protocol."""

    BASELINE = "BASELINE"
    """R0: The trusted or expected historical reference execution (golden truth)."""

    FAULTED = "FAULTED"
    """R1: The execution exhibiting the detected regression or data corruption."""

    FIX = "FIX"
    """R2: The candidate remediation execution incorporating the proposed patch or input."""


class VerificationVerdict(str, Enum):
    """Canonical verification verdict codes conforming strictly to SPEC-MOD-05 §1.3."""

    VERIFIED_CLEAN = "VERIFIED_CLEAN"
    """R2 remediates R1 fault AND R2 == R0 across all downstream sinks."""

    INTENTIONAL_UPDATE = "INTENTIONAL_UPDATE"
    """R2 remediates R1 fault; R2 differs from R0 strictly in declared fix contract columns/rows."""

    PARTIAL_RESTORATION = "PARTIAL_RESTORATION"
    """EOD fault severity reduced, but residual differences remain against R0."""

    REGRESSION_UNRESOLVED = "REGRESSION_UNRESOLVED"
    """R2 produces identical divergent outputs to R1 at the EOD step."""

    NEW_FAULT_INTRODUCED = "NEW_FAULT_INTRODUCED"
    """EOD fault resolved, but a new divergence or runtime error appeared at a different step."""

    BASELINE_UNAVAILABLE = "BASELINE_UNAVAILABLE"
    """R0 is missing; R2 remediates R1, but baseline equivalence cannot be established."""

    FAULT_UNREPRODUCIBLE = "FAULT_UNREPRODUCIBLE"
    """The defect in R1 could not be reproduced under test conditions (cannot prove remediation)."""

    INCONCLUSIVE_VERIFICATION = "INCONCLUSIVE_VERIFICATION"
    """Ambiguous keyless data correspondence or non-deterministic transformations present."""


class EvidenceTier(str, Enum):
    """Categorical evidence tiers conforming to SPEC-MOD-05 §2.1 and SPEC-MOD-04."""

    PROVEN_OBSERVATION = "PROVEN_OBSERVATION"
    """Direct, mathematically verified fact (e.g. hash equality, exact row diff, type check)."""

    CAUSAL_HYPOTHESIS_DIRECT_CODE_DIFF = "CAUSAL_HYPOTHESIS_DIRECT_CODE_DIFF"
    """Inferred root cause supported by direct transformation logic or parameter diff."""

    CAUSAL_HYPOTHESIS_INPUT_DRIFT = "CAUSAL_HYPOTHESIS_INPUT_DRIFT"
    """Inferred root cause attributed to upstream ingestion data drift."""

    STATISTICAL_CORRELATION = "STATISTICAL_CORRELATION"
    """Correlative metric or distribution shift without direct deterministic row tracking."""

    INCONCLUSIVE_HEURISTIC = "INCONCLUSIVE_HEURISTIC"
    """Ambiguous correspondence or unkeyed heuristic similarity metric."""


class EvidenceItem(BaseModel):
    """A discrete piece of supporting evidence in the forensic investigation chain."""

    model_config = ConfigDict(frozen=True)

    evidence_id: UUID = Field(default_factory=uuid4)
    tier: EvidenceTier
    code: str
    summary: str
    step_id: str | None = None
    is_observed_fact: bool = True
    details: dict[str, Any] = Field(default_factory=dict)


class MissingEvidenceDeclaration(BaseModel):
    """Explicit declaration of unavailable, omitted, or unverified artifacts/evidence."""

    model_config = ConfigDict(frozen=True)

    category: str
    description: str
    remediation_advice: str


class IntentionalUpdateContract(BaseModel):
    """Specification of explicitly permitted divergences between candidate (R2) and baseline (R0)."""

    model_config = ConfigDict(frozen=True)

    allowed_steps: list[str] = Field(default_factory=list)
    allowed_columns_by_step: dict[str, list[str]] = Field(default_factory=dict)
    allow_row_count_change: bool = False
    justification: str = ""


class RemediationAxisResult(BaseModel):
    """Axis 1: Remediation Evaluation (R2 vs R1) - proves EOD fault elimination."""

    model_config = ConfigDict(frozen=True)

    eod_step: str | None = None
    eod_remediated: bool = False
    eod_severity_reduced: bool = False
    unresolved_eod_differences: list[str] = Field(default_factory=list)
    eod_diff: TabularDiffResult | None = None
    explanation: str = ""


class BaselineEquivalenceAxisResult(BaseModel):
    """Axis 2: Baseline Equivalence (R2 vs R0) - proves zero secondary regressions."""

    model_config = ConfigDict(frozen=True)

    baseline_equivalent_at_sinks: bool = False
    baseline_equivalent_across_all_steps: bool = False
    collateral_regressions: list[str] = Field(default_factory=list)
    sink_step_ids: list[str] = Field(default_factory=list)
    step_comparisons: dict[str, TabularDiffResult] = Field(default_factory=dict)
    explanation: str = ""


class DualAxisEvaluation(BaseModel):
    """Synthesis of the two simultaneous evaluation axes."""

    model_config = ConfigDict(frozen=True)

    remediation_axis: RemediationAxisResult
    baseline_axis: BaselineEquivalenceAxisResult | None = None


class TriRunVerification(BaseModel):
    """Complete forensic result of a Tri-Run Fix Verification operation."""

    model_config = ConfigDict(frozen=True)

    verification_id: UUID = Field(default_factory=uuid4)
    title: str
    baseline_run_id: UUID | None = None
    faulted_run_id: UUID
    candidate_run_id: UUID
    verdict: VerificationVerdict
    verdict_meaning: str
    verdict_reason_codes: list[str] = Field(default_factory=list)
    dual_axis: DualAxisEvaluation
    intentional_contract: IntentionalUpdateContract | None = None
    evidence_chain: list[EvidenceItem] = Field(default_factory=list)
    missing_evidence: list[MissingEvidenceDeclaration] = Field(default_factory=list)
    blast_radius: BlastRadiusReport | None = None
    created_at: datetime = Field(default_factory=utc_now)
    duration_ms: float = 0.0


class VerificationSummary(BaseModel):
    """Compact record for listing and catalog queries."""

    model_config = ConfigDict(frozen=True)

    verification_id: UUID
    title: str
    verdict: VerificationVerdict
    baseline_run_id: UUID | None
    faulted_run_id: UUID
    candidate_run_id: UUID
    created_at: datetime


class ForensicDossierMetadata(BaseModel):
    """Header and environment telemetry for a forensic investigation dossier."""

    model_config = ConfigDict(frozen=True)

    dossier_id: UUID = Field(default_factory=uuid4)
    pipeline_name: str
    pipeline_version_hash: str
    investigator_session: str
    baseline_run_id: UUID | None = None
    faulted_run_id: UUID
    candidate_run_id: UUID
    created_at: datetime = Field(default_factory=utc_now)


class ForensicDossier(BaseModel):
    """Complete immutable Forensic Investigation Dossier bundle."""

    model_config = ConfigDict(frozen=True)

    metadata: ForensicDossierMetadata
    verification: TriRunVerification
    reproducibility_signatures: dict[str, str] = Field(default_factory=dict)
    limitations_disclaimer: str = (
        "Forensic evidence is compiled locally via deterministic tabular comparisons and "
        "reproducible hashing. Findings distinguish observed mathematical facts from "
        "causal hypotheses. Bit-for-bit logical equivalence requires raw data export."
    )
