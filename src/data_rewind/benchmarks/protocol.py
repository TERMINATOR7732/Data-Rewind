"""Reproducible benchmark execution harness, memory sampler, and statistical aggregator.

Conforms strictly to Section 2 of SPEC-MOD-09:
- Measures wall-clock timing via time.perf_counter_ns().
- Samples memory via psutil.Process().memory_info().rss at 10ms intervals.
- Verifies mathematical partition completeness invariant on every iteration.
- Computes distribution statistics (Min, p50, p95, Max, Mean, StdDev).
- Evaluates against provisional 500k-row targets (< 1.5s, < 120 MiB).
"""

from __future__ import annotations

import os
import platform
import statistics
import sys
import threading
import time

import duckdb
import psutil

from data_rewind.benchmarks.models import (
    BenchmarkIterationResult,
    BenchmarkScenarioConfig,
    BenchmarkScenarioReport,
    ComparisonMode,
    SystemEnvironmentInfo,
    WarmthMode,
)
from data_rewind.benchmarks.synthetic import populate_benchmark_tables_duckdb
from data_rewind.comparator.engine import TabularComparator
from data_rewind.comparator.models import ComparisonConfig


class MemorySampler(threading.Thread):
    """Samples process RSS memory at periodic intervals during benchmark execution."""

    def __init__(self, interval_s: float = 0.01) -> None:
        super().__init__(daemon=True)
        self.interval_s = interval_s
        self.process = psutil.Process(os.getpid())
        self.stop_requested = threading.Event()
        self.samples: list[int] = []

    def run(self) -> None:
        while not self.stop_requested.is_set():
            try:
                rss = self.process.memory_info().rss
                self.samples.append(rss)
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                break
            time.sleep(self.interval_s)

    def stop(self) -> list[int]:
        self.stop_requested.set()
        self.join(timeout=1.0)
        return self.samples


def get_system_environment_info() -> SystemEnvironmentInfo:
    """Introspect hardware, operating system, and runtime software versions."""
    mem = psutil.virtual_memory()
    return SystemEnvironmentInfo(
        os_platform=platform.system(),
        os_release=platform.release(),
        cpu_count_logical=psutil.cpu_count(logical=True) or 1,
        cpu_count_physical=psutil.cpu_count(logical=False),
        total_ram_bytes=mem.total,
        total_ram_mib=round(mem.total / (1024 * 1024), 2),
        python_version=sys.version.split()[0],
        duckdb_version=duckdb.__version__,
    )


def execute_scenario(
    config: BenchmarkScenarioConfig,
) -> BenchmarkScenarioReport:
    """Execute all iterations of a benchmark scenario and compute statistical metrics."""
    conn = duckdb.connect(":memory:")

    # Populate tables
    populate_benchmark_tables_duckdb(
        conn=conn,
        config=config,
        table_a="bench_a",
        table_b="bench_b",
    )

    cmp_cfg: ComparisonConfig
    if config.comparison_mode == ComparisonMode.KEYED_PK:
        cmp_cfg = ComparisonConfig(primary_key=["id"])
    elif config.comparison_mode == ComparisonMode.COMPOSITE_KEY:
        cmp_cfg = ComparisonConfig(primary_key=["tenant_id", "entity_id"])
    else:
        cmp_cfg = ComparisonConfig(primary_key=None)

    iteration_results: list[BenchmarkIterationResult] = []
    process = psutil.Process(os.getpid())

    for i in range(config.iterations):
        warmth = WarmthMode.COLD if i == 0 else WarmthMode.WARM
        baseline_rss = process.memory_info().rss

        sampler = MemorySampler(interval_s=0.005)
        sampler.start()

        start_ns = time.perf_counter_ns()
        diff_res = TabularComparator.compare_tables(
            conn=conn,
            table_a="bench_a",
            table_b="bench_b",
            config=cmp_cfg,
        )
        end_ns = time.perf_counter_ns()

        samples = sampler.stop()
        peak_rss = max([baseline_rss] + samples)

        elapsed_ns = end_ns - start_ns
        elapsed_ms = elapsed_ns / 1_000_000.0

        baseline_rss_mib = baseline_rss / (1024 * 1024)
        peak_rss_mib = peak_rss / (1024 * 1024)
        delta_rss_mib = max(0.0, peak_rss_mib - baseline_rss_mib)

        part_valid = diff_res.verify_partition_invariants()

        iteration_results.append(
            BenchmarkIterationResult(
                iteration_index=i + 1,
                elapsed_ms=round(elapsed_ms, 3),
                elapsed_ns=elapsed_ns,
                baseline_rss_mib=round(baseline_rss_mib, 2),
                peak_rss_mib=round(peak_rss_mib, 2),
                delta_rss_mib=round(delta_rss_mib, 2),
                partition_completeness_valid=part_valid,
                identical_count=diff_res.identical_count,
                modified_count=diff_res.modified_count,
                added_count=diff_res.added_count,
                removed_count=diff_res.removed_count,
                warmth=warmth,
            )
        )

    # Statistical Aggregation
    elapsed_times = [r.elapsed_ms for r in iteration_results]
    delta_mibs = [r.delta_rss_mib for r in iteration_results]

    sorted_times = sorted(elapsed_times)
    n = len(sorted_times)
    min_ms = sorted_times[0]
    max_ms = sorted_times[-1]
    mean_ms = statistics.fmean(sorted_times)
    p50_ms = statistics.median(sorted_times)

    if n > 1:
        # 95th percentile
        p95_idx = int(0.95 * (n - 1))
        p95_ms = sorted_times[p95_idx]
        stddev_ms = statistics.stdev(sorted_times)
    else:
        p95_ms = sorted_times[0]
        stddev_ms = 0.0

    all_partitions_valid = all(r.partition_completeness_valid for r in iteration_results)

    # Check targets (provisional targets apply to 500k-row diffs per SPEC-MOD-09)
    targets_applicable = config.row_count == 500_000
    target_time_met = (p50_ms < 1500.0) if targets_applicable else True
    target_ram_met = (max(delta_mibs) < 120.0) if targets_applicable else True

    return BenchmarkScenarioReport(
        scenario_name=config.name,
        row_count=config.row_count,
        col_count=config.col_count,
        comparison_mode=config.comparison_mode,
        iteration_count=config.iterations,
        warmth=WarmthMode.WARM if config.iterations > 1 else WarmthMode.COLD,
        min_ms=round(min_ms, 3),
        p50_ms=round(p50_ms, 3),
        p95_ms=round(p95_ms, 3),
        max_ms=round(max_ms, 3),
        mean_ms=round(mean_ms, 3),
        stddev_ms=round(stddev_ms, 3),
        min_delta_rss_mib=round(min(delta_mibs), 2),
        peak_delta_rss_mib=round(max(delta_mibs), 2),
        mean_delta_rss_mib=round(statistics.fmean(delta_mibs), 2),
        all_partitions_valid=all_partitions_valid,
        target_time_met=target_time_met,
        target_ram_met=target_ram_met,
        provisional_targets_applicable=targets_applicable,
        iterations=iteration_results,
    )
