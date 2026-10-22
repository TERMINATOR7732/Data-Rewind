"""Data Rewind Interactive Forensic Investigation models.

Conforms to SPEC-MOD-01, SPEC-MOD-04, and SPEC-MOD-07.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field

from data_rewind.comparator.models import TabularDiffResult
from data_rewind.core.domain.models import utc_now
from data_rewind.diagnostics.models import EODResult, EODStatus
from data_rewind.lineage.models import BlastRadiusReport


class InvestigationStatus(str, Enum):
    """Lifecycle status of an engineering forensic investigation."""

    ACTIVE = "ACTIVE"
    RESOLVED = "RESOLVED"
    CLOSED = "CLOSED"


class InvestigationSummary(BaseModel):
    """Compact summary of an investigation for listing and table views."""

    model_config = ConfigDict(frozen=True)

    investigation_id: UUID
    title: str
    baseline_run_id: UUID
    target_run_id: UUID
    status: InvestigationStatus
    primary_eod_step: str | None
    eod_status: EODStatus
    blast_radius_ratio: float
    created_at: datetime


class Investigation(BaseModel):
    """Complete forensic investigation record comparing two execution runs."""

    model_config = ConfigDict(frozen=True)

    investigation_id: UUID = Field(default_factory=uuid4)
    title: str
    baseline_run_id: UUID
    target_run_id: UUID
    status: InvestigationStatus = InvestigationStatus.ACTIVE
    created_at: datetime = Field(default_factory=utc_now)
    topological_order: list[str] = Field(default_factory=list)
    step_comparisons: dict[str, TabularDiffResult] = Field(default_factory=dict)
    eod_result: EODResult
    blast_radius: BlastRadiusReport
    summary: str
