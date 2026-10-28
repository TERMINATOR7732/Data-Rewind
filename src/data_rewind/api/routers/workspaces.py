"""Workspace management and application-managed data purge endpoints.

Conforms to SPEC-MOD-06 §3, SPEC-MOD-07 §1.1, and SPEC-MOD-08 Screen 12.
"""

from __future__ import annotations

import contextlib
import os
import sqlite3
from typing import Any

from fastapi import APIRouter

from data_rewind.api.dependencies import APIDependencies
from data_rewind.api.schemas import WorkspacePurgeResponse

router = APIRouter(prefix="/workspaces", tags=["Workspaces & Retention"])


@router.get("")
def get_workspace_info() -> dict[str, Any]:
    """Retrieve workspace storage utilization and database stats."""
    ws_dir = APIDependencies.get_workspace_dir()

    total_bytes = 0
    file_count = 0
    for root, _, files in os.walk(str(ws_dir)):
        for f in files:
            file_count += 1
            with contextlib.suppress(OSError):
                total_bytes += os.path.getsize(os.path.join(root, f))

    investigations_db = ws_dir / "investigations.db"
    verifications_db = ws_dir / "verifications.db"

    return {
        "workspace_path": str(ws_dir),
        "total_storage_bytes": total_bytes,
        "total_storage_mb": round(total_bytes / 1_000_000, 2),
        "file_count": file_count,
        "investigations_db_bytes": (
            os.path.getsize(str(investigations_db)) if investigations_db.exists() else 0
        ),
        "verifications_db_bytes": (
            os.path.getsize(str(verifications_db)) if verifications_db.exists() else 0
        ),
    }


@router.delete("/purge", response_model=WorkspacePurgeResponse)
def purge_workspace_data() -> WorkspacePurgeResponse:
    """Application-managed deletion: unlinks raw inputs, checkpoints, and vacuums databases."""
    ws_dir = APIDependencies.get_workspace_dir()
    raw_dir = APIDependencies.get_raw_inputs_dir()

    purged_bytes = 0
    unlinked_count = 0

    # 1. Unlink raw inputs
    if raw_dir.exists():
        for f in raw_dir.glob("*"):
            try:
                sz = os.path.getsize(str(f))
                purged_bytes += sz
                # Make writable before unlink if chmod was read-only
                import stat

                os.chmod(f, stat.S_IWRITE)
                f.unlink(missing_ok=True)
                unlinked_count += 1
            except Exception:
                pass

    # 2. Unlink checkpoints and tmp files
    for sub in ("artifacts", "tmp", "checkpoints"):
        sub_dir = ws_dir / sub
        if sub_dir.exists():
            for f in sub_dir.glob("**/*"):
                if f.is_file():
                    try:
                        sz = os.path.getsize(str(f))
                        purged_bytes += sz
                        f.unlink(missing_ok=True)
                        unlinked_count += 1
                    except Exception:
                        pass

    # 3. Clean SQLite tables and VACUUM
    vacuum_ok = True
    for db_name in ("investigations.db", "verifications.db"):
        db_path = ws_dir / db_name
        if db_path.exists():
            try:
                with sqlite3.connect(str(db_path)) as conn:
                    # Clear tables
                    tables = conn.execute(
                        "SELECT name FROM sqlite_master WHERE type='table';"
                    ).fetchall()
                    for t in tables:
                        tname = t[0]
                        if not tname.startswith("sqlite_"):
                            conn.execute(f"DELETE FROM {tname};")
                    conn.commit()
                    conn.execute("VACUUM;")
            except Exception:
                vacuum_ok = False

    return WorkspacePurgeResponse(
        purged_bytes=purged_bytes,
        unlinked_files_count=unlinked_count,
        vacuum_completed=vacuum_ok,
        message="Workspace storage purged successfully. Forensic sanitization disclaimer applies (SPEC-MOD-06 §3).",
    )
