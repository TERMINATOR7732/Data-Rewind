"""Data Rewind benchmark protocol domain models and telemetry structures.

Conforms strictly to Section 2 of SPEC-MOD-09 and Section 3 of SPEC-MOD-04.
"""

from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class ComparisonMode(str, Enum):
    """Execution mode for tabular comparison."""

    KEYED_PK = "KEYED_PK"
    COMPOSITE_KEY = "COMPOSITE_KEY"
    KEYLESS_MULTISET = "KEYLESS_MULTISET"


class WarmthMode(str, Enum):
    """Cache warmth condition for benchmark execution."""

    COLD = "COLD"
    WARM = "WARM"


class BenchmarkScenarioConfig(BaseModel):
    """Specification of a single benchmark experiment condition."""

    model_config = ConfigDict(frozen=True)

    name: str
    row_count: int = Field(gt=0)
    col_count: int = Field(default=10, ge=1, le=100)
    comparison_mode: ComparisonMode = ComparisonMode.KEYED_PK
    null_density: float = Field(default=0.0, ge=0.0, le=1.0)
    perturbation_pct: float = Field(default=0.01, ge=0.0, le=1.0)
    duplicate_key_pct: float = Field(default=0.0, ge=0.0, le=1.0)
    reorder_rows: bool = False
    iterations: int = Field(default=5, ge=1)
    seed: int = 42


class BenchmarkIterationResult(BaseModel):
    """Metrics recorded from a single execution iteration of a benchmark scenario."""

    model_config = ConfigDict(frozen=True)

    iteration_index: int
    elapsed_ms: float
    elapsed_ns: int
    baseline_rss_mib: float
    peak_rss_mib: float
    delta_rss_mib: float
    partition_completeness_valid: bool
    identical_count: int
    modified_count: int
    added_count: int
    removed_count: int
    warmth: WarmthMode


class BenchmarkScenarioReport(BaseModel):
    """Aggregated statistical report for a benchmark scenario across multiple iterations."""

    model_config = ConfigDict(frozen=True)

    scenario_name: str
    row_count: int
    col_count: int
    comparison_mode: ComparisonMode
    iteration_count: int
    warmth: WarmthMode

    # Timing statistics (milliseconds)
    min_ms: float
    p50_ms: float
    p95_ms: float
    max_ms: float
    mean_ms: float
    stddev_ms: float

    # Memory statistics (MiB)
    min_delta_rss_mib: float
    peak_delta_rss_mib: float
    mean_delta_rss_mib: float

    # Correctness and targets
    all_partitions_valid: bool
    target_time_met: bool  # < 1500 ms for 500k rows
    target_ram_met: bool  # < 120 MiB for 500k rows
    provisional_targets_applicable: bool

    # Raw iterations
    iterations: list[BenchmarkIterationResult] = Field(default_factory=list)


class SystemEnvironmentInfo(BaseModel):
    """Hardware, OS, and runtime environment specifications."""

    model_config = ConfigDict(frozen=True)

    os_platform: str
    os_release: str
    cpu_count_logical: int
    cpu_count_physical: int | None
    total_ram_bytes: int
    total_ram_mib: float
    python_version: str
    duckdb_version: str


class BenchmarkSuiteReport(BaseModel):
    """Comprehensive dossier capturing environment baseline and all scenario reports."""

    model_config = ConfigDict(frozen=True)

    suite_name: str
    generated_at_utc: str
    system_info: SystemEnvironmentInfo
    scenario_reports: list[BenchmarkScenarioReport]
    all_targets_met: bool
    summary: dict[str, Any] = Field(default_factory=dict)
