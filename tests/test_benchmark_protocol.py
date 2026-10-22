"""Comprehensive unit and integration tests for Data Rewind Benchmark Protocol.

Conforms strictly to Section 2 of SPEC-MOD-09 and Section 3 of SPEC-MOD-04.
"""

from __future__ import annotations

import duckdb

from data_rewind.benchmarks.models import (
    BenchmarkScenarioConfig,
    ComparisonMode,
    WarmthMode,
)
from data_rewind.benchmarks.protocol import (
    MemorySampler,
    execute_scenario,
    get_system_environment_info,
)
from data_rewind.benchmarks.runner import (
    build_standard_suite_configs,
    format_report_table,
    run_benchmarks,
)
from data_rewind.benchmarks.synthetic import (
    generate_column_schemas,
    populate_benchmark_tables_duckdb,
)


def test_generate_column_schemas_distribution() -> None:
    schemas = generate_column_schemas(col_count=10, mode=ComparisonMode.KEYED_PK)
    assert len(schemas) == 10
    assert schemas[0] == ("id", "BIGINT")

    # Composite key schema check
    comp_schemas = generate_column_schemas(col_count=10, mode=ComparisonMode.COMPOSITE_KEY)
    assert len(comp_schemas) == 10
    assert comp_schemas[0] == ("tenant_id", "VARCHAR")
    assert comp_schemas[1] == ("entity_id", "BIGINT")


def test_populate_benchmark_tables_duckdb() -> None:
    conn = duckdb.connect(":memory:")
    cfg = BenchmarkScenarioConfig(
        name="test_1k",
        row_count=1_000,
        col_count=10,
        comparison_mode=ComparisonMode.KEYED_PK,
        null_density=0.1,
        perturbation_pct=0.05,
    )
    meta = populate_benchmark_tables_duckdb(conn, cfg, "t_a", "t_b")

    assert meta["baseline_row_count"] == 1_000
    # Expected perturbation deltas
    assert (
        meta["expected_identical"] + meta["expected_modified"] + meta["expected_removed"] == 1_000
    )
    assert (
        meta["expected_identical"] + meta["expected_modified"] + meta["expected_added"]
        == meta["target_row_count"]
    )

    # Verify tables actually exist in DuckDB
    cnt_a = conn.execute("SELECT count(*) FROM t_a").fetchone()[0]
    cnt_b = conn.execute("SELECT count(*) FROM t_b").fetchone()[0]
    assert cnt_a == 1_000
    assert cnt_b == meta["target_row_count"]


def test_memory_sampler() -> None:
    sampler = MemorySampler(interval_s=0.005)
    sampler.start()
    # Allocate small buffer to ensure sample capture
    dummy = list(range(50_000))
    del dummy
    samples = sampler.stop()

    assert isinstance(samples, list)
    assert len(samples) >= 1
    assert all(s > 0 for s in samples)


def test_get_system_environment_info() -> None:
    info = get_system_environment_info()
    assert info.os_platform != ""
    assert info.cpu_count_logical >= 1
    assert info.total_ram_bytes > 0
    assert info.total_ram_mib > 0
    assert info.python_version != ""
    assert info.duckdb_version != ""


def test_execute_scenario_keyed() -> None:
    cfg = BenchmarkScenarioConfig(
        name="unit_test_scenario",
        row_count=500,
        col_count=5,
        comparison_mode=ComparisonMode.KEYED_PK,
        iterations=2,
    )
    report = execute_scenario(cfg)

    assert report.scenario_name == "unit_test_scenario"
    assert report.row_count == 500
    assert report.iteration_count == 2
    assert report.all_partitions_valid
    assert report.min_ms > 0
    assert report.p50_ms >= report.min_ms
    assert len(report.iterations) == 2
    assert report.iterations[0].warmth == WarmthMode.COLD
    assert report.iterations[1].warmth == WarmthMode.WARM


def test_build_standard_suite_configs() -> None:
    quick_configs = build_standard_suite_configs(quick=True)
    assert len(quick_configs) == 5
    assert quick_configs[0].iterations == 3
    assert not any(c.row_count == 500_000 for c in quick_configs)

    full_configs = build_standard_suite_configs(quick=False)
    assert len(full_configs) == 6
    assert full_configs[0].iterations == 10
    assert any(c.row_count == 500_000 for c in full_configs)


def test_run_benchmarks_quick_and_formatting(tmp_path) -> None:
    report_file = tmp_path / "benchmark_test.json"
    suite_report = run_benchmarks(quick=True, output_path=report_file)

    assert suite_report.suite_name != ""
    assert len(suite_report.scenario_reports) == 5
    assert suite_report.all_targets_met
    assert report_file.exists()

    table_md = format_report_table(suite_report)
    assert "Data Rewind Forensic Benchmark Suite" in table_md
    assert "Peak Delta RSS" in table_md
    assert "PASS - All targets verified" in table_md
