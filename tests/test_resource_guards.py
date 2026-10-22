"""Tests for Data Rewind resource-limit enforcement and admission gates."""

from __future__ import annotations

import shutil
from pathlib import Path

import psutil
import pytest

from data_rewind.core.config.guards import ResourceGuards
from data_rewind.core.config.settings import ResourceLimits, Settings
from data_rewind.core.domain.errors import (
    CellLengthLimitExceededError,
    ColumnCountLimitExceededError,
    FileSizeLimitExceededError,
    InsufficientDiskSpaceError,
    LineLengthLimitExceededError,
    ProcessMemoryExceededError,
    RowCountLimitExceededError,
)


def test_file_size_limit_guard() -> None:
    """Test file size limit boundary enforcement."""
    limits = ResourceLimits(max_raw_csv_bytes=50_000_000)

    # Below limit (49 MB)
    ResourceGuards.validate_file_size(49_000_000, limits)

    # Exactly at limit (50 MB)
    ResourceGuards.validate_file_size(50_000_000, limits)

    # Exceeding limit (50 MB + 1 byte)
    with pytest.raises(FileSizeLimitExceededError) as exc_info:
        ResourceGuards.validate_file_size(50_000_001, limits)
    assert exc_info.value.code == "FILE_SIZE_LIMIT_EXCEEDED"


def test_row_count_limit_guard() -> None:
    """Test dataset row cardinality boundary enforcement."""
    limits = ResourceLimits(max_dataset_rows=500_000)

    ResourceGuards.validate_row_count(500_000, limits)

    with pytest.raises(RowCountLimitExceededError) as exc_info:
        ResourceGuards.validate_row_count(500_001, limits)
    assert exc_info.value.code == "ROW_COUNT_LIMIT_EXCEEDED"


def test_column_count_limit_guard() -> None:
    """Test header column count boundary enforcement."""
    limits = ResourceLimits(max_column_count=100)

    ResourceGuards.validate_column_count(100, limits)

    with pytest.raises(ColumnCountLimitExceededError) as exc_info:
        ResourceGuards.validate_column_count(101, limits)
    assert exc_info.value.code == "COLUMN_COUNT_LIMIT_EXCEEDED"


def test_cell_length_limit_guard() -> None:
    """Test individual cell length limit (4,096 characters)."""
    limits = ResourceLimits(max_cell_length_chars=4096)

    safe_cell = "a" * 4096
    ResourceGuards.validate_cell_length(safe_cell, line_no=10, col_idx=2, limits=limits)

    oversized_cell = "a" * 4097
    with pytest.raises(CellLengthLimitExceededError) as exc_info:
        ResourceGuards.validate_cell_length(oversized_cell, line_no=10, col_idx=2, limits=limits)
    assert exc_info.value.code == "CELL_LENGTH_LIMIT_EXCEEDED"
    assert exc_info.value.details["line"] == 10
    assert exc_info.value.details["column"] == 2


def test_line_length_limit_guard() -> None:
    """Test raw line byte length limit (65,536 bytes)."""
    limits = ResourceLimits(max_line_length_bytes=65536)

    safe_line = b"col1,col2\n"
    ResourceGuards.validate_line_length(safe_line, line_no=5, limits=limits)

    oversized_line = b"x" * 65537
    with pytest.raises(LineLengthLimitExceededError) as exc_info:
        ResourceGuards.validate_line_length(oversized_line, line_no=5, limits=limits)
    assert exc_info.value.code == "LINE_LENGTH_EXCEEDED"


def test_preflight_disk_space_guard(temp_workspace: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Test preflight disk space check blocks when free space < 100 MB."""

    # Normal mock: 10 GB free space
    class MockUsageSufficient:
        free = 10 * 1024 * 1024 * 1024

    monkeypatch.setattr(shutil, "disk_usage", lambda _: MockUsageSufficient())
    ResourceGuards.check_preflight_disk_space(temp_workspace)

    # Low disk mock: 50 MB free space
    class MockUsageLow:
        free = 50 * 1_000_000

    monkeypatch.setattr(shutil, "disk_usage", lambda _: MockUsageLow())
    with pytest.raises(InsufficientDiskSpaceError) as exc_info:
        ResourceGuards.check_preflight_disk_space(temp_workspace)
    assert exc_info.value.code == "INSUFFICIENT_DISK_SPACE_ERROR"


def test_process_memory_rss_guard(monkeypatch: pytest.MonkeyPatch) -> None:
    """Test process memory ceiling enforcement (512 MiB RSS)."""
    limits = ResourceLimits(max_process_rss_mib=512)

    # Safe memory mock: 200 MiB
    class MockMemSafe:
        rss = 200 * 1024 * 1024

    monkeypatch.setattr(psutil.Process, "memory_info", lambda _: MockMemSafe())
    ResourceGuards.check_process_memory(limits)

    # Exceeded memory mock: 600 MiB
    class MockMemHigh:
        rss = 600 * 1024 * 1024

    monkeypatch.setattr(psutil.Process, "memory_info", lambda _: MockMemHigh())
    with pytest.raises(ProcessMemoryExceededError) as exc_info:
        ResourceGuards.check_process_memory(limits)
    assert exc_info.value.code == "OUT_OF_MEMORY_SAFEGUARD"


def test_settings_profiles(monkeypatch: pytest.MonkeyPatch) -> None:
    """Test local vs hosted demo settings loading."""
    # Default local profile
    monkeypatch.delenv("DATA_REWIND_PROFILE", raising=False)
    s_local = Settings.load()
    assert s_local.profile == "local"
    assert s_local.limits.max_raw_csv_bytes == 50_000_000
    assert s_local.limits.max_dataset_rows == 500_000

    # Hosted demo profile
    monkeypatch.setenv("DATA_REWIND_PROFILE", "hosted_demo")
    s_hosted = Settings.load()
    assert s_hosted.profile == "hosted_demo"
    assert s_hosted.limits.max_raw_csv_bytes == 10_000_000
    assert s_hosted.limits.max_dataset_rows == 50_000
    assert s_hosted.limits.step_timeout_seconds == 30
