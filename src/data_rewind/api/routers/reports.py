"""Forensic Report & Dossier Export Studio endpoints.

Conforms to SPEC-MOD-05 §2 (Type-Aware Formula-Injection Protection) and SPEC-MOD-07 §3.1.
Supports 4 export formats:
- json: Machine-readable structured evidence
- markdown: Human-readable professional engineering dossier
- safe_csv: Spreadsheet-Safe CSV with type-aware escaping
- raw_csv: Raw bit-for-bit CSV
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Response

from data_rewind.api.dependencies import APIDependencies
from data_rewind.verification.reports import (
    CSVDossierExporter,
    JSONDossierExporter,
    MarkdownDossierExporter,
)

router = APIRouter(prefix="/reports", tags=["Forensic Report Export"])


@router.get("/{dossier_id}/export")
def export_report(
    dossier_id: str,
    format: str = Query(
        default="markdown",
        description="Export format: 'json' | 'markdown' | 'safe_csv' | 'raw_csv'",
    ),
    step_id: str | None = Query(
        default=None,
        description="Target step ID for CSV diff export (defaults to primary divergent/affected step)",
    ),
) -> Response:
    """Export forensic investigation dossier in requested format."""
    repo = APIDependencies.get_verification_repository()
    try:
        d_uuid = UUID(dossier_id)
    except ValueError as exc:
        raise HTTPException(
            status_code=400, detail=f"Invalid dossier UUID: '{dossier_id}'"
        ) from exc

    dossier = repo.get_dossier(d_uuid)
    if not dossier:
        dossier = repo.get_dossier_by_verification(d_uuid)
        if not dossier:
            raise HTTPException(status_code=404, detail=f"Dossier '{dossier_id}' not found.")

    fmt = format.lower().strip()
    dossier_short_id = str(dossier.metadata.dossier_id)[:8]

    if fmt == "json":
        content = JSONDossierExporter.export(dossier)
        filename = f"forensic_dossier_{dossier_short_id}.json"
        return Response(
            content=content,
            media_type="application/json",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    elif fmt in ("markdown", "md"):
        content = MarkdownDossierExporter.export(dossier)
        filename = f"forensic_dossier_{dossier_short_id}.md"
        return Response(
            content=content,
            media_type="text/markdown",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    elif fmt in ("safe_csv", "raw_csv", "csv"):
        mode = "raw" if fmt == "raw_csv" else "safe"
        step_comparisons = (
            dossier.verification.dual_axis.baseline_axis.step_comparisons
            if dossier.verification.dual_axis.baseline_axis
            else {}
        )

        # If step_id provided, export step diff; else export verification summary CSV
        if step_id and step_id in step_comparisons:
            diff_res = step_comparisons[step_id]
            content, _ = CSVDossierExporter.export_step_diff(diff_res, export_mode=mode)
            filename = f"step_diff_{step_id}_{mode}.csv"
        elif step_comparisons:
            first_step = next(iter(step_comparisons.keys()))
            diff_res = step_comparisons[first_step]
            content, _ = CSVDossierExporter.export_step_diff(diff_res, export_mode=mode)
            filename = f"step_diff_{first_step}_{mode}.csv"
        else:
            content, _ = CSVDossierExporter.export_verification_summary(
                dossier.verification, export_mode=mode
            )
            filename = f"verification_summary_{mode}.csv"

        return Response(
            content=content,
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    else:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported export format: '{format}'. Supported: json, markdown, safe_csv, raw_csv.",
        )
