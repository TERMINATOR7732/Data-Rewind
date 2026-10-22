"""Comprehensive test suite for the Data Rewind Forensic Tabular Comparator.

Conforms strictly to Section 1 of SPEC-MOD-04, covering all 15 operational comparison cases.
"""

from __future__ import annotations

from decimal import Decimal

import duckdb

from data_rewind.comparator.engine import TabularComparator
from data_rewind.comparator.models import (
    CaseClassification,
    ComparisonConfig,
    DiffCategory,
)
from data_rewind.comparator.serialization import (
    diff_result_from_json,
    diff_result_to_json,
)


# ---------------------------------------------------------------------------
# Case 1: Keyed Comparison with Unique Primary Key
# ---------------------------------------------------------------------------
def test_case_1_keyed_pk_partitions() -> None:
    baseline = [
        {"id": 1, "name": "Alice", "score": 90.0},
        {"id": 2, "name": "Bob", "score": 80.0},
        {"id": 3, "name": "Charlie", "score": 70.0},
    ]
    target = [
        {"id": 1, "name": "Alice", "score": 90.0},  # Identical
        {"id": 2, "name": "Bob", "score": 85.0},  # Modified
        {"id": 4, "name": "David", "score": 95.0},  # Added
        # id 3 Removed
    ]
    cfg = ComparisonConfig(primary_key=["id"])
    res = TabularComparator.compare(baseline, target, cfg)

    assert CaseClassification.CASE_1_KEYED_PK in res.case_classifications
    assert res.identical_count == 1
    assert res.modified_count == 1
    assert res.added_count == 1
    assert res.removed_count == 1
    assert res.verify_partition_invariants()
    assert not res.is_equal

    # Verify sample diff categories
    mod_sample = next(s for s in res.sample_row_diffs if s.category == DiffCategory.MODIFIED)
    assert mod_sample.key_values == {"id": 2}
    assert mod_sample.field_diffs[0].column == "score"
    assert mod_sample.field_diffs[0].baseline_value == 80.0
    assert mod_sample.field_diffs[0].target_value == 85.0


# ---------------------------------------------------------------------------
# Case 2: Composite Keys (Tuple Equivalence)
# ---------------------------------------------------------------------------
def test_case_2_composite_key() -> None:
    baseline = [
        {"tenant": "T1", "id": 100, "val": "A"},
        {"tenant": "T1", "id": 200, "val": "B"},
    ]
    target = [
        {"tenant": "T1", "id": 100, "val": "A"},
        {"tenant": "T2", "id": 100, "val": "C"},  # Added composite key
    ]
    cfg = ComparisonConfig(primary_key=["tenant", "id"])
    res = TabularComparator.compare(baseline, target, cfg)

    assert CaseClassification.CASE_2_COMPOSITE_KEY in res.case_classifications
    assert res.identical_count == 1
    assert res.modified_count == 0
    assert res.added_count == 1
    assert res.removed_count == 1
    assert res.verify_partition_invariants()


# ---------------------------------------------------------------------------
# Case 3: Null or Missing Key Values
# ---------------------------------------------------------------------------
def test_case_3_null_key_warning() -> None:
    baseline = [
        {"id": 1, "val": "A"},
        {"id": None, "val": "Corrupt1"},
    ]
    target = [
        {"id": 1, "val": "A"},
        {"id": None, "val": "Corrupt2"},
    ]
    cfg = ComparisonConfig(primary_key=["id"])
    res = TabularComparator.compare(baseline, target, cfg)

    assert CaseClassification.CASE_3_NULL_KEY in res.case_classifications
    assert len(res.invalid_key_rows_baseline) == 1
    assert len(res.invalid_key_rows_target) == 1
    assert any("NULL_PRIMARY_KEY_WARNING" in w for w in res.warnings)
    # The valid row id=1 matches; null rows cannot be matched 1-to-1 so partition to removed/added
    assert res.identical_count == 1
    assert res.removed_count == 1
    assert res.added_count == 1
    assert res.verify_partition_invariants()


