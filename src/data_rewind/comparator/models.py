"""Data Rewind tabular comparator domain models and diff structures.

Conforms strictly to Section 1 of SPEC-MOD-04.
"""

from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class DiffCategory(str, Enum):
    """Partition category for compared rows."""

    IDENTICAL = "IDENTICAL"
    MODIFIED = "MODIFIED"
    ADDED = "ADDED"
    REMOVED = "REMOVED"


class CaseClassification(str, Enum):
    """Classification tags corresponding to the 15 specification comparison cases."""

    CASE_1_KEYED_PK = "CASE_1_KEYED_PK"
    CASE_2_COMPOSITE_KEY = "CASE_2_COMPOSITE_KEY"
    CASE_3_NULL_KEY = "CASE_3_NULL_KEY"
    CASE_4_DUPLICATE_KEY = "CASE_4_DUPLICATE_KEY"
    CASE_5_KEYLESS_MULTISET = "CASE_5_KEYLESS_MULTISET"
    CASE_6_REORDERED_ROWS = "CASE_6_REORDERED_ROWS"
    CASE_7_IDENTICAL_DUPLICATES = "CASE_7_IDENTICAL_DUPLICATES"
    CASE_8_PARTITION_INVARIANTS = "CASE_8_PARTITION_INVARIANTS"
    CASE_9_SCHEMA_DRIFT = "CASE_9_SCHEMA_DRIFT"
    CASE_10_TYPE_COERCION = "CASE_10_TYPE_COERCION"
    CASE_11_FLOAT_TOLERANCE = "CASE_11_FLOAT_TOLERANCE"
    CASE_12_DECIMAL_INTEGER_ARITHMETIC = "CASE_12_DECIMAL_INTEGER_ARITHMETIC"
    CASE_13_NAN_INF_NULL = "CASE_13_NAN_INF_NULL"
    CASE_14_STRING_NORMALIZATION = "CASE_14_STRING_NORMALIZATION"
    CASE_15_FINGERPRINT = "CASE_15_FINGERPRINT"


class ComparisonConfig(BaseModel):
    """Configuration options governing snapshot comparison semantics."""

    model_config = ConfigDict(frozen=True)

    primary_key: list[str] | None = None
    atol: float = Field(default=1e-6, ge=0.0)
    rtol: float = Field(default=1e-5, ge=0.0)
    case_sensitive: bool = True
    ignore_whitespace: bool = False
    float_tolerance_columns: list[str] | None = None


class SchemaDiff(BaseModel):
    """Detailed structural difference between baseline and target schemas."""

    model_config = ConfigDict(frozen=True)

    added_columns: list[str] = Field(default_factory=list)
    removed_columns: list[str] = Field(default_factory=list)
    common_columns: list[str] = Field(default_factory=list)
    type_changes: dict[str, tuple[str, str]] = Field(default_factory=dict)
    has_breaking_type_drift: bool = False

    @property
    def has_schema_drift(self) -> bool:
        """True if columns were added, removed, or had breaking type mutations."""
        return bool(self.added_columns or self.removed_columns or self.has_breaking_type_drift)


class ValueDiff(BaseModel):
    """Cell-level comparison discrepancy within a modified row."""

    model_config = ConfigDict(frozen=True)

    column: str
    baseline_value: Any
    target_value: Any
    is_numeric_tolerant_match: bool = False
    is_null_transition: bool = False
    is_numeric_corruption: bool = False


class RowDiff(BaseModel):
    """Individual row delta record with key and column discrepancies."""

    model_config = ConfigDict(frozen=True)

    category: DiffCategory
    key_values: dict[str, Any] = Field(default_factory=dict)
    baseline_row: dict[str, Any] | None = None
    target_row: dict[str, Any] | None = None
    field_diffs: list[ValueDiff] = Field(default_factory=list)
    row_hash_baseline: str | None = None
    row_hash_target: str | None = None


class DatasetFingerprint(BaseModel):
    """Deterministic cryptographic fingerprint of a tabular dataset."""

    model_config = ConfigDict(frozen=True)

    schema_hash: str
    multiset_hash: str
    row_count: int
    fingerprint_hash: str


class TabularDiffResult(BaseModel):
    """Complete, evidence-backed forensic diff result for two tabular snapshots."""

    model_config = ConfigDict(frozen=True)

    is_equal: bool
    case_classifications: list[CaseClassification] = Field(default_factory=list)
    schema_diff: SchemaDiff
    baseline_fingerprint: DatasetFingerprint
    target_fingerprint: DatasetFingerprint

    # Partition counts
    identical_count: int = Field(..., ge=0)
    modified_count: int = Field(..., ge=0)
    added_count: int = Field(..., ge=0)
    removed_count: int = Field(..., ge=0)
    baseline_row_count: int = Field(..., ge=0)
    target_row_count: int = Field(..., ge=0)

    # Samples and diagnostics
    sample_row_diffs: list[RowDiff] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    invalid_key_rows_baseline: list[dict[str, Any]] = Field(default_factory=list)
    invalid_key_rows_target: list[dict[str, Any]] = Field(default_factory=list)
    duplicate_keys_detected: list[Any] = Field(default_factory=list)

    # Telemetry
    execution_duration_ms: float = Field(default=0.0, ge=0.0)
    peak_memory_mib: float = Field(default=0.0, ge=0.0)

    def verify_partition_invariants(self) -> bool:
        """Verify mathematical partition completeness.

        |Identical| + |Modified| + |Removed| == |Baseline|
        |Identical| + |Modified| + |Added| == |Target|
        """
        baseline_valid = (
            self.identical_count + self.modified_count + self.removed_count
            == self.baseline_row_count
        )
        target_valid = (
            self.identical_count + self.modified_count + self.added_count == self.target_row_count
        )
        return baseline_valid and target_valid
