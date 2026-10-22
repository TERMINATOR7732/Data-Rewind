"""Data Rewind Investigation SQLite persistence repository.

Conforms to SPEC-MOD-07 (System Architecture & Local Persistence).
Local-first, zero recurring cost, survives restarts.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime
from pathlib import Path
from uuid import UUID

from data_rewind.diagnostics.models import EODStatus
from data_rewind.investigation.models import (
    Investigation,
    InvestigationStatus,
    InvestigationSummary,
)


class InvestigationRepository:
    """Manages local-first SQLite persistence for forensic investigations."""

    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path.resolve()
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _init_db(self) -> None:
        """Create investigations table schema if not exists."""
        with sqlite3.connect(str(self.db_path)) as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS investigations (
                    investigation_id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    baseline_run_id TEXT NOT NULL,
                    target_run_id TEXT NOT NULL,
                    status TEXT NOT NULL,
                    primary_eod_step TEXT,
                    eod_status TEXT NOT NULL,
                    blast_radius_ratio REAL NOT NULL,
                    created_at TEXT NOT NULL,
                    data_json TEXT NOT NULL
                )
                """
            )
            conn.commit()

    def save(self, investigation: Investigation) -> None:
        """Save or update an investigation record atomically."""
        data_json = investigation.model_dump_json()
        primary_eod = investigation.eod_result.primary_eod_step

        with sqlite3.connect(str(self.db_path)) as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO investigations (
                    investigation_id,
                    title,
                    baseline_run_id,
                    target_run_id,
                    status,
                    primary_eod_step,
                    eod_status,
                    blast_radius_ratio,
                    created_at,
                    data_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    str(investigation.investigation_id),
                    investigation.title,
                    str(investigation.baseline_run_id),
                    str(investigation.target_run_id),
                    investigation.status.value,
                    primary_eod,
                    investigation.eod_result.status.value,
                    float(investigation.blast_radius.blast_radius_ratio),
                    investigation.created_at.isoformat(),
                    data_json,
                ),
            )
            conn.commit()

    def get(self, investigation_id: UUID) -> Investigation | None:
        """Retrieve an investigation by UUID."""
        with sqlite3.connect(str(self.db_path)) as conn:
            cursor = conn.execute(
                "SELECT data_json FROM investigations WHERE investigation_id = ?",
                (str(investigation_id),),
            )
            row = cursor.fetchone()
            if not row:
                return None
            data = json.loads(row[0])
            return Investigation.model_validate(data)

    def list(self) -> list[InvestigationSummary]:
        """List all investigations ordered by creation timestamp descending."""
        with sqlite3.connect(str(self.db_path)) as conn:
            cursor = conn.execute(
                """
                SELECT
                    investigation_id,
                    title,
                    baseline_run_id,
                    target_run_id,
                    status,
                    primary_eod_step,
                    eod_status,
                    blast_radius_ratio,
                    created_at
                FROM investigations
                ORDER BY created_at DESC
                """
            )
            rows = cursor.fetchall()
            summaries: list[InvestigationSummary] = []
            for r in rows:
                summaries.append(
                    InvestigationSummary(
                        investigation_id=UUID(r[0]),
                        title=r[1],
                        baseline_run_id=UUID(r[2]),
                        target_run_id=UUID(r[3]),
                        status=InvestigationStatus(r[4]),
                        primary_eod_step=r[5],
                        eod_status=EODStatus(r[6]),
                        blast_radius_ratio=float(r[7]),
                        created_at=datetime.fromisoformat(r[8]),
                    )
                )
            return summaries

    def delete(self, investigation_id: UUID) -> bool:
        """Delete an investigation record."""
        with sqlite3.connect(str(self.db_path)) as conn:
            cursor = conn.execute(
                "DELETE FROM investigations WHERE investigation_id = ?",
                (str(investigation_id),),
            )
            conn.commit()
            return cursor.rowcount > 0