# ---------------------------------------------------------------------------
# Case 4: Duplicate Key Violations (Fallback to Multiset)
# ---------------------------------------------------------------------------
def test_case_4_duplicate_key_fallback() -> None:
    baseline = [
        {"id": 1, "val": "A"},
        {"id": 1, "val": "A"},  # Duplicate PK
        {"id": 2, "val": "B"},
    ]
    target = [
        {"id": 1, "val": "A"},
        {"id": 1, "val": "A"},
        {"id": 2, "val": "B"},
    ]
    cfg = ComparisonConfig(primary_key=["id"])
    res = TabularComparator.compare(baseline, target, cfg)

    assert CaseClassification.CASE_4_DUPLICATE_KEY in res.case_classifications
    assert CaseClassification.CASE_5_KEYLESS_MULTISET in res.case_classifications
    assert any("DUPLICATE_KEY_VIOLATION" in w for w in res.warnings)
    assert 1 in res.duplicate_keys_detected
    assert res.identical_count == 3
    assert res.verify_partition_invariants()
    assert res.is_equal


# ---------------------------------------------------------------------------
# Case 5: Keyless Multiset (Bag) Comparison
# ---------------------------------------------------------------------------
def test_case_5_keyless_multiset() -> None:
    baseline = [
        {"user": "alice", "action": "login"},
        {"user": "bob", "action": "logout"},
    ]
    target = [
        {"user": "alice", "action": "login"},
        {"user": "charlie", "action": "signup"},
    ]
    cfg = ComparisonConfig(primary_key=None)
    res = TabularComparator.compare(baseline, target, cfg)

    assert CaseClassification.CASE_5_KEYLESS_MULTISET in res.case_classifications
    assert res.identical_count == 1
    assert res.modified_count == 0  # Keyless comparison does not pair arbitrary row modifications
    assert res.removed_count == 1
    assert res.added_count == 1
    assert res.verify_partition_invariants()


# ---------------------------------------------------------------------------
# Case 6: Reordered Rows
# ---------------------------------------------------------------------------
def test_case_6_reordered_rows() -> None:
    baseline = [
        {"row": 1, "text": "alpha"},
        {"row": 2, "text": "beta"},
        {"row": 3, "text": "gamma"},
    ]
    target = [
        {"row": 3, "text": "gamma"},
        {"row": 1, "text": "alpha"},
        {"row": 2, "text": "beta"},
    ]
    cfg = ComparisonConfig(primary_key=None)
    res = TabularComparator.compare(baseline, target, cfg)

    assert CaseClassification.CASE_6_REORDERED_ROWS in res.case_classifications
    assert res.is_equal
    assert res.identical_count == 3
    assert res.added_count == 0
    assert res.removed_count == 0
    assert res.baseline_fingerprint.multiset_hash == res.target_fingerprint.multiset_hash
    assert any("IDENTICAL_MULTISET_REORDERED" in w for w in res.warnings)


# ---------------------------------------------------------------------------
# Case 7: Identical Duplicate Rows (Multiplicity)
# ---------------------------------------------------------------------------
def test_case_7_identical_duplicates() -> None:
    # 3 copies in baseline, 2 in target -> 2 identical, 1 removed
    row = {"product": "widget", "qty": 10}
    baseline = [row, row, row]
    target = [row, row]

    res = TabularComparator.compare(baseline, target, ComparisonConfig())

    assert CaseClassification.CASE_7_IDENTICAL_DUPLICATES in res.case_classifications
    assert res.identical_count == 2
    assert res.removed_count == 1
    assert res.added_count == 0
    assert res.verify_partition_invariants()


# ---------------------------------------------------------------------------
# Case 8: Added/Removed/Modified Partition Completeness Invariants
# ---------------------------------------------------------------------------
def test_case_8_partition_completeness_invariant() -> None:
    baseline = [{"id": i, "val": i * 10} for i in range(100)]
    # Target: 50 identical, 20 modified, 30 removed, 15 added
    target = [{"id": i, "val": i * 10} for i in range(50)]
    target.extend([{"id": i, "val": i * 10 + 1} for i in range(50, 70)])
    target.extend([{"id": i, "val": i * 10} for i in range(100, 115)])

    res = TabularComparator.compare(baseline, target, ComparisonConfig(primary_key=["id"]))

    assert res.identical_count == 50
    assert res.modified_count == 20
    assert res.removed_count == 30
    assert res.added_count == 15
    assert res.baseline_row_count == 100
    assert res.target_row_count == 85

    # |I| + |M| + |R| == |D_A|
    assert res.identical_count + res.modified_count + res.removed_count == res.baseline_row_count
    # |I| + |M| + |A| == |D_B|
    assert res.identical_count + res.modified_count + res.added_count == res.target_row_count
    assert res.verify_partition_invariants()


