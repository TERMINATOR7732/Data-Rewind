"""Data Rewind canonical domain models, value objects, and enums.

Conforms strictly to SPEC-MOD-02 (Shared Domain Model & Data Lifecycle).
"""

from __future__ import annotations

from datetime import UTC, datetime
from enum import Enum
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator

from data_rewind.core.domain.errors import DomainValidationError


def utc_now() -> datetime:
    """Return timezone-aware current UTC timestamp."""
    return datetime.now(UTC)


# --- Domain Enums ---


class WorkspaceMode(str, Enum):
    """Execution workspace modes."""

    DEMO = "DEMO"
    CSV_UPLOAD = "CSV_UPLOAD"
    DEVELOPER = "DEVELOPER"


class DataType(str, Enum):
    """Supported tabular primitive types."""

    STRING = "STRING"
    INTEGER = "INTEGER"
    FLOAT = "FLOAT"
    BOOLEAN = "BOOLEAN"
    DATE = "DATE"
    TIMESTAMP = "TIMESTAMP"


class OperationType(str, Enum):
    """Canonical transformation step operations."""

    FILTER_ROWS = "filter_rows"
    JOIN_DATASETS = "join_datasets"
    AGGREGATE_GROUP_BY = "aggregate_group_by"
    DERIVE_COLUMN = "derive_column"
    DEDUPLICATE_ROWS = "deduplicate_rows"
    CAST_COLUMNS = "cast_columns"


class RunType(str, Enum):
    """Intent categories for pipeline executions."""

    BASELINE = "BASELINE"
    INVESTIGATION_PROBE = "INVESTIGATION_PROBE"
    FIX_VERIFICATION = "FIX_VERIFICATION"
    HISTORICAL_REPLAY = "HISTORICAL_REPLAY"


class RunLifecycle(str, Enum):
    """Run lifecycle states conforming to the canonical FSM."""

    PENDING = "PENDING"
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"
    INTERRUPTED = "INTERRUPTED"


class StepStatus(str, Enum):
    """Execution status for an individual DAG step."""

    PENDING = "PENDING"
    RUNNING = "RUNNING"
    SUCCESS = "SUCCESS"
    FAILED = "FAILED"
    SKIPPED = "SKIPPED"
    CANCELLED = "CANCELLED"


class ValidationSeverity(str, Enum):
    """Diagnostic severity levels for validation reports."""

    ERROR = "ERROR"
    WARNING = "WARNING"
    INFO = "INFO"


# --- Value Objects & Integrity Types ---


class ContentHash(BaseModel):
    """Cryptographic hash representation with format validation."""

    model_config = ConfigDict(frozen=True)

    algorithm: str = Field(default="SHA-256")
    hex_digest: str

    @field_validator("hex_digest")
    @classmethod
    def validate_hex_digest(cls, value: str) -> str:
        cleaned = value.lower().strip()
        if len(cleaned) != 64:
            raise DomainValidationError(
                f"SHA-256 hex digest must be exactly 64 characters, got {len(cleaned)}",
                code="INVALID_HASH_LENGTH",
            )
        try:
            int(cleaned, 16)
        except ValueError as exc:
            raise DomainValidationError(
                f"Invalid hex character in SHA-256 digest: '{cleaned}'",
                code="MALFORMED_HASH_HEX",
            ) from exc
        return cleaned

    def __str__(self) -> str:
        return self.hex_digest


class ValidationIssue(BaseModel):
    """Structured diagnostic validation report entry."""

    model_config = ConfigDict(frozen=True)

    severity: ValidationSeverity
    code: str
    message: str
    location: str | None = None


# --- Schema and Column Definitions ---


class ColumnDefinition(BaseModel):
    """Column definition for tabular datasets."""

    model_config = ConfigDict(frozen=True)

    name: str = Field(..., min_length=1)
    data_type: DataType
    is_nullable: bool = True
    ordinal_position: int = Field(..., ge=0)

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        trimmed = v.strip()
        if not trimmed:
            raise DomainValidationError(
                "Column name cannot be blank or empty",
                code="EMPTY_COLUMN_NAME",
            )
        if "\x00" in trimmed:
            raise DomainValidationError(
                "Column name cannot contain null bytes",
                code="NULL_BYTE_IN_NAME",
            )
        return trimmed


class DatasetSchema(BaseModel):
    """Formal structural contract of a tabular dataset."""

    model_config = ConfigDict(frozen=True)

    schema_id: UUID = Field(default_factory=uuid4)
    column_count: int = Field(..., ge=1)
    fingerprint_sha256: str
    columns: list[ColumnDefinition]

    @field_validator("columns")
    @classmethod
    def validate_unique_columns(cls, cols: list[ColumnDefinition]) -> list[ColumnDefinition]:
        if not cols:
            raise DomainValidationError(
                "Schema must define at least one column",
                code="EMPTY_SCHEMA",
            )
        seen_names: set[str] = set()
        for c in cols:
            lowered = c.name.lower()
            if lowered in seen_names:
                raise DomainValidationError(
                    f"Duplicate column name detected: '{c.name}'",
                    code="DUPLICATE_COLUMN_NAME",
                    details={"column": c.name},
                )
            seen_names.add(lowered)
        return cols


