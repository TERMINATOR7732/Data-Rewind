"""Data Rewind API Pydantic schemas and standardized envelope models.

Conforms strictly to SPEC-MOD-07 §3 and §4.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class ErrorDetail(BaseModel):
    """Standardized error structure conforming to SPEC-MOD-07 §4."""

    model_config = ConfigDict(frozen=True)

    code: str
    message: str
    details: dict[str, Any] = Field(default_factory=dict)
    remediation: str | None = None
    timestamp: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())


class ErrorEnvelope(BaseModel):
    """Outer envelope wrapping all API errors."""

    model_config = ConfigDict(frozen=True)

    error: ErrorDetail


class HealthResponse(BaseModel):
    """Health check response schema."""

    status: str = "ok"
    app_name: str
    version: str
    profile: str
    limits: dict[str, Any]
    free_disk_mb: float
    rss_mib: float


class ScenarioSummary(BaseModel):
    """Demonstration scenario metadata for frontend discovery."""

    scenario_id: str
    title: str
    description: str
    expected_eod_step: str
    expected_rule_id: str
    step_count: int
    input_tables: list[str]
    primary_keys_by_step: dict[str, list[str]]


class DatasetColumnInfo(BaseModel):
    """Metadata for a dataset column."""

    name: str
    data_type: str


class DatasetUploadResponse(BaseModel):
    """Response returned upon successful CSV ingestion."""

    dataset_id: str
    filename: str
    row_count: int
    column_count: int
    byte_size: int
    sha256_hash: str
    columns: list[DatasetColumnInfo]


class DatasetPreviewResponse(BaseModel):
    """Preview metadata and row samples."""

    dataset_id: str
    filename: str
    row_count: int
    column_count: int
    columns: list[DatasetColumnInfo]
    sample_rows: list[dict[str, Any]]


class PipelineValidateRequest(BaseModel):
    """Pipeline definition validation request."""

    steps: list[dict[str, Any]]
    inputs: list[str] = Field(default_factory=list)


class PipelineValidateResponse(BaseModel):
    """Pipeline validation outcome."""

    valid: bool
    topological_order: list[str] = Field(default_factory=list)
    error_message: str | None = None


class PipelineExecuteRequest(BaseModel):
    """Request to execute an arbitrary pipeline."""

    steps: list[dict[str, Any]]
    inputs: dict[str, list[dict[str, Any]]] = Field(default_factory=dict)
    dataset_ids: dict[str, str] = Field(default_factory=dict)


class StepDiffPage(BaseModel):
    """Paginated step-level row differences."""

    step_id: str
    filter_status: str
    total_matching_rows: int
    page: int
    page_size: int
    total_pages: int
    columns: list[str]
    primary_keys: list[str]
    rows: list[dict[str, Any]]


class VerificationRunRequest(BaseModel):
    """Request to execute tri-run fix verification."""

    scenario_id: str
    fix_mode: str = "clean"  # "clean", "intentional", "partial", "unresolved", "collateral"
    intentional_contract: dict[str, Any] | None = None


class WorkspacePurgeResponse(BaseModel):
    """Response from application-managed deletion."""

    purged_bytes: int
    unlinked_files_count: int
    vacuum_completed: bool
    message: str
