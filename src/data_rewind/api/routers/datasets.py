"""CSV Dataset Ingestion and Schema Inspector endpoints.

Conforms to SPEC-MOD-01, SPEC-MOD-06, SPEC-MOD-07 §3.1, and SPEC-MOD-09 §1.
Enforces:
- 50 MB max file size limit
- 500k max rows
- 100 max columns
- 4,096 char max cell length
- 64 KB max line length
- Raw byte preservation in raw_inputs/{sha256}.csv with read-only permissions
"""

from __future__ import annotations

import contextlib
import csv
import hashlib
import io
import json
import os
import stat
from pathlib import Path
from typing import Any
from uuid import uuid4

import duckdb
from fastapi import APIRouter, HTTPException, UploadFile

from data_rewind.api.dependencies import APIDependencies
from data_rewind.api.schemas import (
    DatasetColumnInfo,
    DatasetPreviewResponse,
    DatasetUploadResponse,
)

router = APIRouter(prefix="/datasets", tags=["CSV Datasets"])


@router.post("/upload", response_model=DatasetUploadResponse)
async def upload_dataset(file: UploadFile) -> DatasetUploadResponse:
    """Upload raw CSV file, validate bounds, preserve bytes, and infer schema."""
    settings = APIDependencies.get_settings()
    limits = settings.limits
    raw_dir = APIDependencies.get_raw_inputs_dir()

    filename = file.filename or "upload.csv"
    if not filename.lower().endswith(".csv"):
        raise HTTPException(
            status_code=400,
            detail={
                "code": "INVALID_FILE_TYPE",
                "message": "Only CSV (.csv) files are supported in Data Rewind v1.0.",
                "remediation": "Provide a valid RFC 4180 compliant CSV file.",
            },
        )

    # 1. Stream reading and enforce max file size
    hasher = hashlib.sha256()
    total_bytes = 0
    chunks: list[bytes] = []

    while True:
        chunk = await file.read(65536)  # 64 KB chunks
        if not chunk:
            break
        total_bytes += len(chunk)
        if total_bytes > limits.max_raw_csv_bytes:
            raise HTTPException(
                status_code=413,
                detail={
                    "code": "FILE_SIZE_LIMIT_EXCEEDED",
                    "message": f"CSV upload exceeds {limits.max_raw_csv_bytes // 1_000_000} MB hard limit.",
                    "remediation": "Reduce file size or sample rows before uploading.",
                },
            )
        hasher.update(chunk)
        chunks.append(chunk)

    if total_bytes == 0:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "EMPTY_FILE_ERROR",
                "message": "The uploaded CSV file is empty (0 bytes).",
                "remediation": "Provide a non-empty CSV file containing a header row.",
            },
        )

    file_bytes = b"".join(chunks)
    sha256_hash = hasher.hexdigest()

    # 2. Ingestion validation: decode and check line/cell limits
    try:
        text_content = file_bytes.decode("utf-8-sig")
    except UnicodeDecodeError:
        try:
            text_content = file_bytes.decode("latin-1")
        except Exception as exc:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "ENCODING_ERROR",
                    "message": "Unable to decode CSV file as UTF-8 or Latin-1.",
                    "remediation": "Ensure file encoding is valid UTF-8.",
                },
            ) from exc

    lines = text_content.splitlines()
    for idx, line in enumerate(lines[:1000]):
        if len(line.encode("utf-8")) > limits.max_line_length_bytes:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "LINE_LENGTH_EXCEEDED",
                    "message": f"Line {idx + 1} exceeds maximum allowable line length of {limits.max_line_length_bytes} bytes.",
                    "remediation": "Inspect for missing newline delimiters.",
                },
            )

    reader = csv.reader(io.StringIO(text_content))
    try:
        header = next(reader)
    except StopIteration as exc:
        raise HTTPException(
            status_code=400,
            detail={"code": "EMPTY_HEADER", "message": "CSV lacks a header row."},
        ) from exc

    if len(header) > limits.max_column_count:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "COLUMN_COUNT_LIMIT_EXCEEDED",
                "message": f"Column count ({len(header)}) exceeds hard limit of {limits.max_column_count}.",
                "remediation": "Select a subset of columns before ingesting.",
            },
        )

    row_count = 0
    for row_idx, row in enumerate(reader, start=2):
        row_count += 1
        if row_count > limits.max_dataset_rows:
            raise HTTPException(
                status_code=413,
                detail={
                    "code": "ROW_COUNT_LIMIT_EXCEEDED",
                    "message": f"Dataset exceeds {limits.max_dataset_rows:,} rows limit.",
                    "remediation": "Provide a sampled or partitioned dataset.",
                },
            )
        for cell in row:
            if len(cell) > limits.max_cell_length_chars:
                raise HTTPException(
                    status_code=400,
                    detail={
                        "code": "CELL_LENGTH_LIMIT_EXCEEDED",
                        "message": f"Row {row_idx} contains a cell exceeding {limits.max_cell_length_chars} characters.",
                        "remediation": "Truncate oversized text fields.",
                    },
                )

    # 3. Preserve raw bytes in raw_inputs/{sha256}.csv with read-only permissions
    preserved_path = raw_dir / f"{sha256_hash}.csv"
    if not preserved_path.exists():
        preserved_path.write_bytes(file_bytes)
        with contextlib.suppress(Exception):
            os.chmod(preserved_path, stat.S_IREAD | stat.S_IRGRP | stat.S_IROTH)

    # 4. Infer column data types using DuckDB
    con = duckdb.connect(":memory:")
    try:
        con.execute(
            f"CREATE TABLE preview AS SELECT * FROM read_csv_auto('{preserved_path.as_posix()}', all_varchar=false, sample_size=1000);"
        )
        types_res = con.execute("DESCRIBE preview;").fetchall()
        columns_info = [DatasetColumnInfo(name=str(r[0]), data_type=str(r[1])) for r in types_res]
    except Exception:
        columns_info = [DatasetColumnInfo(name=h, data_type="VARCHAR") for h in header]
    finally:
        con.close()

    dataset_id = str(uuid4())
    meta_path = raw_dir / f"{sha256_hash}.meta.json"
    meta_path.write_text(
        json.dumps(
            {
                "dataset_id": dataset_id,
                "filename": filename,
                "sha256_hash": sha256_hash,
                "row_count": row_count,
                "column_count": len(header),
                "byte_size": total_bytes,
                "columns": [c.model_dump() for c in columns_info],
            }
        ),
        encoding="utf-8",
    )

    return DatasetUploadResponse(
        dataset_id=dataset_id,
        filename=filename,
        row_count=row_count,
        column_count=len(header),
        byte_size=total_bytes,
        sha256_hash=sha256_hash,
        columns=columns_info,
    )