# ---------------------------------------------------------------------------
# Case 9: Column Additions and Removals (Schema Drift)
# ---------------------------------------------------------------------------
def test_case_9_schema_drift() -> None:
    baseline = [{"id": 1, "col_old": "foo", "common": "bar"}]
    target = [{"id": 1, "col_new": "baz", "common": "bar"}]

    res = TabularComparator.compare(baseline, target, ComparisonConfig(primary_key=["id"]))

    assert CaseClassification.CASE_9_SCHEMA_DRIFT in res.case_classifications
    assert res.schema_diff.has_schema_drift
    assert res.schema_diff.added_columns == ["col_new"]
    assert res.schema_diff.removed_columns == ["col_old"]
    assert res.schema_diff.common_columns == ["common", "id"]
    assert not res.is_equal


# ---------------------------------------------------------------------------
# Case 10: Type Changes and Coercion
# ---------------------------------------------------------------------------
def test_case_10_type_coercion() -> None:
    # Numeric type shift: int to float within tolerance -> matches
    baseline = [{"id": 1, "val": 42}]
    target = [{"id": 1, "val": 42.0000001}]
    res = TabularComparator.compare(baseline, target, ComparisonConfig(primary_key=["id"]))

    assert CaseClassification.CASE_10_TYPE_COERCION in res.case_classifications
    assert CaseClassification.CASE_11_FLOAT_TOLERANCE in res.case_classifications
    assert res.is_equal

    # Breaking type drift: int to string
    baseline_b = [{"id": 1, "val": 42}]
    target_b = [{"id": 1, "val": "forty-two"}]
    res_b = TabularComparator.compare(baseline_b, target_b, ComparisonConfig(primary_key=["id"]))

    assert res_b.schema_diff.has_breaking_type_drift
    assert not res_b.is_equal


# ---------------------------------------------------------------------------
# Case 11: Floating-Point Tolerance
# ---------------------------------------------------------------------------
def test_case_11_float_tolerance() -> None:
    # Within default atol=1e-6, rtol=1e-5
    baseline = [{"id": 1, "val": 100.0}]
    target = [
        {"id": 1, "val": 100.0005}
    ]  # Diff is 0.0005, tolerance is 1e-6 + 1e-5 * 100 = 0.001001 -> PASS

    res = TabularComparator.compare(baseline, target, ComparisonConfig(primary_key=["id"]))
    assert CaseClassification.CASE_11_FLOAT_TOLERANCE in res.case_classifications
    assert res.is_equal
    assert res.identical_count == 1
    assert res.modified_count == 0

    # Outside tolerance
    target_outside = [{"id": 1, "val": 100.005}]  # Diff is 0.005 > 0.001001 -> FAIL
    res_out = TabularComparator.compare(
        baseline, target_outside, ComparisonConfig(primary_key=["id"])
    )
    assert not res_out.is_equal
    assert res_out.modified_count == 1


# ---------------------------------------------------------------------------
# Case 12: Decimal and Integer Exact Arithmetic
# ---------------------------------------------------------------------------
def test_case_12_decimal_and_integer_arithmetic() -> None:
    baseline = [{"id": 1, "amount": 1000000000000000, "fin": Decimal("123.456789")}]
    target = [{"id": 1, "amount": 1000000000000000, "fin": Decimal("123.456789")}]

    res = TabularComparator.compare(baseline, target, ComparisonConfig(primary_key=["id"]))
    assert CaseClassification.CASE_12_DECIMAL_INTEGER_ARITHMETIC in res.case_classifications
    assert res.is_equal


