"""Data Rewind Pipeline Execution models and telemetry types.

Conforms to Section 1 of SPEC-MOD-03.
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from data_rewind.core.domain.models import RunLifecycle, StepStatus


class StepExecutionResult(BaseModel):
    """Result and integrity metadata of an individual DAG transformation step."""

    model_config = ConfigDict(frozen=True)

    step_id: str
    status: StepStatus
    parquet_path: Path | None = None
    content_hash: str | None = None
    multiset_hash: str | None = None
    row_count: int = 0
    byte_size: int = 0
    duration_ms: float = 0.0
    error_message: str | None = None


class PipelineExecutionResult(BaseModel):
    """Overall execution result for a pipeline execution run."""

    model_config = ConfigDict(frozen=True)

    run_id: UUID
    pipeline_id: UUID | None = None
    status: RunLifecycle
    step_results: dict[str, StepExecutionResult] = Field(default_factory=dict)
    topological_order: list[str] = Field(default_factory=list)
    failed_step_id: str | None = None
    error_message: str | None = None
    total_duration_ms: float = 0.0


class ExecutionOptions(BaseModel):
    """Runtime options configuring pipeline execution."""

    model_config = ConfigDict(frozen=True)

    workspace_root: Path
    fail_fast: bool = True
    max_memory_mb: int = 256
    export_intermediate_checkpoints: bool = True
    frozen_timestamp: datetime | None = None
