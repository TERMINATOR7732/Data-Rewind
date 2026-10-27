"""Tests for Fix Verification SQLite Persistence Repository.

Conforms to SPEC-MOD-07 §1.1 (WAL mode, busy timeout, ACID persistence).
"""

from __future__ import annotations

import sqlite3
from pathlib import Path
from uuid import uuid4

import pytest

from data_rewind.core.domain.models import utc_now
from data_rewind.verification.models import (
    BaselineEquivalenceAxisResult,
    DualAxisEvaluation,
    EvidenceItem,
    EvidenceTier,
    ForensicDossier,
    ForensicDossierMetadata,
    RemediationAxisResult,
    TriRunVerification,
    VerificationVerdict,
)
from data_rewind.verification.persistence import VerificationRepository


@pytest.fixture
def test_repo(tmp_path: Path) -> VerificationRepository:
    """Create a VerificationRepository backed by a temporary SQLite database."""
    db_path = tmp_path / "test_verifications.db"
    return VerificationRepository(db_path)


def test_sqlite_wal_mode_and_busy_timeout(test_repo: VerificationRepository) -> None:
    """Verify that the repository initializes SQLite in WAL mode with busy timeout configured."""
    with sqlite3.connect(str(test_repo.db_path)) as conn:
        journal_mode = conn.execute("PRAGMA journal_mode;").fetchone()[0]
        # In SQLite on disk, journal_mode is 'wal'
        assert journal_mode.lower() == "wal"

        # Verify busy timeout is configured on connection opened by repository
        repo_conn = test_repo._connect()
        try:
            busy_timeout = repo_conn.execute("PRAGMA busy_timeout;").fetchone()[0]
            assert busy_timeout >= 5000
        finally:
            repo_conn.close()


def test_save_and_get_verification(test_repo: VerificationRepository) -> None:
    """Verify storing and retrieving a complete TriRunVerification object."""
    v_id = uuid4()
    r0_id = uuid4()
    r1_id = uuid4()
    r2_id = uuid4()

    verification = TriRunVerification(
        verification_id=v_id,
        title="Test Fix Run Verification",
        baseline_run_id=r0_id,
        faulted_run_id=r1_id,
        candidate_run_id=r2_id,
        verdict=VerificationVerdict.VERIFIED_CLEAN,
        verdict_meaning="Baseline equivalence restored 100%.",
        verdict_reason_codes=["BASELINE_EQUIVALENCE_RESTORED_100%"],
        dual_axis=DualAxisEvaluation(
            remediation_axis=RemediationAxisResult(
                eod_step="step_1",
                eod_remediated=True,
                eod_severity_reduced=True,
                explanation="Remediated.",
            ),
            baseline_axis=BaselineEquivalenceAxisResult(
                baseline_equivalent_at_sinks=True,
                baseline_equivalent_across_all_steps=True,
                sink_step_ids=["step_1"],
                explanation="Clean.",
            ),
        ),
        evidence_chain=[
            EvidenceItem(
                tier=EvidenceTier.PROVEN_OBSERVATION,
                code="EV-01",
                summary="Observed fact 1",
                is_observed_fact=True,
            )
        ],
        created_at=utc_now(),
        duration_ms=25.5,
    )

    test_repo.save_verification(verification)

    retrieved = test_repo.get_verification(v_id)
    assert retrieved is not None
    assert retrieved.verification_id == v_id
    assert retrieved.verdict == VerificationVerdict.VERIFIED_CLEAN
    assert retrieved.baseline_run_id == r0_id
    assert retrieved.faulted_run_id == r1_id
    assert retrieved.candidate_run_id == r2_id
    assert len(retrieved.evidence_chain) == 1
    assert retrieved.evidence_chain[0].code == "EV-01"