# --- Dataset and Version Entities ---


class Dataset(BaseModel):
    """Logical dataset definition."""

    model_config = ConfigDict(frozen=True)

    dataset_id: UUID = Field(default_factory=uuid4)
    workspace_id: UUID
    name: str = Field(..., min_length=1)
    created_at: datetime = Field(default_factory=utc_now)


class DatasetVersion(BaseModel):
    """Immutable version of a dataset asset."""

    model_config = ConfigDict(frozen=True)

    version_id: UUID = Field(default_factory=uuid4)
    dataset_id: UUID
    version_number: int = Field(..., ge=1)
    storage_path: Path
    raw_source_path: Path | None = None
    content_hash: str
    multiset_hash: str
    row_count: int = Field(..., ge=0)
    byte_size: int = Field(..., ge=0)
    schema_id: UUID
    primary_key_columns: list[str] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=utc_now)


# --- Pipeline DAG Definitions ---


class PipelineInputBinding(BaseModel):
    """Binding specification for an external dataset input."""

    model_config = ConfigDict(frozen=True)

    input_id: str = Field(..., min_length=1)
    dataset_id: UUID
    required: bool = True


class PipelineOutputBinding(BaseModel):
    """Binding specification for an output target sink."""

    model_config = ConfigDict(frozen=True)

    output_id: str = Field(..., min_length=1)
    step_id: str = Field(..., min_length=1)
    target_name: str = Field(..., min_length=1)


class TransformationStep(BaseModel):
    """A single atomic node in the DAG execution graph."""

    model_config = ConfigDict(frozen=True)

    step_id: str = Field(..., min_length=1)
    operation_type: OperationType
    input_step_ids: list[str] = Field(default_factory=list)
    parameters: dict[str, Any] = Field(default_factory=dict)
    description: str | None = None

    @field_validator("step_id")
    @classmethod
    def validate_step_id(cls, v: str) -> str:
        trimmed = v.strip()
        if not trimmed:
            raise DomainValidationError("step_id cannot be blank", code="EMPTY_STEP_ID")
        return trimmed


class PipelineVersion(BaseModel):
    """Pinned, immutable version of a pipeline graph definition."""

    model_config = ConfigDict(frozen=True)

    pipeline_version_id: UUID = Field(default_factory=uuid4)
    pipeline_id: UUID
    version_number: int = Field(..., ge=1)
    definition_hash: str
    steps: list[TransformationStep]
    inputs: list[PipelineInputBinding] = Field(default_factory=list)
    outputs: list[PipelineOutputBinding] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=utc_now)


class PipelineDefinition(BaseModel):
    """Logical pipeline identity."""

    model_config = ConfigDict(frozen=True)

    pipeline_id: UUID = Field(default_factory=uuid4)
    workspace_id: UUID
    name: str = Field(..., min_length=1)
    created_at: datetime = Field(default_factory=utc_now)


# --- Execution Entities and Telemetry ---


class Artifact(BaseModel):
    """Physical materialized tabular artifact."""

    model_config = ConfigDict(frozen=True)

    artifact_id: UUID = Field(default_factory=uuid4)
    storage_path: Path
    row_count: int = Field(..., ge=0)
    byte_size: int = Field(..., ge=0)
    schema_id: UUID
    content_hash: str
    multiset_hash: str
    is_verified: bool = False


class StepExecution(BaseModel):
    """Runtime telemetry and output artifact for a single step."""

    model_config = ConfigDict(frozen=True)

    execution_id: UUID = Field(default_factory=uuid4)
    run_id: UUID
    step_id: str
    status: StepStatus
    started_at: datetime
    completed_at: datetime | None = None
    duration_ms: int | None = Field(default=None, ge=0)
    output_artifact_id: UUID | None = None
    error_message: str | None = None


class PipelineRun(BaseModel):
    """Concrete execution of a pinned pipeline version."""

    model_config = ConfigDict(frozen=True)

    run_id: UUID = Field(default_factory=uuid4)
    pipeline_version_id: UUID
    run_type: RunType
    lifecycle_status: RunLifecycle = RunLifecycle.PENDING
    input_bindings: dict[str, UUID] = Field(default_factory=dict)
    started_at: datetime | None = None
    completed_at: datetime | None = None
    last_heartbeat_at: datetime | None = None
    duration_ms: int | None = Field(default=None, ge=0)
    peak_memory_bytes: int | None = Field(default=None, ge=0)
    error_summary: str | None = None
    replay_manifest_id: UUID | None = None
