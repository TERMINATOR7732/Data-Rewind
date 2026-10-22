"""Data Rewind centralized configuration and operational resource limits.

Conforms strictly to Section 1 of SPEC-MOD-09 (8-Column Resource Limit Matrix).
Enforces:
- Separation between decimal units (MB = 10^6 bytes) and binary units (MiB = 2^20 bytes).
- Distinct operating profiles: Local-First (Primary) vs Hosted Demo.
"""

from __future__ import annotations

import os
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field


class ResourceLimits(BaseModel):
    """Operational resource limits conforming to SPEC-MOD-09."""

    model_config = ConfigDict(frozen=True)

    # Ingestion boundaries (Decimal units: 1 MB = 1,000,000 bytes)
    max_raw_csv_bytes: int = 50_000_000  # 50 MB (Local)
    max_dataset_rows: int = 500_000  # 500k rows
    max_column_count: int = 100  # 100 columns
    max_cell_length_chars: int = 4_096  # 4k characters
    max_line_length_bytes: int = 65_536  # 64 KB

    # Execution memory boundaries (Binary units: 1 MiB = 1,048,576 bytes)
    max_process_rss_mib: int = 512  # 512 MiB process RSS cap
    duckdb_max_memory_mib: int = 256  # 256 MiB query working memory

    # Target performance metrics (Provisional benchmarks, not hard guarantees)
    provisional_diff_memory_mib: int = 120
    provisional_diff_time_seconds: float = 1.5

    # Execution timeouts (Wall-clock seconds)
    step_timeout_seconds: int = 120  # 120 seconds per DAG step
    expression_batch_timeout_seconds: float = 1.0  # 1.0 second per 10k rows

    # AST structural limits
    max_ast_depth: int = 10
    max_ast_nodes: int = 50
    max_expression_length: int = 1_000

    # Storage and admission gate
    min_disk_free_mb: int = 100  # > 100 MB free storage check


class Settings(BaseModel):
    """Application-wide configuration settings."""

    model_config = ConfigDict(frozen=True)

    app_name: str = "Data Rewind"
    version: str = "0.1.0"
    profile: str = Field(default="local")  # "local" or "hosted_demo"
    base_data_dir: Path = Field(
        default_factory=lambda: Path(os.path.expanduser("~")) / ".data_rewind"
    )
    limits: ResourceLimits = Field(default_factory=ResourceLimits)

    @classmethod
    def load(cls) -> Settings:
        """Load settings from environment variables with safe defaults."""
        profile = os.getenv("DATA_REWIND_PROFILE", "local").lower()
        custom_data_dir = os.getenv("DATA_REWIND_DATA_DIR")
        data_dir = (
            Path(custom_data_dir).resolve()
            if custom_data_dir
            else Path(os.path.expanduser("~")) / ".data_rewind"
        )

        if profile == "hosted_demo":
            hosted_limits = ResourceLimits(
                max_raw_csv_bytes=10_000_000,  # 10 MB in hosted
                max_dataset_rows=50_000,  # 50k rows in hosted
                max_column_count=50,  # 50 columns
                step_timeout_seconds=30,  # 30 seconds
                duckdb_max_memory_mib=128,
            )
            return cls(profile=profile, base_data_dir=data_dir, limits=hosted_limits)

        return cls(profile="local", base_data_dir=data_dir, limits=ResourceLimits())
