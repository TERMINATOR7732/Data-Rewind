"""Tests for Data Rewind DuckDB runtime abstraction and lifecycle."""

from __future__ import annotations

from pathlib import Path

import pytest

from data_rewind.core.db.duckdb_runtime import DuckDBConfig, DuckDBRuntime
from data_rewind.core.domain.errors import DuckDBRuntimeError


def test_duckdb_connection_lifecycle() -> None:
    """Test connecting, querying, and closing DuckDB connection."""
    config = DuckDBConfig(database_path=":memory:", max_memory_mb=64, threads=1)
    runtime = DuckDBRuntime(config)
    assert not runtime.is_connected

    runtime.connect()
    assert runtime.is_connected

    res = runtime.execute_scalar("SELECT 42")
    assert res == 42

    runtime.close()
    assert not runtime.is_connected


def test_duckdb_parameterized_queries(in_memory_duckdb: DuckDBRuntime) -> None:
    """Test SQL injection defense via parameter binding."""
    in_memory_duckdb.execute_statement(
        "CREATE TABLE items (id INTEGER, name VARCHAR, price DOUBLE)"
    )

    # Insert with parameters
    in_memory_duckdb.execute_statement(
        "INSERT INTO items VALUES (?, ?, ?)",
        [1, "SafeItem", 19.99],
    )

    # Query with parameters
    rows = in_memory_duckdb.execute_query_dicts("SELECT * FROM items WHERE name = ?", ["SafeItem"])
    assert len(rows) == 1
    assert rows[0]["id"] == 1
    assert rows[0]["price"] == 19.99

    # Empty result
    empty = in_memory_duckdb.execute_query_dicts(
        "SELECT * FROM items WHERE name = ?", ["NonExistent"]
    )
    assert empty == []


def test_duckdb_transaction_commit_and_rollback(in_memory_duckdb: DuckDBRuntime) -> None:
    """Test atomic transactions and rollback on failure."""
    in_memory_duckdb.execute_statement("CREATE TABLE ledger (entry_id INTEGER, amount DOUBLE)")

    # Successful transaction
    with in_memory_duckdb.transaction():
        in_memory_duckdb.execute_statement("INSERT INTO ledger VALUES (1, 100.0)")
        in_memory_duckdb.execute_statement("INSERT INTO ledger VALUES (2, 200.0)")

    count = in_memory_duckdb.execute_scalar("SELECT count(*) FROM ledger")
    assert count == 2

    # Failed transaction rolling back cleanly
    with pytest.raises(ValueError, match="Abort transaction"), in_memory_duckdb.transaction():
        in_memory_duckdb.execute_statement("INSERT INTO ledger VALUES (3, 300.0)")
        raise ValueError("Abort transaction")

    # Entry 3 was rolled back
    count_after_rollback = in_memory_duckdb.execute_scalar("SELECT count(*) FROM ledger")
    assert count_after_rollback == 2


def test_duckdb_invalid_sql_error_translation(in_memory_duckdb: DuckDBRuntime) -> None:
    """Test syntax and database errors wrap into structured DuckDBRuntimeError."""
    with pytest.raises(DuckDBRuntimeError) as exc_info:
        in_memory_duckdb.execute_query("SELECT FROM WHERE BAD_SYNTAX")

    assert exc_info.value.code == "DUCKDB_OPERATION_ERROR"


def test_duckdb_independent_instances_isolation() -> None:
    """Verify separate in-memory DuckDB runtimes are isolated from each other."""
    c1 = DuckDBRuntime(DuckDBConfig(database_path=":memory:"))
    c2 = DuckDBRuntime(DuckDBConfig(database_path=":memory:"))

    with c1, c2:
        c1.execute_statement("CREATE TABLE t1 (val INTEGER)")
        c1.execute_statement("INSERT INTO t1 VALUES (10)")

        # c2 should not have t1
        with pytest.raises(DuckDBRuntimeError):
            c2.execute_query("SELECT * FROM t1")


def test_duckdb_additional_coverage(temp_workspace: Path) -> None:
    """Test DuckDB edge cases: temp_directory, re-entrant transaction, scalar on empty."""
    temp_sub = temp_workspace / "duckdb_tmp"
    cfg = DuckDBConfig(database_path=":memory:", temp_directory=temp_sub)
    runtime = DuckDBRuntime(cfg)

    with runtime:
        # Re-entrant connect call does nothing
        runtime.connect()

        # Execute statement returning 0 affected when no rows
        runtime.execute_statement("CREATE TABLE dummy (x INT)")
        # Scalar on empty table returns None
        assert runtime.execute_scalar("SELECT x FROM dummy") is None

        # Re-entrant transaction
        with runtime.transaction():
            runtime.execute_statement("INSERT INTO dummy VALUES (1)")
            with runtime.transaction():
                runtime.execute_statement("INSERT INTO dummy VALUES (2)")

        assert runtime.execute_scalar("SELECT count(*) FROM dummy") == 2

        # Error translations
        with pytest.raises(DuckDBRuntimeError):
            runtime.execute_statement("INSERT INTO nonexistent_table VALUES (1)")

        with pytest.raises(DuckDBRuntimeError):
            runtime.execute_query_dicts("SELECT * FROM nonexistent_table")
