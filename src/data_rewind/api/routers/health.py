"""Health, configuration, and system diagnostic endpoints.

Conforms to SPEC-MOD-07 §3.1 and SPEC-MOD-09 §1.
"""

from __future__ import annotations

import os
import sys

import duckdb
import psutil
from fastapi import APIRouter

from data_rewind import __version__
from data_rewind.api.dependencies import APIDependencies
from data_rewind.api.schemas import HealthResponse
from data_rewind.core.config.guards import ResourceGuards

router = APIRouter(tags=["Health & System"])


@router.get("/health", response_model=HealthResponse)
def get_health() -> HealthResponse:
    """Return application health, version, resource limits, and system stats."""
    settings = APIDependencies.get_settings()
    ws_dir = APIDependencies.get_workspace_dir()

    # Calculate free disk space in MB
    try:
        free_bytes = os.statvfs(str(ws_dir)).f_bavail * os.statvfs(str(ws_dir)).f_frsize  # type: ignore[attr-defined]
        free_mb = free_bytes / 1_000_000
    except AttributeError:
        # Windows fallback
        import ctypes

        free_bytes_int = ctypes.c_ulonglong(0)
        ctypes.windll.kernel32.GetDiskFreeSpaceExW(
            str(ws_dir), None, None, ctypes.byref(free_bytes_int)
        )
        free_mb = free_bytes_int.value / 1_000_000

    # Calculate process RSS in MiB
    process = psutil.Process()
    rss_mib = process.memory_info().rss / (1024 * 1024)

    return HealthResponse(
        status="ok",
        app_name=settings.app_name,
        version=settings.version,
        profile=settings.profile,
        limits=settings.limits.model_dump(),
        free_disk_mb=round(free_mb, 2),
        rss_mib=round(rss_mib, 2),
    )


@router.get("/diagnostics")
def get_diagnostics() -> dict[str, object]:
    """Return deep diagnostic parameters matching CLI output."""
    settings = APIDependencies.get_settings()
    ws_dir = APIDependencies.get_workspace_dir()

    try:
        ResourceGuards.check_preflight_disk_space(ws_dir, settings.limits)
        disk_admission = True
    except Exception:
        disk_admission = False

    process = psutil.Process()
    return {
        "engine_version": __version__,
        "active_profile": settings.profile,
        "python_runtime": f"{sys.version.split()[0]} ({sys.platform})",
        "duckdb_version": duckdb.__version__,
        "workspace_root": str(ws_dir),
        "disk_admission_gate": disk_admission,
        "rss_memory_mib": round(process.memory_info().rss / (1024 * 1024), 2),
        "limits": settings.limits.model_dump(),
    }