# ---------------------------------------------------------------------------
# Case 13: NaN, Infinities, and Null Semantics
# ---------------------------------------------------------------------------
def test_case_13_nan_inf_null() -> None:
    # Null == Null match
    b_null = [{"id": 1, "v": None}]
    t_null = [{"id": 1, "v": None}]
    res_null = TabularComparator.compare(b_null, t_null, ComparisonConfig(primary_key=["id"]))
    assert res_null.is_equal

    # NaN == NaN equivalent with warning
    b_nan = [{"id": 1, "v": float("nan")}]
    t_nan = [{"id": 1, "v": float("nan")}]
    res_nan = TabularComparator.compare(b_nan, t_nan, ComparisonConfig(primary_key=["id"]))
    assert res_nan.is_equal
    assert any("NON_FINITE_FLOAT_WARNING" in w for w in res_nan.warnings)

    # +Inf == +Inf equivalent with warning
    b_inf = [{"id": 1, "v": float("inf")}]
    t_inf = [{"id": 1, "v": float("inf")}]
    res_inf = TabularComparator.compare(b_inf, t_inf, ComparisonConfig(primary_key=["id"]))
    assert res_inf.is_equal

    # Numeric corruption: finite to NaN
    b_corrupt = [{"id": 1, "v": 12.34}]
    t_corrupt = [{"id": 1, "v": float("nan")}]
    res_corrupt = TabularComparator.compare(
        b_corrupt, t_corrupt, ComparisonConfig(primary_key=["id"])
    )
    assert not res_corrupt.is_equal
    assert res_corrupt.modified_count == 1
    sample = res_corrupt.sample_row_diffs[0]
    assert sample.field_diffs[0].is_numeric_corruption
    assert any("NUMERIC_CORRUPTION" in w for w in res_corrupt.warnings)


# ---------------------------------------------------------------------------
# Case 14: String Normalization and Whitespace
# ---------------------------------------------------------------------------
def test_case_14_string_normalization() -> None:
    # NFC Unicode equivalence: "café" composed vs decomposed
    s1 = "caf\u00e9"  # NFC
    s2 = "cafe\u0301"  # NFD
    baseline = [{"id": 1, "word": s1}]
    target = [{"id": 1, "word": s2}]

    res = TabularComparator.compare(baseline, target, ComparisonConfig(primary_key=["id"]))
    assert CaseClassification.CASE_14_STRING_NORMALIZATION in res.case_classifications
    assert res.is_equal

    # Whitespace preserved by default (fails if differing)
    b_space = [{"id": 1, "word": " hello "}]
    t_space = [{"id": 1, "word": "hello"}]
    res_space = TabularComparator.compare(b_space, t_space, ComparisonConfig(primary_key=["id"]))
    assert not res_space.is_equal

    # With ignore_whitespace=True -> matches
    res_trim = TabularComparator.compare(
        b_space, t_space, ComparisonConfig(primary_key=["id"], ignore_whitespace=True)
    )
    assert res_trim.is_equal


# ---------------------------------------------------------------------------
# Case 15: Deterministic Dataset Fingerprints
# ---------------------------------------------------------------------------
def test_case_15_dataset_fingerprints() -> None:
    rows = [{"id": 1, "v": "a"}, {"id": 2, "v": "b"}]
    fp1 = TabularComparator.compute_fingerprint(rows)
    fp2 = TabularComparator.compute_fingerprint(list(reversed(rows)))

    assert len(fp1.schema_hash) == 64
    assert len(fp1.multiset_hash) == 64
    assert len(fp1.fingerprint_hash) == 64
    # Invariant: multiset hash is invariant under permutation
    assert fp1.multiset_hash == fp2.multiset_hash
    assert fp1.fingerprint_hash == fp2.fingerprint_hash


# ---------------------------------------------------------------------------
# DuckDB Vectorized compare_tables Tests
# ---------------------------------------------------------------------------
def test_compare_tables_duckdb_keyed() -> None:
    conn = duckdb.connect(":memory:")
    conn.execute("CREATE TABLE t1 (id BIGINT, val DOUBLE, s VARCHAR)")
    conn.execute("CREATE TABLE t2 (id BIGINT, val DOUBLE, s VARCHAR)")

    conn.execute("INSERT INTO t1 VALUES (1, 10.0, 'a'), (2, 20.0, 'b'), (3, 30.0, 'c')")
    conn.execute("INSERT INTO t2 VALUES (1, 10.0, 'a'), (2, 25.0, 'b'), (4, 40.0, 'd')")

    cfg = ComparisonConfig(primary_key=["id"])
    res = TabularComparator.compare_tables(conn, "t1", "t2", cfg)

    assert CaseClassification.CASE_1_KEYED_PK in res.case_classifications
    assert res.identical_count == 1
    assert res.modified_count == 1
    assert res.added_count == 1
    assert res.removed_count == 1
    assert res.verify_partition_invariants()


