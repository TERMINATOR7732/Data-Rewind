"""Data Rewind Pipeline Step Execution and Checkpoint Materialization Engine.

Conforms strictly to Section 1.2 of SPEC-MOD-03.
Guarantees:
- Deterministic topological execution of the 7 canonical operations.
- Fail-fast error propagation with upstream checkpoint preservation.
- Parquet checkpoint materialization with content and multiset hashing.
- Zero dynamic code evaluation (eval/exec).
"""

from __future__ import annotations

import re
import time
from collections.abc import Sequence
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

from data_rewind.core.dag.validator import DAGValidator
from data_rewind.core.db.duckdb_runtime import DuckDBConfig, DuckDBRuntime
from data_rewind.core.domain.errors import (
    DataRewindError,
)
from data_rewind.core.domain.models import (
    OperationType,
    RunLifecycle,
    StepStatus,
    TransformationStep,
)
from data_rewind.core.expr.ast_sandbox import ASTSecurityValidator
from data_rewind.core.integrity.hashing import (
    compute_content_hash,
    compute_multiset_hash,
)
from data_rewind.execution.models import (
    ExecutionOptions,
    PipelineExecutionResult,
    StepExecutionResult,
)


class PipelineExecutor:
    """Executes DAG transformation pipelines with DuckDB runtime and Parquet checkpoints."""

    @classmethod
    def execute_pipeline(
        cls,
        steps: Sequence[TransformationStep],
        inputs: dict[str, Path | list[dict[str, Any]] | str],
        options: ExecutionOptions,
        run_id: UUID | None = None,
        pipeline_id: UUID | None = None,
    ) -> PipelineExecutionResult:
        """Execute all steps in topological order with Parquet checkpoints and integrity hashes."""
        actual_run_id = run_id or uuid4()
        start_time = time.perf_counter()

        # 1. Topological validation of DAG
        registered_inputs = list(inputs.keys())
        topological_order = DAGValidator.validate_and_order(list(steps), registered_inputs)
        step_dict = {s.step_id: s for s in steps}

        # 2. Setup checkpoint directory
        checkpoint_dir = options.workspace_root / "checkpoints" / str(actual_run_id)
        checkpoint_dir.mkdir(parents=True, exist_ok=True)

        # 3. Initialize DuckDB Runtime
        db_config = DuckDBConfig(
            database_path=":memory:",
            max_memory_mb=options.max_memory_mb,
        )
        runtime = DuckDBRuntime(db_config)
        runtime.connect()

        step_results: dict[str, StepExecutionResult] = {}
        failed_step_id: str | None = None
        global_error: str | None = None

        try:
            # 4. Ingest and register initial raw inputs
            for input_id, input_data in inputs.items():
                cls._register_input(runtime, input_id, input_data)

            # 5. Execute steps in topological order
            for sid in topological_order:
                step = step_dict[sid]

                # Check if any parent step failed or was skipped
                parent_failed = any(
                    step_results.get(p) and step_results[p].status != StepStatus.SUCCESS
                    for p in step.input_step_ids
                    if p in step_dict
                )

                if parent_failed:
                    step_results[sid] = StepExecutionResult(
                        step_id=sid,
                        status=StepStatus.SKIPPED,
                        error_message="Skipped due to upstream step failure.",
                    )
                    continue

                step_start = time.perf_counter()
                try:
                    # Execute transformation in DuckDB
                    cls._execute_single_step(runtime, step)

                    # Materialize to Parquet checkpoint
                    parquet_path = checkpoint_dir / f"{sid}.parquet"
                    runtime.execute_statement(
                        f"COPY \"{sid}\" TO '{parquet_path.as_posix()}' (FORMAT PARQUET)"
                    )

                    # Read back data and compute hashes
                    rows = runtime.execute_query_dicts(f'SELECT * FROM "{sid}"')
                    row_count = len(rows)
                    byte_size = parquet_path.stat().st_size
                    content_hash = compute_content_hash(parquet_path)
                    multiset_h = compute_multiset_hash(rows)

                    step_elapsed = (time.perf_counter() - step_start) * 1000.0
                    step_results[sid] = StepExecutionResult(
                        step_id=sid,
                        status=StepStatus.SUCCESS,
                        parquet_path=parquet_path,
                        content_hash=content_hash,
                        multiset_hash=multiset_h,
                        row_count=row_count,
                        byte_size=byte_size,
                        duration_ms=round(step_elapsed, 3),
                    )

                except Exception as exc:
                    step_elapsed = (time.perf_counter() - step_start) * 1000.0
                    failed_step_id = sid
                    global_error = str(exc)
                    step_results[sid] = StepExecutionResult(
                        step_id=sid,
                        status=StepStatus.FAILED,
                        duration_ms=round(step_elapsed, 3),
                        error_message=str(exc),
                    )
                    if options.fail_fast:
                        # Mark all remaining unexecuted steps as SKIPPED
                        remaining_idx = topological_order.index(sid) + 1
                        for rem_id in topological_order[remaining_idx:]:
                            step_results[rem_id] = StepExecutionResult(
                                step_id=rem_id,
                                status=StepStatus.SKIPPED,
                                error_message=f"Skipped due to failure at step '{sid}'.",
                            )
                        break

        finally:
            runtime.close()

        total_elapsed = (time.perf_counter() - start_time) * 1000.0
        overall_status = RunLifecycle.COMPLETED if failed_step_id is None else RunLifecycle.FAILED

        return PipelineExecutionResult(
            run_id=actual_run_id,
            pipeline_id=pipeline_id,
            status=overall_status,
            step_results=step_results,
            topological_order=topological_order,
            failed_step_id=failed_step_id,
            error_message=global_error,
            total_duration_ms=round(total_elapsed, 3),
        )

    @classmethod
    def _register_input(
        cls,
        runtime: DuckDBRuntime,
        input_id: str,
        input_data: Path | list[dict[str, Any]] | str,
    ) -> None:
        """Register an input artifact into DuckDB as a queryable table."""
        if isinstance(input_data, (Path, str)):
            p = Path(input_data)
            if not p.exists():
                raise DataRewindError(
                    f"Input artifact not found on disk: {p}",
                    code="INPUT_NOT_FOUND",
                )
            if p.suffix.lower() == ".csv":
                runtime.execute_statement(
                    f"CREATE TABLE \"{input_id}\" AS SELECT * FROM read_csv('{p.as_posix()}', "
                    f"header=true, auto_detect=true)"
                )
            elif p.suffix.lower() in (".parquet", ".pq"):
                runtime.execute_statement(
                    f"CREATE TABLE \"{input_id}\" AS SELECT * FROM read_parquet('{p.as_posix()}')"
                )
            else:
                raise DataRewindError(
                    f"Unsupported input file format: {p.suffix}",
                    code="UNSUPPORTED_FORMAT",
                )
        elif isinstance(input_data, list):
            # In-memory list of dict records
            if not input_data:
                runtime.execute_statement(f'CREATE TABLE "{input_id}" (dummy_col VARCHAR)')
                runtime.execute_statement(f'DELETE FROM "{input_id}"')
                return

            # Determine schema types from first record
            first = input_data[0]
            col_defs: list[str] = []
            for col, val in first.items():
                if isinstance(val, int) and not isinstance(val, bool):
                    t = "BIGINT"
                elif isinstance(val, float):
                    t = "DOUBLE"
                elif isinstance(val, bool):
                    t = "BOOLEAN"
                else:
                    t = "VARCHAR"
                col_defs.append(f'"{col}" {t}')

            runtime.execute_statement(f'CREATE TABLE "{input_id}" ({", ".join(col_defs)})')
            # Insert values using parameter binding
            col_names = list(first.keys())
            placeholders = ", ".join(["?"] * len(col_names))
            insert_sql = f'INSERT INTO "{input_id}" VALUES ({placeholders})'
            for row in input_data:
                values = [row.get(c) for c in col_names]
                runtime.execute_statement(insert_sql, values)
        else:
            raise DataRewindError(
                f"Unsupported input data type: {type(input_data)}",
                code="INVALID_INPUT_TYPE",
            )

    @classmethod
    def _execute_single_step(
        cls,
        runtime: DuckDBRuntime,
        step: TransformationStep,
    ) -> None:
        """Execute one canonical transformation step in DuckDB without eval/exec."""
        sid = step.step_id
        op = step.operation_type
        params = step.parameters
        inputs = step.input_step_ids

        if op == OperationType.FILTER_ROWS:
            in_table = inputs[0]
            predicate = params.get("predicate", "")
            # Security validate predicate with AST sandbox
            ASTSecurityValidator.validate(predicate)
            # Safe SQL conversion of Python syntax (== -> =)
            sql_predicate = cls._convert_python_expr_to_sql(predicate)
            runtime.execute_statement(
                f'CREATE TABLE "{sid}" AS SELECT * FROM "{in_table}" WHERE {sql_predicate}'
            )

        elif op == OperationType.DERIVE_COLUMN:
            in_table = inputs[0]
            target_col = params.get("target_column")
            expression = params.get("expression", "")
            if not target_col:
                raise DataRewindError(
                    f"derive_column requires 'target_column' parameter in step '{sid}'",
                    code="MISSING_PARAMETER",
                )
            ASTSecurityValidator.validate(expression)
            sql_expr = cls._convert_python_expr_to_sql(expression)
            runtime.execute_statement(
                f'CREATE TABLE "{sid}" AS SELECT *, ({sql_expr}) AS "{target_col}" '
                f'FROM "{in_table}"'
            )

        elif op == OperationType.JOIN_DATASETS:
            left_table = inputs[0]
            right_table = inputs[1]
            join_type = params.get("join_type", "inner").upper()
            allowed_joins = {"INNER", "LEFT", "RIGHT", "FULL", "CROSS", "SEMI", "ANTI"}
            if join_type not in allowed_joins:
                raise DataRewindError(
                    f"Invalid join_type '{join_type}' in step '{sid}'. Allowed: {sorted(allowed_joins)}",
                    code="INVALID_JOIN_TYPE",
                )
            join_keys = params.get("join_keys", [])
            on_clause = params.get("on")

            if on_clause:
                cond_str = str(on_clause)
                if ";" in cond_str or "--" in cond_str or "/*" in cond_str:
                    raise DataRewindError(
                        f"Disallowed SQL comment or statement termination in join condition in step '{sid}'",
                        code="UNSAFE_JOIN_CONDITION",
                    )
                cond = cond_str
            elif join_keys:
                if isinstance(join_keys, list):
                    cond = " AND ".join(f't1."{k}" = t2."{k}"' for k in join_keys)
                else:
                    raise DataRewindError(
                        f"Invalid join_keys format in step '{sid}'",
                        code="INVALID_JOIN_KEYS",
                    )
            else:
                raise DataRewindError(
                    f"join_datasets requires 'join_keys' or 'on' in step '{sid}'",
                    code="MISSING_JOIN_KEYS",
                )

            # Deduplicate schema column names for clean join
            runtime.execute_statement(
                f'CREATE TABLE "{sid}" AS SELECT t1.*, t2.* EXCLUDE ({", ".join(f'"{k}"' for k in join_keys)}) '
                f'FROM "{left_table}" AS t1 {join_type} JOIN "{right_table}" AS t2 ON {cond}'
                if join_keys
                else f'CREATE TABLE "{sid}" AS SELECT t1.*, t2.* '
                f'FROM "{left_table}" AS t1 {join_type} JOIN "{right_table}" AS t2 ON {cond}'
            )

        elif op == OperationType.AGGREGATE_GROUP_BY:
            in_table = inputs[0]
            group_by_cols = params.get("group_by_columns", [])
            aggs = params.get("aggregations", {})

            agg_pattern = re.compile(
                r"^(SUM|AVG|COUNT|MIN|MAX|MEDIAN|STDDEV|VARIANCE|FIRST|LAST)\s*\(\s*(DISTINCT\s+)?([a-zA-Z0-9_\"`]+|\*)\s*\)$",
                re.IGNORECASE,
            )
            select_parts: list[str] = [f'"{c}"' for c in group_by_cols]
            for alias, agg_expr in aggs.items():
                clean_expr = str(agg_expr).strip()
                if not agg_pattern.match(clean_expr):
                    raise DataRewindError(
                        f"Disallowed or invalid aggregate expression '{agg_expr}' in step '{sid}'.",
                        code="INVALID_AGGREGATE_EXPRESSION",
                    )
                clean_alias = str(alias).replace('"', '""')
                select_parts.append(f'{clean_expr} AS "{clean_alias}"')

            group_clause = (
                f"GROUP BY {', '.join(f'"{c}"' for c in group_by_cols)}" if group_by_cols else ""
            )
            runtime.execute_statement(
                f'CREATE TABLE "{sid}" AS SELECT {", ".join(select_parts)} '
                f'FROM "{in_table}" {group_clause}'
            )

        elif op == OperationType.DEDUPLICATE_ROWS:
            in_table = inputs[0]
            subset_cols = params.get("subset_columns", [])
            if subset_cols:
                cols_str = ", ".join(f'"{c}"' for c in subset_cols)
                runtime.execute_statement(
                    f'CREATE TABLE "{sid}" AS SELECT DISTINCT ON ({cols_str}) * FROM "{in_table}"'
                )
            else:
                runtime.execute_statement(
                    f'CREATE TABLE "{sid}" AS SELECT DISTINCT * FROM "{in_table}"'
                )

        elif op == OperationType.CAST_COLUMNS:
            in_table = inputs[0]
            target_types = params.get("target_types", {})
            if not target_types:
                runtime.execute_statement(f'CREATE TABLE "{sid}" AS SELECT * FROM "{in_table}"')
                return

            allowed_types = {
                "BIGINT",
                "BOOLEAN",
                "DATE",
                "DOUBLE",
                "FLOAT",
                "HUGEINT",
                "INTEGER",
                "INT",
                "SMALLINT",
                "TIMESTAMP",
                "TIMESTAMP WITH TIME ZONE",
                "TINYINT",
                "UBIGINT",
                "UINTEGER",
                "USMALLINT",
                "UTINYINT",
                "VARCHAR",
                "TEXT",
                "DECIMAL",
                "NUMERIC",
                "TIME",
            }
            for col_name, t_type in target_types.items():
                base_type = str(t_type).strip().upper().split("(")[0].strip()
                if base_type not in allowed_types:
                    raise DataRewindError(
                        f"Disallowed or unknown cast target type '{t_type}' for column '{col_name}' in step '{sid}'",
                        code="INVALID_CAST_TYPE",
                    )

            cast_cols = list(target_types.keys())
            cast_parts = [f'CAST("{col}" AS {target_types[col]}) AS "{col}"' for col in cast_cols]
            exclude_clause = f"EXCLUDE ({', '.join(f'"{c}"' for c in cast_cols)})"
            runtime.execute_statement(
                f'CREATE TABLE "{sid}" AS SELECT * {exclude_clause}, {", ".join(cast_parts)} '
                f'FROM "{in_table}"'
            )

        elif op == OperationType.SORT_ROWS:
            in_table = inputs[0]
            sort_cols = params.get("sort_columns", [])
            order_parts: list[str] = []
            for item in sort_cols:
                if isinstance(item, str):
                    order_parts.append(f'"{item}" ASC')
                elif isinstance(item, dict):
                    col = item.get("column")
                    asc = item.get("ascending", True)
                    order_parts.append(f'"{col}" {"ASC" if asc else "DESC"}')

            order_clause = f"ORDER BY {', '.join(order_parts)}" if order_parts else ""
            runtime.execute_statement(
                f'CREATE TABLE "{sid}" AS SELECT * FROM "{in_table}" {order_clause}'
            )

        else:
            raise DataRewindError(
                f"Unsupported operation type: {op}",
                code="UNSUPPORTED_OPERATION",
            )

    @staticmethod
    def _convert_python_expr_to_sql(expr: str) -> str:
        """Safely translate Python comparison/logical tokens into SQL tokens."""
        # Replace == with = (preserving !=, <=, >=)
        sql = re.sub(r"(?<![!<>])={2}(?!=)", " = ", expr)
        # Replace and/or/not when used as boolean operators
        sql = re.sub(r"\band\b", " AND ", sql)
        sql = re.sub(r"\bor\b", " OR ", sql)
        sql = re.sub(r"\bnot\b", " NOT ", sql)
        sql = re.sub(r"\bNone\b", "NULL", sql)
        return sql