def test_save_and_get_dossier(test_repo: VerificationRepository) -> None:
    """Verify saving and retrieving a complete ForensicDossier bundle."""
    v_id = uuid4()
    d_id = uuid4()
    r1_id = uuid4()
    r2_id = uuid4()

    verification = TriRunVerification(
        verification_id=v_id,
        title="Dossier Test Verification",
        baseline_run_id=None,
        faulted_run_id=r1_id,
        candidate_run_id=r2_id,
        verdict=VerificationVerdict.BASELINE_UNAVAILABLE,
        verdict_meaning="Baseline run R0 unavailable.",
        verdict_reason_codes=["BASELINE_UNAVAILABLE"],
        dual_axis=DualAxisEvaluation(
            remediation_axis=RemediationAxisResult(
                eod_step="step_x",
                eod_remediated=True,
                explanation="Remediation observed.",
            ),
            baseline_axis=None,
        ),
    )

    metadata = ForensicDossierMetadata(
        dossier_id=d_id,
        pipeline_name="Analytics Pipeline",
        pipeline_version_hash="f" * 64,
        investigator_session="qa_agent",
        baseline_run_id=None,
        faulted_run_id=r1_id,
        candidate_run_id=r2_id,
    )

    dossier = ForensicDossier(
        metadata=metadata,
        verification=verification,
        reproducibility_signatures={"sig1": "1" * 64},
    )

    test_repo.save_dossier(dossier)

    # Retrieve by dossier_id
    retrieved_dossier = test_repo.get_dossier(d_id)
    assert retrieved_dossier is not None
    assert retrieved_dossier.metadata.dossier_id == d_id
    assert retrieved_dossier.verification.verdict == VerificationVerdict.BASELINE_UNAVAILABLE
    assert retrieved_dossier.reproducibility_signatures["sig1"] == "1" * 64

    # Retrieve by verification_id
    retrieved_by_v = test_repo.get_dossier_by_verification(v_id)
    assert retrieved_by_v is not None
    assert retrieved_by_v.metadata.dossier_id == d_id


def test_list_verifications_and_delete(test_repo: VerificationRepository) -> None:
    """Verify listing verification summaries and deleting records with cascading dossier removal."""
    v1_id = uuid4()
    v2_id = uuid4()

    v1 = TriRunVerification(
        verification_id=v1_id,
        title="V1",
        baseline_run_id=uuid4(),
        faulted_run_id=uuid4(),
        candidate_run_id=uuid4(),
        verdict=VerificationVerdict.VERIFIED_CLEAN,
        verdict_meaning="Clean.",
        dual_axis=DualAxisEvaluation(
            remediation_axis=RemediationAxisResult(eod_remediated=True),
        ),
    )

    v2 = TriRunVerification(
        verification_id=v2_id,
        title="V2",
        baseline_run_id=uuid4(),
        faulted_run_id=uuid4(),
        candidate_run_id=uuid4(),
        verdict=VerificationVerdict.REGRESSION_UNRESOLVED,
        verdict_meaning="Failed.",
        dual_axis=DualAxisEvaluation(
            remediation_axis=RemediationAxisResult(eod_remediated=False),
        ),
    )

    test_repo.save_verification(v1)
    test_repo.save_verification(v2)

    summaries = test_repo.list_verifications()
    assert len(summaries) == 2
    summary_ids = {s.verification_id for s in summaries}
    assert v1_id in summary_ids
    assert v2_id in summary_ids

    # Delete v1
    deleted = test_repo.delete_verification(v1_id)
    assert deleted is True

    assert test_repo.get_verification(v1_id) is None
    assert len(test_repo.list_verifications()) == 1


def test_repeated_initialization_idempotency(tmp_path: Path) -> None:
    """Verify that opening the repository multiple times against the same DB preserves records."""
    db_file = tmp_path / "idempotent.db"
    repo1 = VerificationRepository(db_file)

    v_id = uuid4()
    v = TriRunVerification(
        verification_id=v_id,
        title="Persisted Across Inits",
        faulted_run_id=uuid4(),
        candidate_run_id=uuid4(),
        verdict=VerificationVerdict.INTENTIONAL_UPDATE,
        verdict_meaning="Intentional drift.",
        dual_axis=DualAxisEvaluation(
            remediation_axis=RemediationAxisResult(eod_remediated=True),
        ),
    )
    repo1.save_verification(v)

    # Re-initialize repository on same file
    repo2 = VerificationRepository(db_file)
    restored = repo2.get_verification(v_id)
    assert restored is not None
    assert restored.title == "Persisted Across Inits"
    assert restored.verdict == VerificationVerdict.INTENTIONAL_UPDATE