def test_compare_tables_duckdb_keyless() -> None:
    conn = duckdb.connect(":memory:")
    conn.execute("CREATE TABLE t1 (val DOUBLE, s VARCHAR)")
    conn.execute("CREATE TABLE t2 (val DOUBLE, s VARCHAR)")

    conn.execute("INSERT INTO t1 VALUES (10.0, 'a'), (20.0, 'b')")
    conn.execute("INSERT INTO t2 VALUES (20.0, 'b'), (10.0, 'a')")

    res = TabularComparator.compare_tables(conn, "t1", "t2", ComparisonConfig(primary_key=None))

    assert CaseClassification.CASE_5_KEYLESS_MULTISET in res.case_classifications
    assert res.identical_count == 2
    assert res.added_count == 0
    assert res.removed_count == 0
    assert res.verify_partition_invariants()
    assert res.is_equal


# ---------------------------------------------------------------------------
# Serialization Roundtrip Test
# ---------------------------------------------------------------------------
def test_comparator_serialization_roundtrip() -> None:
    baseline = [{"id": 1, "val": "A"}]
    target = [{"id": 1, "val": "B"}]
    res = TabularComparator.compare(baseline, target, ComparisonConfig(primary_key=["id"]))

    json_str = diff_result_to_json(res)
    restored = diff_result_from_json(json_str)

    assert restored.is_equal == res.is_equal
    assert restored.identical_count == res.identical_count
    assert restored.modified_count == res.modified_count
    assert restored.added_count == res.added_count
    assert restored.removed_count == res.removed_count
    assert restored.baseline_fingerprint == res.baseline_fingerprint
    assert restored.case_classifications == res.case_classifications


# ---------------------------------------------------------------------------
# Milestone 2.0.2 Regression Tests (P1-01, P2-01, P2-02, P3-02, P3-03)
# ---------------------------------------------------------------------------
def test_p1_01_multiset_hash_duplicate_preservation() -> None:
    """Verify additive multiset hashing in DuckDB preserves row multiplicity."""
    conn = duckdb.connect(":memory:")
    conn.execute("CREATE TABLE d_empty (id INT, val VARCHAR)")
    conn.execute("CREATE TABLE d_2dup (id INT, val VARCHAR)")
    conn.execute("CREATE TABLE d_4dup (id INT, val VARCHAR)")

    # Insert duplicate pairs
    conn.execute("INSERT INTO d_2dup VALUES (1, 'hello'), (1, 'hello')")
    conn.execute("INSERT INTO d_4dup VALUES (1, 'hello'), (1, 'hello'), (1, 'hello'), (1, 'hello')")

    cols = ["id", "val"]
    h_empty = TabularComparator._compute_duckdb_multiset_hash(conn, "d_empty", cols)
    h_2dup = TabularComparator._compute_duckdb_multiset_hash(conn, "d_2dup", cols)
    h_4dup = TabularComparator._compute_duckdb_multiset_hash(conn, "d_4dup", cols)

    # Invariant: duplicate pair does not cancel to zero (XOR defect P1-01)
    assert h_2dup != h_empty
    # Invariant: 2 duplicates != 4 duplicates
    assert h_2dup != h_4dup
    assert len(h_2dup) == 64


def test_p1_01_multiset_hash_large_table_even_multiplicity() -> None:
    """Verify tables > 5000 rows with even duplicate multiplicities do not cancel to zero."""
    conn = duckdb.connect(":memory:")
    conn.execute(
        "CREATE TABLE big_a AS SELECT i % 500 AS id, 'val_' || (i % 500) AS s FROM range(6000) t(i)"
    )
    conn.execute("CREATE TABLE big_empty (id BIGINT, s VARCHAR)")

    cfg = ComparisonConfig(primary_key=None)
    res = TabularComparator.compare_tables(conn, "big_a", "big_empty", cfg)

    assert res.baseline_row_count == 6000
    assert res.target_row_count == 0
    assert not res.is_equal
    assert res.baseline_fingerprint.multiset_hash != res.target_fingerprint.multiset_hash
    assert res.baseline_fingerprint.multiset_hash != "0" * 64


def test_p2_01_keyless_null_vs_literal_sentinel_collision() -> None:
    """Verify keyless comparison distinguishes SQL NULL from literal string '__NULL__'."""
    conn = duckdb.connect(":memory:")
    conn.execute("CREATE TABLE t_null (s VARCHAR)")
    conn.execute("CREATE TABLE t_sentinel (s VARCHAR)")
    conn.execute("INSERT INTO t_null VALUES (NULL)")
    conn.execute("INSERT INTO t_sentinel VALUES ('__NULL__')")

    res = TabularComparator.compare_tables(
        conn, "t_null", "t_sentinel", ComparisonConfig(primary_key=None)
    )

    # Must NOT collide into identical_count == 1
    assert res.identical_count == 0
    assert res.added_count == 1
    assert res.removed_count == 1
    assert not res.is_equal
    assert res.verify_partition_invariants()