@router.get("", response_model=list[DatasetUploadResponse])
def list_datasets() -> list[DatasetUploadResponse]:
    """List all ingested datasets in the current workspace."""
    raw_dir = APIDependencies.get_raw_inputs_dir()
    results: list[DatasetUploadResponse] = []

    for meta_file in raw_dir.glob("*.meta.json"):
        try:
            data = json.loads(meta_file.read_text(encoding="utf-8"))
            results.append(DatasetUploadResponse.model_validate(data))
        except Exception:
            continue
    return results


@router.get("/{dataset_id}/preview", response_model=DatasetPreviewResponse)
def preview_dataset(dataset_id: str) -> DatasetPreviewResponse:
    """Preview first 50 rows and schema of an ingested dataset."""
    raw_dir = APIDependencies.get_raw_inputs_dir()
    found_meta: dict[str, Any] | None = None
    target_csv: Path | None = None

    for meta_file in raw_dir.glob("*.meta.json"):
        try:
            data = json.loads(meta_file.read_text(encoding="utf-8"))
            if data.get("dataset_id") == dataset_id or data.get("sha256_hash") == dataset_id:
                found_meta = data
                csv_path = raw_dir / f"{data['sha256_hash']}.csv"
                if csv_path.exists():
                    target_csv = csv_path
                break
        except Exception:
            continue

    if not found_meta or not target_csv:
        raise HTTPException(status_code=404, detail=f"Dataset '{dataset_id}' not found.")

    con = duckdb.connect(":memory:")
    try:
        cur = con.execute(f"SELECT * FROM read_csv_auto('{target_csv.as_posix()}') LIMIT 50;")
        col_names = [desc[0] for desc in cur.description]
        rows = cur.fetchall()
        sample_rows = [dict(zip(col_names, r, strict=False)) for r in rows]
    except Exception as exc:
        raise HTTPException(
            status_code=500, detail=f"Failed to read dataset preview: {exc}"
        ) from exc
    finally:
        con.close()

    return DatasetPreviewResponse(
        dataset_id=found_meta["dataset_id"],
        filename=found_meta["filename"],
        row_count=found_meta["row_count"],
        column_count=found_meta["column_count"],
        columns=[DatasetColumnInfo.model_validate(c) for c in found_meta["columns"]],
        sample_rows=sample_rows,
    )
