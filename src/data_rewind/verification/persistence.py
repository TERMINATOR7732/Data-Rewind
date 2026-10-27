"""Data Rewind Fix Verification SQLite persistence repository.

Conforms to SPEC-MOD-07 (System Architecture & Local Persistence).
Local-first, zero recurring cost, survives application restarts.
Enforces SQLite WAL journal mode and busy timeout.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime
from pathlib import Path
from uuid import UUID

from data_rewind.verification.models import (
    ForensicDossier,
    TriRunVerification,
    VerificationSummary,
    VerificationVerdict,
)


class VerificationRepository:
    """Manages local-first SQLite persistence for fix verifications and dossiers."""

    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path.resolve()
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        """Open a SQLite connection configured with WAL journal mode and busy timeout."""
        conn = sqlite3.connect(str(self.db_path))
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA busy_timeout=5000;")
        return conn

    def _init_db(self) -> None:
        """Create verifications and dossiers tables if they do not exist."""
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS verifications (
                    verification_id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    verdict TEXT NOT NULL,
                    baseline_run_id TEXT,
                    faulted_run_id TEXT NOT NULL,
                    candidate_run_id TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    duration_ms REAL NOT NULL,
                    data_json TEXT NOT NULL
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS dossiers (
                    dossier_id TEXT PRIMARY KEY,
                    verification_id TEXT NOT NULL,
                    pipeline_name TEXT NOT NULL,
                    pipeline_version_hash TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    data_json TEXT NOT NULL,
                    FOREIGN KEY (verification_id) REFERENCES verifications(verification_id)
                )
                """
            )
            conn.commit()

    def save_verification(self, verification: TriRunVerification) -> None:
        """Save or update a TriRunVerification record atomically."""
        data_json = verification.model_dump_json()

        with self._connect() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO verifications (
                    verification_id,
                    title,
                    verdict,
                    baseline_run_id,
                    faulted_run_id,
                    candidate_run_id,
                    created_at,
                    duration_ms,
                    data_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    str(verification.verification_id),
                    verification.title,
                    verification.verdict.value,
                    str(verification.baseline_run_id) if verification.baseline_run_id else None,
                    str(verification.faulted_run_id),
                    str(verification.candidate_run_id),
                    verification.created_at.isoformat(),
                    float(verification.duration_ms),
                    data_json,
                ),
            )
            conn.commit()

    def get_verification(self, verification_id: UUID) -> TriRunVerification | None:
        """Retrieve a TriRunVerification by its UUID."""
        with self._connect() as conn:
            cursor = conn.execute(
                "SELECT data_json FROM verifications WHERE verification_id = ?",
                (str(verification_id),),
            )
            row = cursor.fetchone()
            if not row:
                return None
            data = json.loads(row[0])
            return TriRunVerification.model_validate(data)

    def list_verifications(self) -> list[VerificationSummary]:
        """List all verifications ordered by creation timestamp descending."""
        with self._connect() as conn:
            cursor = conn.execute(
                """
                SELECT
                    verification_id,
                    title,
                    verdict,
                    baseline_run_id,
                    faulted_run_id,
                    candidate_run_id,
                    created_at
                FROM verifications
                ORDER BY created_at DESC
                """
            )
            rows = cursor.fetchall()
            summaries: list[VerificationSummary] = []
            for r in rows:
                summaries.append(
                    VerificationSummary(
                        verification_id=UUID(r[0]),
                        title=r[1],
                        verdict=VerificationVerdict(r[2]),
                        baseline_run_id=UUID(r[3]) if r[3] else None,
                        faulted_run_id=UUID(r[4]),
                        candidate_run_id=UUID(r[5]),
                        created_at=datetime.fromisoformat(r[6]),
                    )
                )
            return summaries

    def delete_verification(self, verification_id: UUID) -> bool:
        """Delete a verification and any associated dossier."""
        with self._connect() as conn:
            conn.execute(
                "DELETE FROM dossiers WHERE verification_id = ?",
                (str(verification_id),),
            )
            cursor = conn.execute(
                "DELETE FROM verifications WHERE verification_id = ?",
                (str(verification_id),),
            )
            conn.commit()
            return cursor.rowcount > 0

    def save_dossier(self, dossier: ForensicDossier) -> None:
        """Save or update a ForensicDossier record atomically."""
        # Also ensure underlying verification is saved
        self.save_verification(dossier.verification)

        data_json = dossier.model_dump_json()
        with self._connect() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO dossiers (
                    dossier_id,
                    verification_id,
                    pipeline_name,
                    pipeline_version_hash,
                    created_at,
                    data_json
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    str(dossier.metadata.dossier_id),
                    str(dossier.verification.verification_id),
                    dossier.metadata.pipeline_name,
                    dossier.metadata.pipeline_version_hash,
                    dossier.metadata.created_at.isoformat(),
                    data_json,
                ),
            )
            conn.commit()

    def get_dossier(self, dossier_id: UUID) -> ForensicDossier | None:
        """Retrieve a ForensicDossier by its UUID."""
        with self._connect() as conn:
            cursor = conn.execute(
                "SELECT data_json FROM dossiers WHERE dossier_id = ?",
                (str(dossier_id),),
            )
            row = cursor.fetchone()
            if not row:
                return None
            data = json.loads(row[0])
            return ForensicDossier.model_validate(data)

    def get_dossier_by_verification(self, verification_id: UUID) -> ForensicDossier | None:
        """Retrieve a ForensicDossier by its associated verification UUID."""
        with self._connect() as conn:
            cursor = conn.execute(
                "SELECT data_json FROM dossiers WHERE verification_id = ?",
                (str(verification_id),),
            )
            row = cursor.fetchone()
            if not row:
                return None
            data = json.loads(row[0])
            return ForensicDossier.model_validate(data)
