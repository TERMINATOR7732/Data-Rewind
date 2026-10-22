"""Data Rewind DuckDB runtime abstraction and connection lifecycle management.

Conforms to Section 1 of SPEC-MOD-07 and Decision D-01.
Provides:
- Controlled connection lifecycle with automatic cleanup.
- Configurable working memory limits (SET max_memory = '256MB').
- Parameter binding for SQL injection defense.
- Transaction context management with automatic rollback on error.
- Translation of native database exceptions into structured DuckDBRuntimeError.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager, suppress
from pathlib import Path
from typing import Any

import duckdb
from pydantic import BaseModel, ConfigDict, Field

from data_rewind.core.domain.errors import DuckDBRuntimeError


class DuckDBConfig(BaseModel):
    """Configuration settings for DuckDB execution engine."""

    model_config = ConfigDict(frozen=True)

    database_path: str = ":memory:"
    max_memory_mb: int = Field(default=256, ge=16, le=65536)
    threads: int = Field(default=4, ge=1, le=64)
    temp_directory: Path | None = None
    read_only: bool = False


class DuckDBRuntime:
    """Manages an isolated DuckDB connection lifecycle and query execution."""

    def __init__(self, config: DuckDBConfig | None = None) -> None:
        self.config = config or DuckDBConfig()
        self._connection: duckdb.DuckDBPyConnection | None = None
        self._in_transaction = False

    @property
    def is_connected(self) -> bool:
        """Check whether connection is open."""
        return self._connection is not None

    def connect(self) -> None:
        """Initialize connection and apply resource configuration settings."""
        if self._connection is not None:
            return

        try:
            conn = duckdb.connect(
                database=self.config.database_path,
                read_only=self.config.read_only,
            )

            # Apply memory limit from 8-column matrix (256 MiB default)
            conn.execute(f"SET max_memory = '{self.config.max_memory_mb}MB'")
            conn.execute(f"SET threads = {self.config.threads}")

            if self.config.temp_directory:
                temp_dir = Path(self.config.temp_directory).resolve()
                temp_dir.mkdir(parents=True, exist_ok=True)
                # DuckDB expects forward slashes or escaped path
                conn.execute(f"SET temp_directory = '{temp_dir.as_posix()}'")

            self._connection = conn
        except Exception as exc:
            raise DuckDBRuntimeError(
                f"Failed to initialize DuckDB connection: {exc}",
                details={"database": self.config.database_path},
            ) from exc

    def close(self) -> None:
        """Close connection cleanly."""
        if self._connection is not None:
            try:
                self._connection.close()
            finally:
                self._connection = None
                self._in_transaction = False

    def __enter__(self) -> DuckDBRuntime:
        self.connect()
        return self

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        self.close()

    def _get_connection(self) -> duckdb.DuckDBPyConnection:
        """Ensure connection is active and return it."""
        if self._connection is None:
            self.connect()
        assert self._connection is not None
        return self._connection

    def execute_statement(
        self,
        sql: str,
        parameters: list[Any] | dict[str, Any] | None = None,
    ) -> int:
        """Execute non-query statement and return affected row count or 0."""
        conn = self._get_connection()
        try:
            cursor = conn.execute(sql, parameters) if parameters is not None else conn.execute(sql)
            return cursor.fetchall().__len__() if cursor.description else 0
        except duckdb.Error as exc:
            raise DuckDBRuntimeError(
                f"DuckDB statement execution failed: {exc}",
                details={"sql_prefix": sql[:100]},
            ) from exc

    def execute_query(
        self,
        sql: str,
        parameters: list[Any] | dict[str, Any] | None = None,
    ) -> list[tuple[Any, ...]]:
        """Execute parameterized query and return list of tuple rows."""
        conn = self._get_connection()
        try:
            if parameters is not None:
                return conn.execute(sql, parameters).fetchall()
            return conn.execute(sql).fetchall()
        except duckdb.Error as exc:
            raise DuckDBRuntimeError(
                f"DuckDB query execution failed: {exc}",
                details={"sql_prefix": sql[:100]},
            ) from exc

    def execute_query_dicts(
        self,
        sql: str,
        parameters: list[Any] | dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        """Execute parameterized query and return records as dictionaries."""
        conn = self._get_connection()
        try:
            cursor = conn.execute(sql, parameters) if parameters is not None else conn.execute(sql)

            if not cursor.description:
                return []
            col_names = [desc[0] for desc in cursor.description]
            rows = cursor.fetchall()
            return [dict(zip(col_names, row, strict=True)) for row in rows]
        except duckdb.Error as exc:
            raise DuckDBRuntimeError(
                f"DuckDB query dictionary execution failed: {exc}",
                details={"sql_prefix": sql[:100]},
            ) from exc

    def execute_scalar(
        self,
        sql: str,
        parameters: list[Any] | dict[str, Any] | None = None,
    ) -> Any:
        """Execute query expecting a single scalar return value."""
        rows = self.execute_query(sql, parameters)
        if not rows or not rows[0]:
            return None
        return rows[0][0]

    @contextmanager
    def transaction(self) -> Iterator[DuckDBRuntime]:
        """Context manager providing atomic transaction with rollback on failure."""
        conn = self._get_connection()
        if self._in_transaction:
            yield self
            return

        self._in_transaction = True
        conn.begin()
        try:
            yield self
            conn.commit()
        except Exception:
            with suppress(Exception):
                conn.rollback()
            raise
        finally:
            self._in_transaction = False
