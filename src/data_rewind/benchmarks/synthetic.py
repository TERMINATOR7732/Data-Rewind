"""Deterministic synthetic dataset generator and perturbation engine for benchmark suites.

Conforms strictly to Section 2.2 of SPEC-MOD-09:
- Mixed distributions: 30% string, 30% float, 20% integer, 10% timestamp, 10% boolean.
- Configurable row counts, column counts, null densities, and perturbation scenarios.
"""

from __future__ import annotations

from typing import Any

import duckdb

from data_rewind.benchmarks.models import BenchmarkScenarioConfig, ComparisonMode


def generate_column_schemas(col_count: int, mode: ComparisonMode) -> list[tuple[str, str]]:
    """Generate deterministic schema with required mixed type distribution.

    Distribution:
    - 30% string
    - 30% float
    - 20% integer
    - 10% timestamp
    - 10% boolean
    """
    schemas: list[tuple[str, str]] = []

    # Assign key columns first based on mode
    if mode == ComparisonMode.KEYED_PK:
        schemas.append(("id", "BIGINT"))
    elif mode == ComparisonMode.COMPOSITE_KEY:
        schemas.append(("tenant_id", "VARCHAR"))
        schemas.append(("entity_id", "BIGINT"))

    current_idx = len(schemas)
    remaining = max(0, col_count - current_idx)

    for i in range(remaining):
        col_name = f"col_{current_idx + i}"
        ratio = (i % 10) / 10.0
        if ratio < 0.3:
            col_type = "VARCHAR"
        elif ratio < 0.6:
            col_type = "DOUBLE"
        elif ratio < 0.8:
            col_type = "BIGINT"
        elif ratio < 0.9:
            col_type = "TIMESTAMP"
        else:
            col_type = "BOOLEAN"
        schemas.append((col_name, col_type))

    return schemas


