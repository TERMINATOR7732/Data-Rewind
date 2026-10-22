"""Data Rewind resource-limit guard checks and admission gates.

Enforces boundaries defined in SPEC-MOD-09 without silently truncating data.
"""

from __future__ import annotations

import shutil
from pathlib import Path

import psutil

from data_rewind.core.config.settings import ResourceLimits
from data_rewind.core.domain.errors import (
    CellLengthLimitExceededError,
    ColumnCountLimitExceededError,
    FileSizeLimitExceededError,
    InsufficientDiskSpaceError,
    LineLengthLimitExceededError,
    ProcessMemoryExceededError,
    RowCountLimitExceededError,
)

MIB_IN_BYTES = 1024 * 1024
MB_IN_BYTES = 1_000_000


class ResourceGuards:
    """Methods to inspect and enforce runtime and ingestion boundaries."""

    @staticmethod
    def check_preflight_disk_space(
        path: Path,
        limits: ResourceLimits | None = None,
    ) -> None:
        """Verify available disk space meets the admission gate threshold (> 100 MB).

        Raises:
            InsufficientDiskSpaceError: If free disk space is below threshold.
        """
        lim = limits or ResourceLimits()
        min_required_bytes = lim.min_disk_free_mb * MB_IN_BYTES

        # Resolve existing ancestor directory if target does not yet exist
        check_target = path
        while not check_target.exists() and check_target.parent != check_target:
            check_target = check_target.parent

        try:
            free_bytes = shutil.disk_usage(check_target).free
        except OSError:
            # Fallback if disk usage query fails on specific platforms
            return

        if free_bytes < min_required_bytes:
            free_mb = free_bytes // MB_IN_BYTES
            raise InsufficientDiskSpaceError(
                f"Insufficient disk space on {check_target}: {free_mb} MB available, "
                f"minimum {lim.min_disk_free_mb} MB required",
                details={
                    "available_mb": free_mb,
                    "required_mb": lim.min_disk_free_mb,
                    "path": str(check_target),
                },
            )

    @staticmethod
    def check_process_memory(limits: ResourceLimits | None = None) -> None:
        """Inspect current process Resident Set Size (RSS) against memory ceiling (512 MiB).

        Raises:
            ProcessMemoryExceededError: If current RSS exceeds maximum.
        """
        lim = limits or ResourceLimits()
        max_rss_bytes = lim.max_process_rss_mib * MIB_IN_BYTES

        try:
            current_rss = psutil.Process().memory_info().rss
        except Exception:
            return

        if current_rss > max_rss_bytes:
            current_mib = current_rss // MIB_IN_BYTES
            raise ProcessMemoryExceededError(
                f"Backend process memory ceiling exceeded: current RSS {current_mib} MiB, "
                f"maximum limit {lim.max_process_rss_mib} MiB",
                details={
                    "current_rss_mib": current_mib,
                    "max_rss_mib": lim.max_process_rss_mib,
                },
            )

    @staticmethod
    def validate_file_size(
        size_bytes: int,
        limits: ResourceLimits | None = None,
    ) -> None:
        """Validate raw file payload size against hard limit (50 MB)."""
        lim = limits or ResourceLimits()
        if size_bytes > lim.max_raw_csv_bytes:
            size_mb = size_bytes / MB_IN_BYTES
            max_mb = lim.max_raw_csv_bytes / MB_IN_BYTES
            raise FileSizeLimitExceededError(
                f"Raw CSV file size ({size_mb:.2f} MB) exceeds maximum allowed limit ({max_mb:.0f} MB)",
                details={"size_bytes": size_bytes, "max_bytes": lim.max_raw_csv_bytes},
            )

    @staticmethod
    def validate_row_count(
        count: int,
        limits: ResourceLimits | None = None,
    ) -> None:
        """Validate row cardinality against hard limit (500,000 rows)."""
        lim = limits or ResourceLimits()
        if count > lim.max_dataset_rows:
            raise RowCountLimitExceededError(
                f"Dataset row count ({count}) exceeds maximum allowed limit ({lim.max_dataset_rows})",
                details={"row_count": count, "max_rows": lim.max_dataset_rows},
            )

    @staticmethod
    def validate_column_count(
        count: int,
        limits: ResourceLimits | None = None,
    ) -> None:
        """Validate column count against hard limit (100 columns)."""
        lim = limits or ResourceLimits()
        if count > lim.max_column_count:
            raise ColumnCountLimitExceededError(
                f"Dataset column count ({count}) exceeds maximum allowed limit ({lim.max_column_count})",
                details={"column_count": count, "max_columns": lim.max_column_count},
            )

    @staticmethod
    def validate_cell_length(
        cell: str,
        line_no: int = 1,
        col_idx: int = 1,
        limits: ResourceLimits | None = None,
    ) -> None:
        """Validate individual cell character length (4,096 chars)."""
        lim = limits or ResourceLimits()
        if len(cell) > lim.max_cell_length_chars:
            raise CellLengthLimitExceededError(
                f"Cell length ({len(cell)} chars) at line {line_no}, col {col_idx} "
                f"exceeds maximum allowed ({lim.max_cell_length_chars})",
                details={
                    "line": line_no,
                    "column": col_idx,
                    "length": len(cell),
                    "max_chars": lim.max_cell_length_chars,
                },
            )

    @staticmethod
    def validate_line_length(
        line_bytes: bytes,
        line_no: int = 1,
        limits: ResourceLimits | None = None,
    ) -> None:
        """Validate single line byte length (65,536 bytes)."""
        lim = limits or ResourceLimits()
        if len(line_bytes) > lim.max_line_length_bytes:
            raise LineLengthLimitExceededError(
                f"Line {line_no} byte length ({len(line_bytes)} bytes) exceeds limit ({lim.max_line_length_bytes})",
                details={
                    "line": line_no,
                    "length_bytes": len(line_bytes),
                    "max_bytes": lim.max_line_length_bytes,
                },
            )
