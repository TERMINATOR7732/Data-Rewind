"""Data Rewind forensic tabular comparator engine.

Implements all 15 comparison cases specified in Section 1 of SPEC-MOD-04.
"""

from __future__ import annotations

import hashlib
import math
import time
import unicodedata
from collections import Counter
from decimal import Decimal
from typing import Any

import duckdb

from data_rewind.comparator.models import (
    CaseClassification,
    ComparisonConfig,
    DatasetFingerprint,
    DiffCategory,
    RowDiff,
    SchemaDiff,
    TabularDiffResult,
    ValueDiff,
)
from data_rewind.core.domain.errors import ComparisonError
from data_rewind.core.integrity.hashing import (
    compute_multiset_hash,
    hash_canonical_row,
)

MAX_SAMPLE_DIFFS = 100


class TabularComparator:
    """Forensic comparator for tabular datasets with full 15-case semantics."""

    @classmethod
    def compare(
        cls,
        baseline: list[dict[str, Any]],
        target: list[dict[str, Any]],
        config: ComparisonConfig | None = None,
    ) -> TabularDiffResult:
        """Execute forensic tabular comparison between baseline and target snapshots."""
        start_time = time.perf_counter()
        cfg = config or ComparisonConfig()
        cases: list[CaseClassification] = [CaseClassification.CASE_8_PARTITION_INVARIANTS]
        warnings: list[str] = []

        # 1. Analyze and compare schemas (Case 9 & Case 10)
        schema_diff, schema_cases = cls._compare_schemas(baseline, target)
        cases.extend(schema_cases)

        # 2. Compute deterministic fingerprints for both datasets (Case 15)
        fp_baseline = cls.compute_fingerprint(baseline, schema_diff.common_columns)
        fp_target = cls.compute_fingerprint(target, schema_diff.common_columns)
        cases.append(CaseClassification.CASE_15_FINGERPRINT)

        # 3. Determine comparison mode: Keyed vs Keyless Multiset
        if cfg.primary_key:
            res = cls._compare_keyed(
                baseline,
                target,
                cfg,
                schema_diff,
                fp_baseline,
                fp_target,
                cases,
                warnings,
            )
        else:
            res = cls._compare_keyless(
                baseline,
                target,
                cfg,
                schema_diff,
                fp_baseline,
                fp_target,
                cases,
                warnings,
            )

        elapsed_ms = (time.perf_counter() - start_time) * 1000.0
        # Reconstruct with final execution duration
        final_result = res.model_copy(
            update={
                "execution_duration_ms": round(elapsed_ms, 3),
                "case_classifications": sorted(
                    set(res.case_classifications), key=lambda x: x.value
                ),
            }
        )

        if not final_result.verify_partition_invariants():
            raise ComparisonError(
                "Tabular diff failed mathematical partition completeness invariant.",
                details={
                    "baseline_rows": final_result.baseline_row_count,
                    "target_rows": final_result.target_row_count,
                    "identical": final_result.identical_count,
                    "modified": final_result.modified_count,
                    "added": final_result.added_count,
                    "removed": final_result.removed_count,
                },
            )

        return final_result

    @classmethod
    def compute_fingerprint(
        cls,
        rows: list[dict[str, Any]],
        columns: list[str] | None = None,
    ) -> DatasetFingerprint:
        """Compute cryptographic dataset fingerprint H_fingerprint(D) (Case 15)."""
        sorted_cols = (
            sorted(columns) if columns is not None else sorted({k for r in rows for k in r})
        )
        schema_descriptor = ",".join(sorted_cols)
        schema_hash = hashlib.sha256(schema_descriptor.encode()).hexdigest()
        multiset_hash = compute_multiset_hash(rows, columns=sorted_cols)
        row_count = len(rows)

        # H_fingerprint = SHA-256(SchemaHash || H_multiset || |D|)
        payload = f"{schema_hash}|{multiset_hash}|{row_count}".encode()
        fingerprint_hash = hashlib.sha256(payload).hexdigest()

        return DatasetFingerprint(
            schema_hash=schema_hash,
            multiset_hash=multiset_hash,
            row_count=row_count,
            fingerprint_hash=fingerprint_hash,
        )

    @classmethod
    def _compare_schemas(
        cls,
        baseline: list[dict[str, Any]],
        target: list[dict[str, Any]],
    ) -> tuple[SchemaDiff, list[CaseClassification]]:
        """Extract and compare column sets and inferred data types (Cases 9 & 10)."""
        cases: list[CaseClassification] = []
        cols_a = {k for r in baseline for k in r}
        cols_b = {k for r in target for k in r}

        added_cols = sorted(cols_b - cols_a)
        removed_cols = sorted(cols_a - cols_b)
        common_cols = sorted(cols_a & cols_b)

        if added_cols or removed_cols:
            cases.append(CaseClassification.CASE_9_SCHEMA_DRIFT)

        # Detect type mutations on common columns
        type_changes: dict[str, tuple[str, str]] = {}
        has_breaking = False

        for col in common_cols:
            type_a = cls._infer_column_type(baseline, col)
            type_b = cls._infer_column_type(target, col)
            if type_a != type_b:
                type_changes[col] = (type_a, type_b)
                cases.append(CaseClassification.CASE_10_TYPE_COERCION)
                # Breaking: e.g. integer/float -> string
                if (type_a in ("integer", "float") and type_b == "string") or (
                    type_a == "string" and type_b in ("integer", "float")
                ):
                    has_breaking = True

        schema_diff = SchemaDiff(
            added_columns=added_cols,
            removed_columns=removed_cols,
            common_columns=common_cols,
            type_changes=type_changes,
            has_breaking_type_drift=has_breaking,
        )
        return schema_diff, cases

    @classmethod
    def _infer_column_type(cls, rows: list[dict[str, Any]], column: str) -> str:
        """Infer predominant column type from non-null values."""
        for r in rows:
            val = r.get(column)
            if val is not None:
                if isinstance(val, bool):
                    return "boolean"
                if isinstance(val, int):
                    return "integer"
                if isinstance(val, (float, Decimal)):
                    return "float"
                return "string"
        return "null"

    @classmethod
    def _compare_keyed(
        cls,
        baseline: list[dict[str, Any]],
        target: list[dict[str, Any]],
        config: ComparisonConfig,
        schema_diff: SchemaDiff,
        fp_baseline: DatasetFingerprint,
        fp_target: DatasetFingerprint,
        cases: list[CaseClassification],
        warnings: list[str],
    ) -> TabularDiffResult:
        """Execute keyed full outer join comparison (Cases 1, 2, 3, 4)."""
        assert config.primary_key is not None
        pk = config.primary_key
        if len(pk) == 1:
            cases.append(CaseClassification.CASE_1_KEYED_PK)
        else:
            cases.append(CaseClassification.CASE_2_COMPOSITE_KEY)

        # 1. Null key detection (Case 3)
        valid_a, null_rows_a = cls._partition_null_keys(baseline, pk)
        valid_b, null_rows_b = cls._partition_null_keys(target, pk)

        if null_rows_a or null_rows_b:
            cases.append(CaseClassification.CASE_3_NULL_KEY)
            warnings.append(
                f"NULL_PRIMARY_KEY_WARNING: Found {len(null_rows_a)} baseline and "
                f"{len(null_rows_b)} target rows with null key values. Excluded from 1-to-1 match."
            )

        # 2. Duplicate key detection & fallback (Case 4)
        dups_a = cls._find_duplicate_keys(valid_a, pk)
        dups_b = cls._find_duplicate_keys(valid_b, pk)

        if dups_a or dups_b:
            cases.append(CaseClassification.CASE_4_DUPLICATE_KEY)
            all_dups = sorted(set(dups_a + dups_b), key=str)
            warnings.append(
                f"DUPLICATE_KEY_VIOLATION: Primary key contains {len(all_dups)} duplicate key values; "
                "aborted keyed join and fell back to keyless multiset comparison."
            )
            # Fall back to keyless comparison per Case 4
            fallback_res = cls._compare_keyless(
                baseline,
                target,
                config,
                schema_diff,
                fp_baseline,
                fp_target,
                cases,
                warnings,
            )
            return fallback_res.model_copy(
                update={
                    "duplicate_keys_detected": all_dups[:50],
                    "invalid_key_rows_baseline": null_rows_a[:50],
                    "invalid_key_rows_target": null_rows_b[:50],
                }
            )

        # 3. Unique Key Outer Join Matching
        map_a = {cls._extract_key_tuple(r, pk): r for r in valid_a}
        map_b = {cls._extract_key_tuple(r, pk): r for r in valid_b}

        keys_a = set(map_a.keys())
        keys_b = set(map_b.keys())

        common_keys = sorted(keys_a & keys_b, key=str)
        only_a_keys = sorted(keys_a - keys_b, key=str)
        only_b_keys = sorted(keys_b - keys_a, key=str)

        identical_count = 0
        modified_count = 0
        samples: list[RowDiff] = []

        for k in common_keys:
            r_a = map_a[k]
            r_b = map_b[k]
            field_diffs, val_cases, val_warnings = cls._diff_row_values(
                r_a, r_b, schema_diff.common_columns, config
            )
            cases.extend(val_cases)
            warnings.extend(val_warnings)

            if not field_diffs:
                identical_count += 1
            else:
                modified_count += 1
                if len(samples) < MAX_SAMPLE_DIFFS:
                    key_dict = dict(zip(pk, k, strict=False))
                    samples.append(
                        RowDiff(
                            category=DiffCategory.MODIFIED,
                            key_values=key_dict,
                            baseline_row=r_a,
                            target_row=r_b,
                            field_diffs=field_diffs,
                        )
                    )

        # Added & Removed rows
        added_count = len(only_b_keys) + len(null_rows_b)
        removed_count = len(only_a_keys) + len(null_rows_a)

        for k in only_a_keys:
            if len(samples) < MAX_SAMPLE_DIFFS:
                samples.append(
                    RowDiff(
                        category=DiffCategory.REMOVED,
                        key_values=dict(zip(pk, k, strict=False)),
                        baseline_row=map_a[k],
                    )
                )

        for k in only_b_keys:
            if len(samples) < MAX_SAMPLE_DIFFS:
                samples.append(
                    RowDiff(
                        category=DiffCategory.ADDED,
                        key_values=dict(zip(pk, k, strict=False)),
                        target_row=map_b[k],
                    )
                )

        is_equal = (
            modified_count == 0
            and added_count == 0
            and removed_count == 0
            and not schema_diff.has_schema_drift
            and not null_rows_a
            and not null_rows_b
        )

        return TabularDiffResult(
            is_equal=is_equal,
            case_classifications=cases,
            schema_diff=schema_diff,
            baseline_fingerprint=fp_baseline,
            target_fingerprint=fp_target,
            identical_count=identical_count,
            modified_count=modified_count,
            added_count=added_count,
            removed_count=removed_count,
            baseline_row_count=len(baseline),
            target_row_count=len(target),
            sample_row_diffs=samples,
            warnings=sorted(set(warnings)),
            invalid_key_rows_baseline=null_rows_a[:50],
            invalid_key_rows_target=null_rows_b[:50],
            duplicate_keys_detected=[],
        )

    @classmethod
    def _compare_keyless(
        cls,
        baseline: list[dict[str, Any]],
        target: list[dict[str, Any]],
        config: ComparisonConfig,
        schema_diff: SchemaDiff,
        fp_baseline: DatasetFingerprint,
        fp_target: DatasetFingerprint,
        cases: list[CaseClassification],
        warnings: list[str],
    ) -> TabularDiffResult:
        """Execute multiset (bag) frequency comparison (Cases 5, 6, 7)."""
        cases.append(CaseClassification.CASE_5_KEYLESS_MULTISET)
        common_cols = schema_diff.common_columns

        # Compute row hashes with multiplicity
        hash_list_a = [hash_canonical_row(r, common_cols) for r in baseline]
        hash_list_b = [hash_canonical_row(r, common_cols) for r in target]

        freq_a = Counter(hash_list_a)
        freq_b = Counter(hash_list_b)

        # Detect identical duplicates multiplicity (Case 7)
        if any(cnt > 1 for cnt in freq_a.values()) or any(cnt > 1 for cnt in freq_b.values()):
            cases.append(CaseClassification.CASE_7_IDENTICAL_DUPLICATES)

        all_hashes = sorted(set(freq_a.keys()) | set(freq_b.keys()))
        identical_count = 0
        removed_count = 0
        added_count = 0

        # Build reverse lookup for representative row dictionaries
        rep_a: dict[str, dict[str, Any]] = {}
        for r, h in zip(baseline, hash_list_a, strict=False):
            if h not in rep_a:
                rep_a[h] = r

        rep_b: dict[str, dict[str, Any]] = {}
        for r, h in zip(target, hash_list_b, strict=False):
            if h not in rep_b:
                rep_b[h] = r

        samples: list[RowDiff] = []

        for h in all_hashes:
            ca = freq_a.get(h, 0)
            cb = freq_b.get(h, 0)

            ident = min(ca, cb)
            rem = max(0, ca - cb)
            add = max(0, cb - ca)

            identical_count += ident
            removed_count += rem
            added_count += add

            if rem > 0 and len(samples) < MAX_SAMPLE_DIFFS:
                samples.append(
                    RowDiff(
                        category=DiffCategory.REMOVED,
                        baseline_row=rep_a.get(h),
                        row_hash_baseline=h,
                    )
                )

            if add > 0 and len(samples) < MAX_SAMPLE_DIFFS:
                samples.append(
                    RowDiff(
                        category=DiffCategory.ADDED,
                        target_row=rep_b.get(h),
                        row_hash_target=h,
                    )
                )

        # Check for reordered rows (Case 6)
        if (
            len(baseline) == len(target)
            and len(baseline) > 0
            and identical_count == len(baseline)
            and hash_list_a != hash_list_b
        ):
            cases.append(CaseClassification.CASE_6_REORDERED_ROWS)
            warnings.append(
                "IDENTICAL_MULTISET_REORDERED: Datasets contain identical records in different sequence."
            )

        is_equal = (
            added_count == 0
            and removed_count == 0
            and not schema_diff.has_schema_drift
            and fp_baseline.multiset_hash == fp_target.multiset_hash
        )

        return TabularDiffResult(
            is_equal=is_equal,
            case_classifications=cases,
            schema_diff=schema_diff,
            baseline_fingerprint=fp_baseline,
            target_fingerprint=fp_target,
            identical_count=identical_count,
            modified_count=0,  # Keyless comparison does not pair arbitrary row modifications
            added_count=added_count,
            removed_count=removed_count,
            baseline_row_count=len(baseline),
            target_row_count=len(target),
            sample_row_diffs=samples,
            warnings=sorted(set(warnings)),
            invalid_key_rows_baseline=[],
            invalid_key_rows_target=[],
            duplicate_keys_detected=[],
        )

    @classmethod
    def _partition_null_keys(
        cls,
        rows: list[dict[str, Any]],
        pk: list[str],
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        """Partition records into valid keys vs invalid (null key) rows (Case 3)."""
        valid: list[dict[str, Any]] = []
        invalid: list[dict[str, Any]] = []

        for r in rows:
            if any(r.get(col) is None for col in pk):
                invalid.append(r)
            else:
                valid.append(r)
        return valid, invalid

    @classmethod
    def _find_duplicate_keys(
        cls,
        rows: list[dict[str, Any]],
        pk: list[str],
    ) -> list[Any]:
        """Identify duplicate primary key values (Case 4)."""
        seen: set[tuple[Any, ...]] = set()
        duplicates: set[Any] = set()

        for r in rows:
            key_tup = cls._extract_key_tuple(r, pk)
            if key_tup in seen:
                duplicates.add(key_tup if len(pk) > 1 else key_tup[0])
            seen.add(key_tup)
        return sorted(duplicates, key=str)

    @classmethod
    def _extract_key_tuple(cls, row: dict[str, Any], pk: list[str]) -> tuple[Any, ...]:
        """Extract hashable tuple for primary key columns with canonical value representation."""
        tup: list[Any] = []
        for col in pk:
            val = row.get(col)
            # Normalize strings for key matching
            if isinstance(val, str):
                tup.append(unicodedata.normalize("NFC", val))
            else:
                tup.append(val)
        return tuple(tup)

    @classmethod
    def _diff_row_values(
        cls,
        row_a: dict[str, Any],
        row_b: dict[str, Any],
        common_columns: list[str],
        config: ComparisonConfig,
    ) -> tuple[list[ValueDiff], list[CaseClassification], list[str]]:
        """Compare field values for two aligned rows across common columns."""
        field_diffs: list[ValueDiff] = []
        cases: list[CaseClassification] = []
        warnings: list[str] = []

        for col in common_columns:
            val_a = row_a.get(col)
            val_b = row_b.get(col)

            # Compare single value pair
            match, vdiff, vcases, vwarns = cls.compare_values(val_a, val_b, col, config)
            cases.extend(vcases)
            warnings.extend(vwarns)

            if not match:
                assert vdiff is not None
                field_diffs.append(vdiff)

        return field_diffs, cases, warnings

    @classmethod
    def compare_values(
        cls,
        val_a: Any,
        val_b: Any,
        col_name: str,
        config: ComparisonConfig,
    ) -> tuple[bool, ValueDiff | None, list[CaseClassification], list[str]]:
        """Compare two field values conforming to Cases 10, 11, 12, 13, and 14."""
        cases: list[CaseClassification] = []
        warnings: list[str] = []

        # 1. Null handling (Case 13)
        if val_a is None and val_b is None:
            cases.append(CaseClassification.CASE_13_NAN_INF_NULL)
            return True, None, cases, warnings

        if val_a is None or val_b is None:
            cases.append(CaseClassification.CASE_13_NAN_INF_NULL)
            diff = ValueDiff(
                column=col_name,
                baseline_value=val_a,
                target_value=val_b,
                is_null_transition=True,
            )
            return False, diff, cases, warnings

        # 2. IEEE-754 Non-Finite Floats: NaN and Infinities (Case 13)
        is_float_a = isinstance(val_a, float)
        is_float_b = isinstance(val_b, float)

        if is_float_a or is_float_b:
            nan_a = is_float_a and math.isnan(val_a)
            nan_b = is_float_b and math.isnan(val_b)
            inf_a = is_float_a and math.isinf(val_a)
            inf_b = is_float_b and math.isinf(val_b)

            if nan_a or nan_b or inf_a or inf_b:
                cases.append(CaseClassification.CASE_13_NAN_INF_NULL)

                # Both NaN -> Equivalent in diff, warn
                if nan_a and nan_b:
                    warnings.append(
                        f"NON_FINITE_FLOAT_WARNING: Both values in '{col_name}' are NaN."
                    )
                    return True, None, cases, warnings

                # Both Inf of same sign -> Equivalent
                if inf_a and inf_b and ((val_a > 0) == (val_b > 0)):
                    warnings.append(
                        f"NON_FINITE_FLOAT_WARNING: Both values in '{col_name}' are matching infinities."
                    )
                    return True, None, cases, warnings

                # Finite to NaN/Inf or sign mismatch -> NUMERIC_CORRUPTION
                warnings.append(
                    f"NUMERIC_CORRUPTION: Value transitioned to non-finite state in column '{col_name}'."
                )
                diff = ValueDiff(
                    column=col_name,
                    baseline_value=val_a,
                    target_value=val_b,
                    is_numeric_corruption=True,
                )
                return False, diff, cases, warnings

        # 3. Floating-Point Tolerant Comparison (Case 11 & Case 10 Coercion)
        is_num_a = isinstance(val_a, (int, float, Decimal)) and not isinstance(val_a, bool)
        is_num_b = isinstance(val_b, (int, float, Decimal)) and not isinstance(val_b, bool)

        if is_num_a and is_num_b:
            # Check integer vs decimal (Case 12)
            if isinstance(val_a, int) and isinstance(val_b, int):
                cases.append(CaseClassification.CASE_12_DECIMAL_INTEGER_ARITHMETIC)
                if val_a == val_b:
                    return True, None, cases, warnings
                diff = ValueDiff(column=col_name, baseline_value=val_a, target_value=val_b)
                return False, diff, cases, warnings

            # Decimal and Float evaluation
            f_a = float(val_a)
            f_b = float(val_b)

            cases.append(CaseClassification.CASE_11_FLOAT_TOLERANCE)
            if (isinstance(val_a, int) and isinstance(val_b, float)) or (
                isinstance(val_a, float) and isinstance(val_b, int)
            ):
                cases.append(CaseClassification.CASE_10_TYPE_COERCION)

            # Formula: |v_A - v_B| <= atol + rtol * |v_B|
            diff_abs = abs(f_a - f_b)
            allowed_tol = config.atol + config.rtol * abs(f_b)

            if diff_abs <= allowed_tol:
                # Tolerant match
                return True, None, cases, warnings

            diff = ValueDiff(
                column=col_name,
                baseline_value=val_a,
                target_value=val_b,
            )
            return False, diff, cases, warnings

        # 4. String Normalization & Whitespace (Case 14)
        if isinstance(val_a, str) and isinstance(val_b, str):
            cases.append(CaseClassification.CASE_14_STRING_NORMALIZATION)
            s_a = unicodedata.normalize("NFC", val_a)
            s_b = unicodedata.normalize("NFC", val_b)

            if config.ignore_whitespace:
                s_a = s_a.strip()
                s_b = s_b.strip()

            if not config.case_sensitive:
                s_a = s_a.lower()
                s_b = s_b.lower()

            if s_a == s_b:
                return True, None, cases, warnings

            diff = ValueDiff(column=col_name, baseline_value=val_a, target_value=val_b)
            return False, diff, cases, warnings

        # 5. Direct Equality Fallback
        if val_a == val_b:
            return True, None, cases, warnings

        diff = ValueDiff(column=col_name, baseline_value=val_a, target_value=val_b)
        return False, diff, cases, warnings

    @classmethod
    def compare_tables(
        cls,
        conn: duckdb.DuckDBPyConnection,
        table_a: str,
        table_b: str,
        config: ComparisonConfig | None = None,
    ) -> TabularDiffResult:
        """Execute forensic tabular comparison between two DuckDB tables/views.

        Uses vectorized SQL outer joins for high throughput on datasets up to 500k+ rows.
        Conforms strictly to Section 1 of SPEC-MOD-04 and Section 3 of SPEC-MOD-04.
        """
        start_time = time.perf_counter()
        cfg = config or ComparisonConfig()
        cases: list[CaseClassification] = [CaseClassification.CASE_8_PARTITION_INVARIANTS]
        warnings: list[str] = []

        # 1. Schema introspection
        cols_a_info = conn.execute(f"PRAGMA table_info('{table_a}')").fetchall()
        cols_b_info = conn.execute(f"PRAGMA table_info('{table_b}')").fetchall()
        if not cols_a_info:
            raise ComparisonError(f"Baseline table '{table_a}' does not exist or has no columns.")
        if not cols_b_info:
            raise ComparisonError(f"Target table '{table_b}' does not exist or has no columns.")

        cols_a = [str(r[1]) for r in cols_a_info]
        types_a = {str(r[1]): str(r[2]).upper() for r in cols_a_info}
        cols_b = [str(r[1]) for r in cols_b_info]
        types_b = {str(r[1]): str(r[2]).upper() for r in cols_b_info}

        added_cols = sorted(set(cols_b) - set(cols_a))
        removed_cols = sorted(set(cols_a) - set(cols_b))
        common_cols = sorted(set(cols_a) & set(cols_b))

        if added_cols or removed_cols:
            cases.append(CaseClassification.CASE_9_SCHEMA_DRIFT)

        type_changes: dict[str, tuple[str, str]] = {}
        has_breaking = False
        for c in common_cols:
            ta = types_a.get(c, "UNKNOWN")
            tb = types_b.get(c, "UNKNOWN")
            if ta != tb:
                type_changes[c] = (ta, tb)
                cases.append(CaseClassification.CASE_10_TYPE_COERCION)
                if (
                    any(num in ta for num in ("INT", "FLOAT", "DOUBLE", "DECIMAL"))
                    and any(txt in tb for txt in ("VARCHAR", "TEXT", "CHAR"))
                ) or (
                    any(txt in ta for txt in ("VARCHAR", "TEXT", "CHAR"))
                    and any(num in tb for num in ("INT", "FLOAT", "DOUBLE", "DECIMAL"))
                ):
                    has_breaking = True

        schema_diff = SchemaDiff(
            added_columns=added_cols,
            removed_columns=removed_cols,
            common_columns=common_cols,
            type_changes=type_changes,
            has_breaking_type_drift=has_breaking,
        )

        cnt_a_raw = conn.execute(f'SELECT count(*) FROM "{table_a}"').fetchone()
        cnt_b_raw = conn.execute(f'SELECT count(*) FROM "{table_b}"').fetchone()
        assert cnt_a_raw is not None and cnt_b_raw is not None
        cnt_a = int(cnt_a_raw[0])
        cnt_b = int(cnt_b_raw[0])

        # 2. Dataset fingerprints
        cases.append(CaseClassification.CASE_15_FINGERPRINT)
        schema_descriptor = ",".join(common_cols)
        schema_hash = hashlib.sha256(schema_descriptor.encode()).hexdigest()

        if cnt_a <= 5000 and cnt_b <= 5000:
            cur_a = conn.execute(
                f'SELECT {", ".join(f"{c}" for c in common_cols)} FROM "{table_a}"'
            ).fetchall()
            cur_b = conn.execute(
                f'SELECT {", ".join(f"{c}" for c in common_cols)} FROM "{table_b}"'
            ).fetchall()
            rows_a = [dict(zip(common_cols, r, strict=False)) for r in cur_a]
            rows_b = [dict(zip(common_cols, r, strict=False)) for r in cur_b]
            fp_baseline = cls.compute_fingerprint(rows_a, common_cols)
            fp_target = cls.compute_fingerprint(rows_b, common_cols)
        else:
            col_list_str = ", ".join(f'"{c}"' for c in common_cols)
            raw_a = conn.execute(
                f"SELECT bit_xor(cast(hash(concat_ws('||', {col_list_str})) as HUGEINT)) FROM \"{table_a}\""
            ).fetchone()
            raw_b = conn.execute(
                f"SELECT bit_xor(cast(hash(concat_ws('||', {col_list_str})) as HUGEINT)) FROM \"{table_b}\""
            ).fetchone()
            val_a = raw_a[0] if raw_a else 0
            val_b = raw_b[0] if raw_b else 0
            mhash_a = hashlib.sha256(str(val_a).encode()).hexdigest()
            mhash_b = hashlib.sha256(str(val_b).encode()).hexdigest()
            fp_baseline = DatasetFingerprint(
                schema_hash=schema_hash,
                multiset_hash=mhash_a,
                row_count=cnt_a,
                fingerprint_hash=hashlib.sha256(
                    f"{schema_hash}|{mhash_a}|{cnt_a}".encode()
                ).hexdigest(),
            )
            fp_target = DatasetFingerprint(
                schema_hash=schema_hash,
                multiset_hash=mhash_b,
                row_count=cnt_b,
                fingerprint_hash=hashlib.sha256(
                    f"{schema_hash}|{mhash_b}|{cnt_b}".encode()
                ).hexdigest(),
            )

        # 3. Keyed vs Keyless Mode
        pk = cfg.primary_key
        fallback_to_keyless = False
        dup_keys: list[Any] = []

        if pk:
            missing_pk = [k for k in pk if k not in common_cols]
            if missing_pk:
                raise ComparisonError(
                    f"Primary key column(s) {missing_pk} not found in common schema."
                )

            # Null key check (Case 3)
            null_cond = " OR ".join(f'"{k}" IS NULL' for k in pk)
            res_na = conn.execute(f'SELECT count(*) FROM "{table_a}" WHERE {null_cond}').fetchone()
            res_nb = conn.execute(f'SELECT count(*) FROM "{table_b}" WHERE {null_cond}').fetchone()
            null_a_cnt = int(res_na[0]) if res_na else 0
            null_b_cnt = int(res_nb[0]) if res_nb else 0
            if null_a_cnt > 0 or null_b_cnt > 0:
                cases.append(CaseClassification.CASE_3_NULL_KEY)
                warnings.append(
                    f"NULL_PRIMARY_KEY_WARNING: Found {null_a_cnt} baseline and {null_b_cnt} target rows with null key values."
                )

            # Duplicate key check (Case 4)
            pk_cols_sql = ", ".join(f'"{k}"' for k in pk)
            pk_not_null = " AND ".join(f'"{k}" IS NOT NULL' for k in pk)
            dup_a_rows = conn.execute(
                f'SELECT {pk_cols_sql} FROM "{table_a}" WHERE {pk_not_null} GROUP BY {pk_cols_sql} HAVING count(*) > 1 LIMIT 50'
            ).fetchall()
            dup_b_rows = conn.execute(
                f'SELECT {pk_cols_sql} FROM "{table_b}" WHERE {pk_not_null} GROUP BY {pk_cols_sql} HAVING count(*) > 1 LIMIT 50'
            ).fetchall()

            if dup_a_rows or dup_b_rows:
                cases.append(CaseClassification.CASE_4_DUPLICATE_KEY)
                dup_keys = [r[0] if len(pk) == 1 else tuple(r) for r in (dup_a_rows + dup_b_rows)]
                warnings.append(
                    "DUPLICATE_KEY_VIOLATION: Primary key contains duplicate values; aborted keyed outer join and fell back to keyless multiset comparison."
                )
                fallback_to_keyless = True

        if pk and not fallback_to_keyless:
            # Keyed Outer Join
            if len(pk) == 1:
                cases.append(CaseClassification.CASE_1_KEYED_PK)
            else:
                cases.append(CaseClassification.CASE_2_COMPOSITE_KEY)

            non_key_cols = [c for c in common_cols if c not in pk]
            col_match_clauses: list[str] = []

            for c in non_key_cols:
                col_type = types_a.get(c, "")
                if any(flt in col_type for flt in ("FLOAT", "DOUBLE", "DECIMAL", "REAL")):
                    cases.append(CaseClassification.CASE_11_FLOAT_TOLERANCE)
                    col_match_clauses.append(
                        f'((a."{c}" IS NOT DISTINCT FROM b."{c}") OR '
                        f'(abs(a."{c}" - b."{c}") <= ({cfg.atol} + {cfg.rtol} * abs(b."{c}"))))'
                    )
                elif any(txt in col_type for txt in ("VARCHAR", "TEXT", "CHAR")):
                    cases.append(CaseClassification.CASE_14_STRING_NORMALIZATION)
                    if cfg.ignore_whitespace and not cfg.case_sensitive:
                        col_match_clauses.append(
                            f'lower(trim(a."{c}")) IS NOT DISTINCT FROM lower(trim(b."{c}"))'
                        )
                    elif cfg.ignore_whitespace:
                        col_match_clauses.append(
                            f'trim(a."{c}") IS NOT DISTINCT FROM trim(b."{c}")'
                        )
                    elif not cfg.case_sensitive:
                        col_match_clauses.append(
                            f'lower(a."{c}") IS NOT DISTINCT FROM lower(b."{c}")'
                        )
                    else:
                        col_match_clauses.append(f'a."{c}" IS NOT DISTINCT FROM b."{c}"')
                elif any(it in col_type for it in ("INT", "BIGINT", "SMALLINT", "TINYINT")):
                    cases.append(CaseClassification.CASE_12_DECIMAL_INTEGER_ARITHMETIC)
                    col_match_clauses.append(f'a."{c}" IS NOT DISTINCT FROM b."{c}"')
                else:
                    col_match_clauses.append(f'a."{c}" IS NOT DISTINCT FROM b."{c}"')

            val_equality_sql = " AND ".join(col_match_clauses) if col_match_clauses else "TRUE"
            join_sql = " AND ".join(f'a."{k}" = b."{k}"' for k in pk)
            pk_not_null = " AND ".join(f'"{k}" IS NOT NULL' for k in pk)

            diff_query = f"""
            SELECT
                count(*) FILTER (WHERE a_pk IS NULL) AS added_valid,
                count(*) FILTER (WHERE b_pk IS NULL) AS removed_valid,
                count(*) FILTER (WHERE a_pk IS NOT NULL AND b_pk IS NOT NULL AND NOT ({val_equality_sql})) AS modified_count,
                count(*) FILTER (WHERE a_pk IS NOT NULL AND b_pk IS NOT NULL AND ({val_equality_sql})) AS identical_count
            FROM (SELECT *, "{pk[0]}" AS a_pk FROM "{table_a}" WHERE {pk_not_null}) a
            FULL OUTER JOIN (SELECT *, "{pk[0]}" AS b_pk FROM "{table_b}" WHERE {pk_not_null}) b
            ON {join_sql}
            """
            counts = conn.execute(diff_query).fetchone()
            assert counts is not None
            added_valid = int(counts[0])
            removed_valid = int(counts[1])
            modified_count = int(counts[2])
            identical_count = int(counts[3])

            null_cond = " OR ".join(f'"{k}" IS NULL' for k in pk)
            res_na = conn.execute(f'SELECT count(*) FROM "{table_a}" WHERE {null_cond}').fetchone()
            res_nb = conn.execute(f'SELECT count(*) FROM "{table_b}" WHERE {null_cond}').fetchone()
            null_a_cnt = int(res_na[0]) if res_na else 0
            null_b_cnt = int(res_nb[0]) if res_nb else 0

            added_count = added_valid + null_b_cnt
            removed_count = removed_valid + null_a_cnt

            is_equal = (
                modified_count == 0
                and added_count == 0
                and removed_count == 0
                and not schema_diff.has_schema_drift
            )

            res = TabularDiffResult(
                is_equal=is_equal,
                case_classifications=sorted(set(cases), key=lambda x: x.value),
                schema_diff=schema_diff,
                baseline_fingerprint=fp_baseline,
                target_fingerprint=fp_target,
                identical_count=identical_count,
                modified_count=modified_count,
                added_count=added_count,
                removed_count=removed_count,
                baseline_row_count=cnt_a,
                target_row_count=cnt_b,
                sample_row_diffs=[],
                warnings=sorted(set(warnings)),
                duplicate_keys_detected=[],
            )
        else:
            # Keyless Multiset comparison (Cases 5, 6, 7)
            cases.append(CaseClassification.CASE_5_KEYLESS_MULTISET)
            col_list_sql = ", ".join(
                f"coalesce(cast(\"{c}\" as varchar), '__NULL__')" for c in common_cols
            )
            hash_expr = f"md5(concat_ws('||', {col_list_sql}))"

            keyless_query = f"""
            WITH freq_a AS (
                SELECT {hash_expr} AS h, count(*) AS cnt FROM "{table_a}" GROUP BY h
            ),
            freq_b AS (
                SELECT {hash_expr} AS h, count(*) AS cnt FROM "{table_b}" GROUP BY h
            )
            SELECT
                coalesce(sum(least(coalesce(a.cnt, 0), coalesce(b.cnt, 0))), 0) AS identical_count,
                coalesce(sum(greatest(0, coalesce(b.cnt, 0) - coalesce(a.cnt, 0))), 0) AS added_count,
                coalesce(sum(greatest(0, coalesce(a.cnt, 0) - coalesce(b.cnt, 0))), 0) AS removed_count
            FROM freq_a a
            FULL OUTER JOIN freq_b b ON a.h = b.h
            """
            kcounts = conn.execute(keyless_query).fetchone()
            assert kcounts is not None
            identical_count, added_count, removed_count = (
                int(kcounts[0]),
                int(kcounts[1]),
                int(kcounts[2]),
            )

            # Check duplicate identical records (Case 7)
            res_da = conn.execute(
                f'SELECT count(*) FROM (SELECT {hash_expr} AS h, count(*) AS cnt FROM "{table_a}" GROUP BY h HAVING cnt > 1)'
            ).fetchone()
            res_db = conn.execute(
                f'SELECT count(*) FROM (SELECT {hash_expr} AS h, count(*) AS cnt FROM "{table_b}" GROUP BY h HAVING cnt > 1)'
            ).fetchone()
            dups_in_a = int(res_da[0]) if res_da else 0
            dups_in_b = int(res_db[0]) if res_db else 0
            if dups_in_a > 0 or dups_in_b > 0:
                cases.append(CaseClassification.CASE_7_IDENTICAL_DUPLICATES)

            # Check reordered rows (Case 6)
            if (
                cnt_a == cnt_b
                and cnt_a > 0
                and identical_count == cnt_a
                and fp_baseline.multiset_hash == fp_target.multiset_hash
            ):
                cases.append(CaseClassification.CASE_6_REORDERED_ROWS)
                warnings.append(
                    "IDENTICAL_MULTISET_REORDERED: Datasets contain identical records in different sequence."
                )

            is_equal = (
                added_count == 0
                and removed_count == 0
                and not schema_diff.has_schema_drift
                and fp_baseline.multiset_hash == fp_target.multiset_hash
            )

            res = TabularDiffResult(
                is_equal=is_equal,
                case_classifications=sorted(set(cases), key=lambda x: x.value),
                schema_diff=schema_diff,
                baseline_fingerprint=fp_baseline,
                target_fingerprint=fp_target,
                identical_count=identical_count,
                modified_count=0,
                added_count=added_count,
                removed_count=removed_count,
                baseline_row_count=cnt_a,
                target_row_count=cnt_b,
                sample_row_diffs=[],
                warnings=sorted(set(warnings)),
                duplicate_keys_detected=dup_keys,
            )

        elapsed_ms = (time.perf_counter() - start_time) * 1000.0
        final_result = res.model_copy(
            update={
                "execution_duration_ms": round(elapsed_ms, 3),
                "case_classifications": sorted(
                    set(res.case_classifications), key=lambda x: x.value
                ),
            }
        )

        if not final_result.verify_partition_invariants():
            raise ComparisonError(
                "Table diff failed mathematical partition completeness invariant.",
                details={
                    "baseline_rows": final_result.baseline_row_count,
                    "target_rows": final_result.target_row_count,
                    "identical": final_result.identical_count,
                    "modified": final_result.modified_count,
                    "added": final_result.added_count,
                    "removed": final_result.removed_count,
                },
            )

        return final_result