def populate_benchmark_tables_duckdb(
    conn: duckdb.DuckDBPyConnection,
    config: BenchmarkScenarioConfig,
    table_a: str = "benchmark_baseline",
    table_b: str = "benchmark_target",
) -> dict[str, Any]:
    """Generate synthetic baseline and perturbed target tables directly in DuckDB.

    Uses DuckDB's native vectorized functions for high generation speed at 500k+ rows.
    Returns metadata on expected deltas for ground-truth verification.
    """
    conn.execute(f"DROP TABLE IF EXISTS {table_a}")
    conn.execute(f"DROP TABLE IF EXISTS {table_b}")

    schemas = generate_column_schemas(config.col_count, config.comparison_mode)
    n = config.row_count

    # 1. Build Base Table Generation Expression in DuckDB SQL
    select_exprs: list[str] = []
    for name, dtype in schemas:
        if name == "id":
            val_expr = "range"
        elif name == "tenant_id":
            val_expr = "concat('tenant_', cast((range % 50) as varchar))"
        elif name == "entity_id":
            val_expr = "range"
        elif dtype == "VARCHAR":
            val_expr = f"concat('text_val_', cast(range as varchar), '_', '{name}')"
        elif dtype == "DOUBLE":
            val_expr = "cast(range * 1.000314159 + 0.123 as DOUBLE)"
        elif dtype == "BIGINT":
            val_expr = "cast(range * 100 + 7 as BIGINT)"
        elif dtype == "TIMESTAMP":
            val_expr = "TIMESTAMP '2026-01-01 00:00:00' + INTERVAL (range % 86400) SECOND"
        elif dtype == "BOOLEAN":
            val_expr = "(range % 2 = 0)"
        else:
            val_expr = "cast(range as varchar)"

        # Inject nulls if null density > 0 (excluding PK columns)
        if config.null_density > 0 and name not in ("id", "tenant_id", "entity_id"):
            mod_val = max(2, int(1.0 / config.null_density))
            val_expr = f"CASE WHEN range % {mod_val} = 0 THEN NULL ELSE {val_expr} END"

        select_exprs.append(f"{val_expr} AS {name}")

    cols_sql = ",\n    ".join(select_exprs)
    conn.execute(f"CREATE TABLE {table_a} AS SELECT\n    {cols_sql}\nFROM range({n})")

    # 2. Build Perturbed Target Table
    # Calculate perturbation split
    pert_count = int(n * config.perturbation_pct)
    remove_count = int(pert_count * 0.4)
    modify_count = int(pert_count * 0.4)
    add_count = int(pert_count * 0.2)

    # Target: copy from baseline with modifications and deletions
    # Modulo condition for removals: range < remove_count
    # Modulo condition for modifications: range >= remove_count and range < (remove_count + modify_count)

    target_select_exprs: list[str] = []
    for name, dtype in schemas:
        if name in ("id", "tenant_id", "entity_id"):
            target_select_exprs.append(name)
        elif dtype == "DOUBLE":
            target_select_exprs.append(
                f"CASE WHEN __rn >= {remove_count} AND __rn < {remove_count + modify_count} "
                f"THEN {name} * 2.5 ELSE {name} END AS {name}"
            )
        elif dtype == "VARCHAR":
            target_select_exprs.append(
                f"CASE WHEN __rn >= {remove_count} AND __rn < {remove_count + modify_count} "
                f"THEN concat({name}, '_MUTATED') ELSE {name} END AS {name}"
            )
        else:
            target_select_exprs.append(name)

    t_cols_sql = ",\n    ".join(target_select_exprs)

    # Filter out the removed rows using __rn
    conn.execute(
        f"CREATE TABLE {table_b} AS SELECT\n    {t_cols_sql}\n"
        f"FROM (SELECT *, row_number() OVER () - 1 AS __rn FROM {table_a})\n"
        f"WHERE __rn >= {remove_count}"
    )

    # Add new rows if add_count > 0
    if add_count > 0:
        new_row_start = n + 1000
        new_selects: list[str] = []
        for name, dtype in schemas:
            if name == "id":
                expr = "range AS id"
            elif name == "tenant_id":
                expr = "concat('tenant_new_', cast((range % 50) as varchar)) AS tenant_id"
            elif name == "entity_id":
                expr = "range AS entity_id"
            elif dtype == "VARCHAR":
                expr = f"concat('added_text_', cast(range as varchar)) AS {name}"
            elif dtype == "DOUBLE":
                expr = f"cast(range * 3.14 as DOUBLE) AS {name}"
            elif dtype == "BIGINT":
                expr = f"cast(range * 999 as BIGINT) AS {name}"
            elif dtype == "TIMESTAMP":
                expr = f"TIMESTAMP '2026-06-01 12:00:00' + INTERVAL (range % 3600) SECOND AS {name}"
            elif dtype == "BOOLEAN":
                expr = f"(range % 3 = 0) AS {name}"
            else:
                expr = f"cast(range as varchar) AS {name}"
            new_selects.append(expr)

        new_cols_sql = ",\n    ".join(new_selects)
        conn.execute(
            f"INSERT INTO {table_b} SELECT\n    {new_cols_sql}\n"
            f"FROM range({new_row_start}, {new_row_start + add_count})"
        )

    # Reorder target rows if requested
    if config.reorder_rows:
        conn.execute(
            f"CREATE OR REPLACE TABLE {table_b} AS SELECT * FROM {table_b} ORDER BY hash({schemas[0][0]})"
        )

    res_a = conn.execute(f"SELECT count(*) FROM {table_a}").fetchone()
    res_b = conn.execute(f"SELECT count(*) FROM {table_b}").fetchone()
    assert res_a is not None and res_b is not None
    cnt_a = int(res_a[0])
    cnt_b = int(res_b[0])

    expected_identical = n - remove_count - modify_count
    expected_modified = modify_count
    expected_removed = remove_count
    expected_added = add_count

    return {
        "baseline_row_count": cnt_a,
        "target_row_count": cnt_b,
        "expected_identical": expected_identical,
        "expected_modified": expected_modified,
        "expected_removed": expected_removed,
        "expected_added": expected_added,
        "schemas": schemas,
    }
