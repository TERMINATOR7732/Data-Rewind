"""Data Rewind Historical Replay and Reproducibility models.

Conforms strictly to Section 3.4 of SPEC-MOD-03.
"""

from __future__ import annotations

from enum import Enum
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ReplayOutcome(str, Enum):
    """Five canonical replay outcomes conforming to SPEC-MOD-03 §3.4."""

    REPRODUCIBLE = "REPRODUCIBLE"
    """All inputs present, definition matched, and output multiset hashes match 100%."""

    PARTIALLY_REPRODUCIBLE = "PARTIALLY_REPRODUCIBLE"
    """Row counts and categorical values match, with float variances <= 1e-6 or reordered rows."""

    BLOCKED_MISSING_ARTIFACTS = "BLOCKED_MISSING_ARTIFACTS"
    """One or more required historical raw input artifacts are absent from workspace storage."""

    DIVERGENT = "DIVERGENT"
    """Inputs and pipeline matched, but output artifact hashes differ from historical records."""

    FAILED_VERIFICATION = "FAILED_VERIFICATION"
    """Replay execution aborted prematurely due to step error or unhandled runtime failure."""


class ReplayStepVerification(BaseModel):
    """Per-step verification record comparing replayed output against historical output."""

    model_config = ConfigDict(frozen=True)

    step_id: str
    historical_multiset_hash: str | None = None
    replayed_multiset_hash: str | None = None
    is_matched: bool
    is_late_divergence_point: bool = False
    variance_details: str | None = None


class ReplayResult(BaseModel):
    """Complete forensic result of a historical replay operation."""

    model_config = ConfigDict(frozen=True)

    replay_run_id: UUID
    historical_run_id: UUID
    outcome: ReplayOutcome
    explanation: str
    missing_artifacts: list[str] = Field(default_factory=list)
    step_verifications: dict[str, ReplayStepVerification] = Field(default_factory=dict)
    late_divergence_step_id: str | None = None
    execution_duration_ms: float = 0.0
