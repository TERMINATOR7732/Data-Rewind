"""Tri-Run Fix Verification endpoints.

Conforms to SPEC-MOD-05 and SPEC-MOD-07 §3.1.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter, HTTPException

from data_rewind.api.dependencies import APIDependencies
from data_rewind.verification.models import (
    VerificationSummary,
)

router = APIRouter(prefix="/verifications", tags=["Fix Verification"])


@router.get("", response_model=list[VerificationSummary])
def list_verifications() -> list[VerificationSummary]:
    """List all persisted fix verification outcomes."""
    repo = APIDependencies.get_verification_repository()
    return repo.list_verifications()


@router.get("/{verification_id}")
def get_verification(verification_id: str) -> dict[str, Any]:
    """Retrieve full Tri-Run Fix Verification record by UUID."""
    repo = APIDependencies.get_verification_repository()
    try:
        v_uuid = UUID(verification_id)
    except ValueError as exc:
        raise HTTPException(
            status_code=400, detail=f"Invalid verification UUID: '{verification_id}'"
        ) from exc

    verif = repo.get_verification(v_uuid)
    if not verif:
        raise HTTPException(status_code=404, detail=f"Verification '{verification_id}' not found.")
    return verif.model_dump()


@router.get("/dossiers/{dossier_id}")
def get_dossier(dossier_id: str) -> dict[str, Any]:
    """Retrieve full Forensic Investigation Dossier by UUID."""
    repo = APIDependencies.get_verification_repository()
    try:
        d_uuid = UUID(dossier_id)
    except ValueError as exc:
        raise HTTPException(
            status_code=400, detail=f"Invalid dossier UUID: '{dossier_id}'"
        ) from exc

    dossier = repo.get_dossier(d_uuid)
    if not dossier:
        # Also try lookup by verification_id
        dossier = repo.get_dossier_by_verification(d_uuid)
        if not dossier:
            raise HTTPException(status_code=404, detail=f"Dossier '{dossier_id}' not found.")
    return dossier.model_dump()
