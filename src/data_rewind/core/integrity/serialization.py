"""Data Rewind canonical row serialization and value normalization.

Conforms strictly to Section 2.1 of SPEC-MOD-02.
Implements:
  C(r) = UTF-8( ||_{k in sorted(columns)} ( k || "=" || S(r[k]) || "|" ) )
"""

from __future__ import annotations

import math
import unicodedata
from datetime import UTC, date, datetime
from typing import Any

# Canonical sentinel tokens
NULL_SENTINEL = "\x00_NULL_\x00"
NAN_SENTINEL = "\x00_NAN_\x00"
POS_INF_SENTINEL = "\x00_POSINF_\x00"
NEG_INF_SENTINEL = "\x00_NEGINF_\x00"


def normalize_value(value: Any) -> str:
    """Normalize a Python value into its canonical string representation S(v)."""
    if value is None:
        return NULL_SENTINEL

    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"

    if isinstance(value, int):
        return str(value)

    if isinstance(value, float):
        if math.isnan(value):
            return NAN_SENTINEL
        if math.isinf(value):
            return POS_INF_SENTINEL if value > 0 else NEG_INF_SENTINEL
        # Handle negative zero normalization
        if value == 0.0:
            return "0.000000"
        # 6 fixed decimal places per SPEC-MOD-02
        return f"{value:.6f}"

    if isinstance(value, (datetime, date)):
        if isinstance(value, datetime):
            # Normalize to UTC ISO8601 string
            dt_val: datetime = (
                value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
            )
            return dt_val.strftime("%Y-%m-%dT%H:%M:%S.%fZ")
        return value.isoformat()

    if isinstance(value, str):
        # NFC Unicode normalization, un-trimmed, case-preserved
        return unicodedata.normalize("NFC", value)

    # Fallback to string representation with NFC normalization
    return unicodedata.normalize("NFC", str(value))


def canonical_row_bytes(row: dict[str, Any], columns: list[str] | None = None) -> bytes:
    """Compute the canonical byte representation C(r) for a row dictionary.

    Args:
        row: Dictionary of column -> value.
        columns: Optional explicit column list. If omitted, uses sorted keys from row.

    Returns:
        Canonical UTF-8 encoded bytes.
    """
    sorted_cols = sorted(columns if columns is not None else row.keys())
    parts: list[str] = []
    for col in sorted_cols:
        val = row.get(col)
        normalized = normalize_value(val)
        parts.append(f"{col}={normalized}|")

    return "".join(parts).encode("utf-8")