def test_p2_01_keyless_delimiter_collision() -> None:
    """Verify keyless comparison prevents cross-column delimiter collisions ('||')."""
    conn = duckdb.connect(":memory:")
    conn.execute("CREATE TABLE td1 (a VARCHAR, b VARCHAR)")
    conn.execute("CREATE TABLE td2 (a VARCHAR, b VARCHAR)")
    conn.execute("INSERT INTO td1 VALUES ('x||y', 'z')")
    conn.execute("INSERT INTO td2 VALUES ('x', 'y||z')")

    res = TabularComparator.compare_tables(conn, "td1", "td2", ComparisonConfig(primary_key=None))

    assert res.identical_count == 0
    assert res.added_count == 1
    assert res.removed_count == 1
    assert not res.is_equal
    assert res.verify_partition_invariants()


def test_p2_02_compare_tables_populates_sample_diffs() -> None:
    """Verify compare_tables populates sample_row_diffs with field-level ValueDiff details."""
    conn = duckdb.connect(":memory:")
    conn.execute("CREATE TABLE t1 (id BIGINT, score DOUBLE, note VARCHAR)")
    conn.execute("CREATE TABLE t2 (id BIGINT, score DOUBLE, note VARCHAR)")

    # 1 identical, 1 modified (with null transition), 1 removed, 1 added
    conn.execute(
        "INSERT INTO t1 VALUES (1, 10.0, 'clean'), (2, 20.0, 'has_note'), (3, 30.0, 'rem')"
    )
    conn.execute(
        "INSERT INTO t2 VALUES (1, 10.0, 'clean'), (2, NULL, 'has_note'), (4, 40.0, 'add')"
    )

    res = TabularComparator.compare_tables(conn, "t1", "t2", ComparisonConfig(primary_key=["id"]))

    assert res.identical_count == 1
    assert res.modified_count == 1
    assert res.removed_count == 1
    assert res.added_count == 1
    assert len(res.sample_row_diffs) >= 1

    # Find the modified sample
    mod_sample = next(
        (s for s in res.sample_row_diffs if s.category == DiffCategory.MODIFIED), None
    )
    assert mod_sample is not None
    assert mod_sample.key_values == {"id": 2}
    assert len(mod_sample.field_diffs) == 1
    fd = mod_sample.field_diffs[0]
    assert fd.column == "score"
    assert fd.baseline_value == 20.0
    assert fd.target_value is None
    assert fd.is_null_transition is True


def test_p3_02_quote_ident_special_characters() -> None:
    """Verify identifiers with quotes and spaces are quoted without SQL syntax errors."""
    from data_rewind.comparator.engine import _quote_ident

    assert _quote_ident("simple") == '"simple"'
    assert _quote_ident('col"name') == '"col""name"'
    assert _quote_ident('weird"table"name') == '"weird""table""name"'

    # Verify execution in DuckDB with quoted column name
    conn = duckdb.connect(":memory:")
    col_name = 'user"id'
    qc = _quote_ident(col_name)
    conn.execute(f"CREATE TABLE test_quote ({qc} INT); INSERT INTO test_quote VALUES (42)")
    val = conn.execute(f"SELECT {qc} FROM test_quote").fetchone()[0]
    assert val == 42


def test_p3_03_bool_vs_numeric_equality_isolation() -> None:
    """Verify Python True == 1 / False == 0 does not falsely match across types."""
    cfg = ComparisonConfig()
    is_match_1, diff_1, _, _ = TabularComparator.compare_values(True, 1, "col_bool", cfg)
    assert not is_match_1
    assert diff_1 is not None
    assert diff_1.baseline_value is True
    assert diff_1.target_value == 1

    is_match_0, diff_0, _, _ = TabularComparator.compare_values(False, 0, "col_bool", cfg)
    assert not is_match_0
    assert diff_0 is not None

    # Matching booleans succeed
    is_match_tt, _, _, _ = TabularComparator.compare_values(True, True, "col_bool", cfg)
    assert is_match_tt

    is_match_ff, _, _, _ = TabularComparator.compare_values(False, False, "col_bool", cfg)
    assert is_match_ff
