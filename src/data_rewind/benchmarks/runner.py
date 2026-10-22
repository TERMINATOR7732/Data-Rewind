"""CLI runner and orchestrator for Data Rewind benchmark suites.

Conforms strictly to Section 2 of SPEC-MOD-09 and Section 3 of SPEC-MOD-04.
"""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from data_rewind.benchmarks.models import (
    BenchmarkScenarioConfig,
    BenchmarkScenarioReport,
    BenchmarkSuiteReport,
    ComparisonMode,
)
from data_rewind.benchmarks.protocol import execute_scenario, get_system_environment_info


def build_standard_suite_configs(quick: bool = False) -> list[BenchmarkScenarioConfig]:
    """Construct benchmark scenario configurations conforming to SPEC-MOD-09 matrix."""
    # SPEC-MOD-09 Section 2.3 mandates minimum 10 iterations for standard statistical suite
    iterations = 3 if quick else 10

    configs: list[BenchmarkScenarioConfig] = [
        # 1. Scalability progression (Keyed PK, 10 cols, 1% drift)
        BenchmarkScenarioConfig(
            name="10k_keyed_pk",
            row_count=10_000,
            col_count=10,
            comparison_mode=ComparisonMode.KEYED_PK,
            null_density=0.0,
            perturbation_pct=0.01,
            iterations=iterations,
            seed=101,
        ),
        BenchmarkScenarioConfig(
            name="50k_keyed_pk",
            row_count=50_000,
            col_count=10,
            comparison_mode=ComparisonMode.KEYED_PK,
            null_density=0.05,
            perturbation_pct=0.01,
            iterations=iterations,
            seed=102,
        ),
        BenchmarkScenarioConfig(
            name="100k_keyed_pk",
            row_count=100_000,
            col_count=10,
            comparison_mode=ComparisonMode.KEYED_PK,
            null_density=0.05,
            perturbation_pct=0.02,
            iterations=iterations,
            seed=103,
        ),
    ]

    # Include composite and keyless modes
    configs.extend(
        [
            BenchmarkScenarioConfig(
                name="10k_composite_key",
                row_count=10_000,
                col_count=10,
                comparison_mode=ComparisonMode.COMPOSITE_KEY,
                null_density=0.0,
                perturbation_pct=0.01,
                iterations=iterations,
                seed=104,
            ),
            BenchmarkScenarioConfig(
                name="10k_keyless_multiset",
                row_count=10_000,
                col_count=10,
                comparison_mode=ComparisonMode.KEYLESS_MULTISET,
                null_density=0.0,
                perturbation_pct=0.01,
                iterations=iterations,
                seed=105,
            ),
        ]
    )

    if not quick:
        # Full suite includes the 500k-row target verification scenario
        configs.append(
            BenchmarkScenarioConfig(
                name="500k_keyed_target_verification",
                row_count=500_000,
                col_count=10,
                comparison_mode=ComparisonMode.KEYED_PK,
                null_density=0.05,
                perturbation_pct=0.01,
                iterations=iterations,
                seed=500,
            )
        )

    return configs


def run_benchmarks(
    quick: bool = False,
    output_path: Path | None = None,
) -> BenchmarkSuiteReport:
    """Run benchmark suite, aggregate results, and optionally write JSON report."""
    configs = build_standard_suite_configs(quick=quick)
    system_info = get_system_environment_info()

    scenario_reports: list[BenchmarkScenarioReport] = []
    for cfg in configs:
        report = execute_scenario(cfg)
        scenario_reports.append(report)

    all_targets_met = all(
        (not r.provisional_targets_applicable) or (r.target_time_met and r.target_ram_met)
        for r in scenario_reports
    )

    summary: dict[str, Any] = {
        "total_scenarios": len(scenario_reports),
        "all_partitions_valid": all(r.all_partitions_valid for r in scenario_reports),
        "target_time_met_all": all(r.target_time_met for r in scenario_reports),
        "target_ram_met_all": all(r.target_ram_met for r in scenario_reports),
    }

    suite_report = BenchmarkSuiteReport(
        suite_name="Data Rewind Forensic Benchmark Suite (Milestone 2.0)",
        generated_at_utc=datetime.now(UTC).isoformat(),
        system_info=system_info,
        scenario_reports=scenario_reports,
        all_targets_met=all_targets_met,
        summary=summary,
    )

    if output_path is not None:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(
            suite_report.model_dump_json(indent=2),
            encoding="utf-8",
        )

    return suite_report


def format_report_table(report: BenchmarkSuiteReport) -> str:
    """Format benchmark suite report into human-readable Markdown table."""
    lines: list[str] = [
        f"# {report.suite_name}",
        f"**Generated:** {report.generated_at_utc}",
        f"**Platform:** {report.system_info.os_platform} {report.system_info.os_release} | "
        f"CPUs: {report.system_info.cpu_count_logical} | "
        f"RAM: {report.system_info.total_ram_mib} MiB | "
        f"Python: {report.system_info.python_version} | "
        f"DuckDB: {report.system_info.duckdb_version}",
        "",
        "| Scenario | Rows | Cols | Mode | Iters | p50 (ms) | p95 (ms) | Peak Delta RSS | Partitions Valid | Provisional Target |",
        "| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |",
    ]

    for s in report.scenario_reports:
        target_str = (
            ("PASS (< 1.5s, < 120MB)" if s.target_time_met and s.target_ram_met else "FAIL")
            if s.provisional_targets_applicable
            else "N/A (< 500k)"
        )
        part_str = "VALID" if s.all_partitions_valid else "INVALID"
        lines.append(
            f"| `{s.scenario_name}` | {s.row_count:,} | {s.col_count} | {s.comparison_mode.value} | "
            f"{s.iteration_count} | {s.p50_ms:.1f} ms | {s.p95_ms:.1f} ms | "
            f"{s.peak_delta_rss_mib:.1f} MiB | {part_str} | **{target_str}** |"
        )

    lines.append("")
    lines.append(
        f"**Overall Status:** {'PASS - All targets verified' if report.all_targets_met else 'FAIL - Target breached'}"
    )
    return "\n".join(lines)
