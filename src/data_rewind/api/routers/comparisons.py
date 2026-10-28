"""Forensic Comparison and Step Row Diff endpoints.

Conforms to SPEC-MOD-04 and SPEC-MOD-07 §3.1.
"""

from __future__ import annotations

import math
from typing import Any
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query

from data_rewind.api.dependencies import APIDependencies
from data_rewind.api.schemas import StepDiffPage
from data_rewind.investigation.models import InvestigationSummary

router = APIRouter(prefix="/comparisons", tags=["Comparisons & Investigations"])


@router.get("", response_model=list[InvestigationSummary])
def list_comparisons() -> list[InvestigationSummary]:
    """List all persisted forensic investigations."""
    repo = APIDependencies.get_investigation_repository()
    return repo.list()


@router.get("/{investigation_id}")
def get_comparison(investigation_id: str) -> dict[str, Any]:
    """Retrieve full forensic investigation by UUID."""
    repo = APIDependencies.get_investigation_repository()
    try:
        inv_uuid = UUID(investigation_id)
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid investigation UUID: '{investigation_id}'",
        ) from exc

    investigation = repo.get(inv_uuid)
    if not investigation:
        raise HTTPException(
            status_code=404,
            detail=f"Investigation '{investigation_id}' not found.",
        )
    return investigation.model_dump()


@router.get("/{investigation_id}/steps/{step_id}/diff", response_model=StepDiffPage)
def get_step_diff(
    investigation_id: str,
    step_id: str,
    status: str = Query(
        default="ALL",
        description="Filter by diff status: ALL | MODIFIED | ADDED | REMOVED | IDENTICAL",
    ),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=500),
) -> StepDiffPage:
    """Retrieve paginated row differences for a specific pipeline step in an investigation."""
    repo = APIDependencies.get_investigation_repository()
    try:
        inv_uuid = UUID(investigation_id)
    except ValueError as exc:
        raise HTTPException(
            status_code=400, detail=f"Invalid investigation UUID: '{investigation_id}'"
        ) from exc

    investigation = repo.get(inv_uuid)
    if not investigation:
        raise HTTPException(
            status_code=404, detail=f"Investigation '{investigation_id}' not found."
        )

    if step_id not in investigation.step_comparisons:
        raise HTTPException(
            status_code=404,
            detail=f"Step '{step_id}' not present in investigation comparisons.",
        )

    diff_result = investigation.step_comparisons[step_id]
    filter_norm = status.upper().strip()

    rows: list[dict[str, Any]] = []

    for r_diff in diff_result.sample_row_diffs:
        cat_str = r_diff.category.value
        if filter_norm != "ALL" and cat_str != filter_norm:
            continue

        row_data = r_diff.target_row or r_diff.baseline_row or {}
        rows.append(
            {
                "_diff_status": cat_str,
                "_key_values": r_diff.key_values,
                **row_data,
                "_field_diffs": [fd.model_dump() for fd in r_diff.field_diffs],
            }
        )

    total_count = len(rows)
    total_pages = max(1, math.ceil(total_count / page_size))
    start_idx = (page - 1) * page_size
    end_idx = start_idx + page_size
    page_rows = rows[start_idx:end_idx]

    schema_diff = diff_result.schema_diff
    columns = (
        list(schema_diff.common_columns)
        + list(schema_diff.added_columns)
        + list(schema_diff.removed_columns)
    )
    pks: list[str] = []
    if diff_result.sample_row_diffs and diff_result.sample_row_diffs[0].key_values:
        pks = list(diff_result.sample_row_diffs[0].key_values.keys())

    return StepDiffPage(
        step_id=step_id,
        filter_status=filter_norm,
        total_matching_rows=total_count,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
        columns=columns,
        primary_keys=pks,
        rows=page_rows,
    )
