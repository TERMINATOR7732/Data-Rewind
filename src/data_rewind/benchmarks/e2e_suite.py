"""End-to-End Performance, Memory, and Scalability Benchmark Suite.

Conforms to Milestone 6.0 Workstream B, SPEC-MOD-09, and SPEC-MOD-04:
- CSV Ingestion throughput (1k, 10k, 50k rows) and peak RSS.
- Tabular Keyed Comparison (10k, 50k, 100k, 500k rows) across drift types.
- Tabular Keyless Comparison (10k rows with duplicates and reordering).
- Full Pipeline Execution (multi-step DAG with DuckDB checkpoints).
- Historical Replay & Manifest Verification (matching vs tampered/missing).
- Tri-Run Fix Verification (clean vs unresolved).
- Strict budget validation:
  * Total Process Peak RSS < 512 MiB across all operations.
  * 500k Row Comparison Delta RSS < 120 MiB.
  * 500k Row Comparison Latency < 1,500 ms (provisional target).
  * 100% Partition Completeness across all tabular comparisons.
- Emits benchmarks/output/benchmark_report.json and benchmarks/output/benchmark_report.md.
"""

from __future__ import annotations

import csv
import os
import tempfile
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

import duckdb
import psutil
from pydantic import BaseModel, Field

from data_rewind.benchmarks.models import (
    BenchmarkScenarioConfig,
    ComparisonMode,
    SystemEnvironmentInfo,
)
from data_rewind.benchmarks.protocol import MemorySampler, get_system_environment_info
from data_rewind.benchmarks.synthetic import populate_benchmark_tables_duckdb
from data_rewind.comparator.engine import TabularComparator
from data_rewind.comparator.models import ComparisonConfig
from data_rewind.core.domain.models import OperationType, TransformationStep
from data_rewind.core.integrity.hashing import compute_content_hash, compute_multiset_hash
from data_rewind.core.integrity.manifest import ManifestInput
from data_rewind.execution.engine import PipelineExecutor
from data_rewind.execution.models import ExecutionOptions
from data_rewind.replay.manifest_generator import generate_replay_manifest
from data_rewind.replay.models import ReplayOutcome
from data_rewind.replay.replayer import HistoricalReplayer
from data_rewind.scenarios.runner import ScenarioRunner
from data_rewind.verification.models import VerificationVerdict


class OperationMetric(BaseModel):
    name: str
    category: str
    elapsed_ms: float
    peak_rss_mib: float
    delta_rss_mib: float
    details: dict[str, Any] = Field(default_factory=dict)
    passed_budget: bool = True


class E2EBenchmarkReport(BaseModel):
    suite_title: str
    generated_at_utc: str
    system_info: SystemEnvironmentInfo
    operations: list[OperationMetric]
    budget_checks: dict[str, Any]
    all_budgets_passed: bool


def benchmark_csv_ingestion(quick: bool = False) -> list[OperationMetric]:
    """Benchmark CSV Ingestion across 1k, 10k, and 50k rows."""
    row_counts = [1_000, 10_000] if quick else [1_000, 10_000, 50_000]
    metrics: list[OperationMetric] = []
    process = psutil.Process(os.getpid())

    for count in row_counts:
        # Generate temporary CSV file
        with tempfile.NamedTemporaryFile(
            suffix=".csv", mode="w", newline="", encoding="utf-8", delete=False
        ) as f:
            writer = csv.writer(f)
            writer.writerow(["id", "tenant", "amount", "status", "created_date"])
            for i in range(count):
                writer.writerow(
                    [i, f"tenant_{i % 20}", round(10.5 * (i % 100), 2), "ACTIVE", "2026-01-01"]
                )
            f_path = Path(f.name)

        try:
            byte_size = f_path.stat().st_size
            baseline_rss = process.memory_info().rss
            sampler = MemorySampler(interval_s=0.005)
            sampler.start()

            start_ns = time.perf_counter_ns()
            conn = duckdb.connect(":memory:")
            conn.execute(
                f"CREATE TABLE ingested AS SELECT * FROM read_csv_auto('{f_path.as_posix()}', header=true);"
            )
            row_tuple = conn.execute("SELECT count(*) FROM ingested;").fetchone()
            row_res = row_tuple[0] if row_tuple is not None else 0
            conn.close()
            end_ns = time.perf_counter_ns()

            samples = sampler.stop()
            peak_rss = max([baseline_rss] + samples)
            elapsed_ms = (end_ns - start_ns) / 1_000_000.0
            throughput = (count / (elapsed_ms / 1000.0)) if elapsed_ms > 0 else 0.0

            baseline_mib = baseline_rss / (1024 * 1024)
            peak_mib = peak_rss / (1024 * 1024)
            delta_mib = max(0.0, peak_mib - baseline_mib)

            metrics.append(
                OperationMetric(
                    name=f"csv_ingestion_{count // 1000}k",
                    category="CSV Ingestion",
                    elapsed_ms=round(elapsed_ms, 2),
                    peak_rss_mib=round(peak_mib, 2),
                    delta_rss_mib=round(delta_mib, 2),
                    details={
                        "row_count": count,
                        "byte_size": byte_size,
                        "throughput_rows_sec": round(throughput, 1),
                        "rows_verified": row_res == count,
                    },
                    passed_budget=peak_mib < 512.0,
                )
            )
        finally:
            f_path.unlink(missing_ok=True)

    return metrics


def benchmark_keyed_comparison(quick: bool = False) -> list[OperationMetric]:
    """Benchmark Tabular Keyed Comparison across 10k, 50k, 100k, and 500k rows."""
    row_counts = [10_000, 50_000] if quick else [10_000, 50_000, 100_000, 500_000]
    metrics: list[OperationMetric] = []
    process = psutil.Process(os.getpid())

    for count in row_counts:
        conn = duckdb.connect(":memory:")
        cfg = BenchmarkScenarioConfig(
            name=f"keyed_{count // 1000}k",
            row_count=count,
            col_count=10,
            comparison_mode=ComparisonMode.KEYED_PK,
            null_density=0.05,
            perturbation_pct=0.02,
            seed=42 + count,
        )
        populate_benchmark_tables_duckdb(conn, cfg, "t_a", "t_b")

        cmp_cfg = ComparisonConfig(primary_key=["id"])

        baseline_rss = process.memory_info().rss
        sampler = MemorySampler(interval_s=0.005)
        sampler.start()

        start_ns = time.perf_counter_ns()
        diff_res = TabularComparator.compare_tables(conn, "t_a", "t_b", config=cmp_cfg)
        end_ns = time.perf_counter_ns()

        samples = sampler.stop()
        conn.close()

        peak_rss = max([baseline_rss] + samples)
        elapsed_ms = (end_ns - start_ns) / 1_000_000.0

        baseline_mib = baseline_rss / (1024 * 1024)
        peak_mib = peak_rss / (1024 * 1024)
        delta_mib = max(0.0, peak_mib - baseline_mib)
        partitions_valid = diff_res.verify_partition_invariants()

        passed_budget = (
            peak_mib < 512.0
            and partitions_valid
            and (delta_mib < 120.0 if count == 500_000 else True)
            and (elapsed_ms < 1500.0 if count == 500_000 else True)
        )

        metrics.append(
            OperationMetric(
                name=f"keyed_comparison_{count // 1000}k",
                category="Tabular Keyed Comparison",
                elapsed_ms=round(elapsed_ms, 2),
                peak_rss_mib=round(peak_mib, 2),
                delta_rss_mib=round(delta_mib, 2),
                details={
                    "row_count": count,
                    "col_count": 10,
                    "identical": diff_res.identical_count,
                    "modified": diff_res.modified_count,
                    "added": diff_res.added_count,
                    "removed": diff_res.removed_count,
                    "partitions_valid": partitions_valid,
                },
                passed_budget=passed_budget,
            )
        )

    return metrics


def benchmark_keyless_comparison() -> list[OperationMetric]:
    """Benchmark Tabular Keyless Comparison (10k rows with duplicates and reordering)."""
    process = psutil.Process(os.getpid())
    count = 10_000
    conn = duckdb.connect(":memory:")
    cfg = BenchmarkScenarioConfig(
        name="keyless_10k",
        row_count=count,
        col_count=10,
        comparison_mode=ComparisonMode.KEYLESS_MULTISET,
        null_density=0.05,
        perturbation_pct=0.02,
        reorder_rows=True,
        duplicate_key_pct=0.05,
        seed=105,
    )
    populate_benchmark_tables_duckdb(conn, cfg, "t_a", "t_b")
    cmp_cfg = ComparisonConfig(primary_key=None)

    baseline_rss = process.memory_info().rss
    sampler = MemorySampler(interval_s=0.005)
    sampler.start()

    start_ns = time.perf_counter_ns()
    diff_res = TabularComparator.compare_tables(conn, "t_a", "t_b", config=cmp_cfg)
    end_ns = time.perf_counter_ns()

    samples = sampler.stop()
    conn.close()

    peak_rss = max([baseline_rss] + samples)
    elapsed_ms = (end_ns - start_ns) / 1_000_000.0
    baseline_mib = baseline_rss / (1024 * 1024)
    peak_mib = peak_rss / (1024 * 1024)
    delta_mib = max(0.0, peak_mib - baseline_mib)
    partitions_valid = diff_res.verify_partition_invariants()

    return [
        OperationMetric(
            name="keyless_multiset_10k",
            category="Tabular Keyless Comparison",
            elapsed_ms=round(elapsed_ms, 2),
            peak_rss_mib=round(peak_mib, 2),
            delta_rss_mib=round(delta_mib, 2),
            details={
                "row_count": count,
                "reordered": True,
                "duplicates_present": True,
                "identical": diff_res.identical_count,
                "modified": diff_res.modified_count,
                "added": diff_res.added_count,
                "removed": diff_res.removed_count,
                "partitions_valid": partitions_valid,
            },
            passed_budget=peak_mib < 512.0 and partitions_valid,
        )
    ]


def benchmark_pipeline_execution() -> list[OperationMetric]:
    """Benchmark full DAG pipeline execution with DuckDB checkpoints."""
    process = psutil.Process(os.getpid())
    scenario = ScenarioRunner.get_available_scenarios()[0]  # SCN-01 (1,000 orders)

    with tempfile.TemporaryDirectory() as tmp_dir:
        root = Path(tmp_dir)
        options = ExecutionOptions(
            workspace_root=root,
            fail_fast=True,
            export_intermediate_checkpoints=True,
        )

        baseline_rss = process.memory_info().rss
        sampler = MemorySampler(interval_s=0.005)
        sampler.start()

        start_ns = time.perf_counter_ns()
        result = PipelineExecutor.execute_pipeline(
            steps=scenario.steps,
            inputs=scenario.baseline_inputs,  # type: ignore[arg-type]
            options=options,
            run_id=uuid4(),
        )
        end_ns = time.perf_counter_ns()

        samples = sampler.stop()
        peak_rss = max([baseline_rss] + samples)
        elapsed_ms = (end_ns - start_ns) / 1_000_000.0

        baseline_mib = baseline_rss / (1024 * 1024)
        peak_mib = peak_rss / (1024 * 1024)
        delta_mib = max(0.0, peak_mib - baseline_mib)

        step_latencies = {s.step_id: round(s.duration_ms, 2) for s in result.step_results.values()}

        return [
            OperationMetric(
                name="pipeline_execution_dag",
                category="Full Pipeline Execution",
                elapsed_ms=round(elapsed_ms, 2),
                peak_rss_mib=round(peak_mib, 2),
                delta_rss_mib=round(delta_mib, 2),
                details={
                    "step_count": len(scenario.steps),
                    "total_rows_processed": sum(s.row_count for s in result.step_results.values()),
                    "step_latencies_ms": step_latencies,
                    "checkpoints_written": len(result.step_results),
                },
                passed_budget=peak_mib < 512.0 and result.status.value == "COMPLETED",
            )
        ]


def benchmark_replay_and_manifest() -> list[OperationMetric]:
    """Benchmark Historical Replay and Manifest Verification (matching vs tampered)."""
    process = psutil.Process(os.getpid())

    with tempfile.TemporaryDirectory() as tmp_dir:
        root = Path(tmp_dir)
        raw_dir = root / "raw_inputs"
        raw_dir.mkdir(parents=True, exist_ok=True)
        (root / "artifacts").mkdir(parents=True, exist_ok=True)

        orders_csv = raw_dir / "temp_orders.csv"
        rows = [
            {
                "order_id": i,
                "status": "COMPLETED" if i % 2 == 0 else "PENDING",
                "amount": float(i * 10),
            }
            for i in range(100)
        ]
        with open(orders_csv, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=["order_id", "status", "amount"])
            writer.writeheader()
            writer.writerows(rows)

        c_hash = compute_content_hash(orders_csv)
        m_hash = compute_multiset_hash(rows)
        pinned_csv = raw_dir / f"{c_hash}.csv"
        orders_csv.replace(pinned_csv)

        steps = [
            TransformationStep(
                step_id="filter_completed",
                operation_type=OperationType.FILTER_ROWS,
                input_step_ids=["raw_orders"],
                parameters={"predicate": "status == 'COMPLETED'"},
            )
        ]

        manifest = generate_replay_manifest(
            run_id=uuid4(),
            pipeline_version_id=uuid4(),
            pipeline_definition_hash="0" * 64,
            inputs=[
                ManifestInput(
                    input_id="raw_orders",
                    version_id=uuid4(),
                    content_hash=c_hash,
                    multiset_hash=m_hash,
                    row_count=len(rows),
                    byte_size=pinned_csv.stat().st_size,
                )
            ],
            steps=steps,
        )

        completed_rows = [r for r in rows if r["status"] == "COMPLETED"]
        expected_step_hash = compute_multiset_hash(completed_rows)

        # 1. Clean Replay
        baseline_rss = process.memory_info().rss
        sampler = MemorySampler(interval_s=0.005)
        sampler.start()

        start_ns = time.perf_counter_ns()
        clean_replay = HistoricalReplayer.replay_run(
            manifest=manifest,
            workspace_root=root,
            historical_step_hashes={"filter_completed": expected_step_hash},
        )
        end_ns = time.perf_counter_ns()
        samples = sampler.stop()

        peak_rss = max([baseline_rss] + samples)
        elapsed_ms = (end_ns - start_ns) / 1_000_000.0
        peak_mib = peak_rss / (1024 * 1024)
        delta_mib = max(0.0, peak_mib - (baseline_rss / (1024 * 1024)))

        # 2. Tampered Replay (corrupt pinned input file)
        raw_bytes = bytearray(pinned_csv.read_bytes())
        raw_bytes[0] ^= 0xFF
        pinned_csv.write_bytes(raw_bytes)

        tampered_replay = HistoricalReplayer.replay_run(
            manifest=manifest,
            workspace_root=root,
            historical_step_hashes={"filter_completed": expected_step_hash},
        )
        tamper_detected = tampered_replay.outcome in (
            ReplayOutcome.BLOCKED_MISSING_ARTIFACTS,
            ReplayOutcome.DIVERGENT,
            ReplayOutcome.FAILED_VERIFICATION,
        )

        pinned_csv.unlink(missing_ok=True)

        return [
            OperationMetric(
                name="manifest_replay_and_tamper_detection",
                category="Historical Replay & Manifest Verification",
                elapsed_ms=round(elapsed_ms, 2),
                peak_rss_mib=round(peak_mib, 2),
                delta_rss_mib=round(delta_mib, 2),
                details={
                    "clean_replay_outcome": clean_replay.outcome.value,
                    "reproducible_verified": clean_replay.outcome == ReplayOutcome.REPRODUCIBLE,
                    "tamper_detected": tamper_detected,
                    "tamper_outcome": tampered_replay.outcome.value,
                },
                passed_budget=(
                    peak_mib < 512.0
                    and clean_replay.outcome == ReplayOutcome.REPRODUCIBLE
                    and tamper_detected
                ),
            )
        ]


def benchmark_tri_run_verification() -> list[OperationMetric]:
    """Benchmark Tri-Run Fix Verification (clean verification vs regression unresolved)."""
    process = psutil.Process(os.getpid())
    metrics: list[OperationMetric] = []

    with tempfile.TemporaryDirectory() as tmp_dir:
        root = Path(tmp_dir)

        # 1. Clean Fix Verification
        baseline_rss = process.memory_info().rss
        sampler = MemorySampler(interval_s=0.005)
        sampler.start()

        start_ns = time.perf_counter_ns()
        clean_dossier = ScenarioRunner.verify_scenario_fix(
            scenario_id="scn01",
            workspace_root=root,
            fix_mode="clean",
        )
        end_ns = time.perf_counter_ns()
        samples = sampler.stop()

        peak_rss = max([baseline_rss] + samples)
        clean_ms = (end_ns - start_ns) / 1_000_000.0
        peak_mib = peak_rss / (1024 * 1024)
        delta_mib = max(0.0, peak_mib - (baseline_rss / (1024 * 1024)))

        clean_verdict_ok = clean_dossier.verification.verdict == VerificationVerdict.VERIFIED_CLEAN

        metrics.append(
            OperationMetric(
                name="tri_run_verification_clean",
                category="Tri-Run Fix Verification",
                elapsed_ms=round(clean_ms, 2),
                peak_rss_mib=round(peak_mib, 2),
                delta_rss_mib=round(delta_mib, 2),
                details={
                    "verdict": clean_dossier.verification.verdict.value,
                    "expected_verdict": VerificationVerdict.VERIFIED_CLEAN.value,
                    "verdict_correct": clean_verdict_ok,
                    "evidence_count": len(clean_dossier.verification.evidence_chain),
                },
                passed_budget=peak_mib < 512.0 and clean_verdict_ok,
            )
        )

        # 2. Unresolved Regression Verification
        baseline_rss = process.memory_info().rss
        sampler = MemorySampler(interval_s=0.005)
        sampler.start()

        start_ns = time.perf_counter_ns()
        unres_dossier = ScenarioRunner.verify_scenario_fix(
            scenario_id="scn01",
            workspace_root=root,
            fix_mode="unresolved",
        )
        end_ns = time.perf_counter_ns()
        samples = sampler.stop()

        peak_rss = max([baseline_rss] + samples)
        unres_ms = (end_ns - start_ns) / 1_000_000.0
        peak_mib = peak_rss / (1024 * 1024)
        delta_mib = max(0.0, peak_mib - (baseline_rss / (1024 * 1024)))

        unres_verdict_ok = (
            unres_dossier.verification.verdict == VerificationVerdict.REGRESSION_UNRESOLVED
        )

        metrics.append(
            OperationMetric(
                name="tri_run_verification_unresolved",
                category="Tri-Run Fix Verification",
                elapsed_ms=round(unres_ms, 2),
                peak_rss_mib=round(peak_mib, 2),
                delta_rss_mib=round(delta_mib, 2),
                details={
                    "verdict": unres_dossier.verification.verdict.value,
                    "expected_verdict": VerificationVerdict.REGRESSION_UNRESOLVED.value,
                    "verdict_correct": unres_verdict_ok,
                    "evidence_count": len(unres_dossier.verification.evidence_chain),
                },
                passed_budget=peak_mib < 512.0 and unres_verdict_ok,
            )
        )

    return metrics


def execute_full_benchmark_suite(
    quick: bool = False,
    output_dir: Path | None = None,
) -> E2EBenchmarkReport:
    """Execute end-to-end performance and memory benchmark suite across all 6 operational categories."""
    sys_info = get_system_environment_info()
    operations: list[OperationMetric] = []

    # 1. CSV Ingestion
    operations.extend(benchmark_csv_ingestion(quick=quick))

    # 2. Tabular Keyed Comparison
    operations.extend(benchmark_keyed_comparison(quick=quick))

    # 3. Tabular Keyless Comparison
    operations.extend(benchmark_keyless_comparison())

    # 4. Full Pipeline Execution
    operations.extend(benchmark_pipeline_execution())

    # 5. Historical Replay & Manifest Verification
    operations.extend(benchmark_replay_and_manifest())

    # 6. Tri-Run Fix Verification
    operations.extend(benchmark_tri_run_verification())

    # Global Budget Checks
    max_peak_rss = max(m.peak_rss_mib for m in operations)
    comp_500k = next((m for m in operations if m.name == "keyed_comparison_500k"), None)

    budget_checks = {
        "max_peak_rss_limit_512_mib": {
            "actual_peak_rss_mib": round(max_peak_rss, 2),
            "limit_mib": 512.0,
            "passed": max_peak_rss < 512.0,
        },
        "target_500k_time_1500_ms": {
            "actual_ms": comp_500k.elapsed_ms if comp_500k else None,
            "target_ms": 1500.0,
            "passed": (comp_500k.elapsed_ms < 1500.0) if comp_500k else True,
            "applicable": comp_500k is not None,
        },
        "target_500k_delta_rss_120_mib": {
            "actual_delta_rss_mib": comp_500k.delta_rss_mib if comp_500k else None,
            "limit_mib": 120.0,
            "passed": (comp_500k.delta_rss_mib < 120.0) if comp_500k else True,
            "applicable": comp_500k is not None,
        },
        "all_partitions_valid": {
            "passed": all(
                m.details.get("partitions_valid", True)
                for m in operations
                if "partitions_valid" in m.details
            ),
        },
    }

    all_budgets_passed = all(
        isinstance(c, dict) and bool(c.get("passed", True)) for c in budget_checks.values()
    ) and all(m.passed_budget for m in operations)

    report = E2EBenchmarkReport(
        suite_title="Data Rewind End-to-End Performance & Memory Benchmark Suite",
        generated_at_utc=datetime.now(UTC).isoformat(),
        system_info=sys_info,
        operations=operations,
        budget_checks=budget_checks,
        all_budgets_passed=all_budgets_passed,
    )

    if output_dir is not None:
        output_dir.mkdir(parents=True, exist_ok=True)
        # JSON Output
        json_path = output_dir / "benchmark_report.json"
        json_path.write_text(report.model_dump_json(indent=2), encoding="utf-8")

        # Markdown Output
        md_path = output_dir / "benchmark_report.md"
        md_path.write_text(format_markdown_report(report), encoding="utf-8")

    return report


def format_markdown_report(report: E2EBenchmarkReport) -> str:
    """Format benchmark report as human-readable GitHub-flavored markdown."""
    lines: list[str] = [
        f"# {report.suite_title}",
        "",
        f"**Generated:** {report.generated_at_utc}  ",
        f"**Environment:** {report.system_info.os_platform} {report.system_info.os_release} | "
        f"CPUs: {report.system_info.cpu_count_logical} | "
        f"Total RAM: {report.system_info.total_ram_mib:,.1f} MiB | "
        f"Python: {report.system_info.python_version} | "
        f"DuckDB: {report.system_info.duckdb_version}",
        "",
        "## 1. Benchmarked Operations Matrix",
        "",
        "| Category | Operation | Elapsed (ms) | Peak RSS (MiB) | Delta RSS (MiB) | Status | Key Details |",
        "| :--- | :--- | :--- | :--- | :--- | :--- | :--- |",
    ]

    for op in report.operations:
        status_badge = "**PASS**" if op.passed_budget else "**FAIL**"
        # Format key details
        details_list = []
        if "throughput_rows_sec" in op.details:
            details_list.append(f"{op.details['throughput_rows_sec']:,.0f} rows/s")
        if "partitions_valid" in op.details:
            details_list.append(
                f"Partitions: {'VALID' if op.details['partitions_valid'] else 'INVALID'}"
            )
        if "verdict" in op.details:
            details_list.append(f"Verdict: {op.details['verdict']}")
        if "step_count" in op.details:
            details_list.append(f"{op.details['step_count']} steps")
        if "clean_replay_verified" in op.details:
            details_list.append("Replay Verified: True")
        details_str = ", ".join(details_list) if details_list else "-"

        lines.append(
            f"| {op.category} | `{op.name}` | {op.elapsed_ms:,.1f} ms | "
            f"{op.peak_rss_mib:.1f} MiB | {op.delta_rss_mib:.1f} MiB | {status_badge} | {details_str} |"
        )

    lines.extend(
        [
            "",
            "## 2. Budget Gate Evaluation",
            "",
            "| Gate / Invariant | Threshold Target | Actual Measured | Status |",
            "| :--- | :--- | :--- | :--- |",
            f"| Process Peak RSS Limit | < 512.0 MiB | {report.budget_checks['max_peak_rss_limit_512_mib']['actual_peak_rss_mib']:.1f} MiB | {'**PASS**' if report.budget_checks['max_peak_rss_limit_512_mib']['passed'] else '**FAIL**'} |",
            f"| Partition Completeness Invariant | 100% Valid | 100% Valid | {'**PASS**' if report.budget_checks['all_partitions_valid']['passed'] else '**FAIL**'} |",
        ]
    )

    check_500k_time = report.budget_checks["target_500k_time_1500_ms"]
    if check_500k_time.get("applicable"):
        lines.append(
            f"| 500k Keyed Comparison Wall Time | < 1,500.0 ms | {check_500k_time['actual_ms']:,.1f} ms | {'**PASS**' if check_500k_time['passed'] else '**FAIL**'} |"
        )
    check_500k_ram = report.budget_checks["target_500k_delta_rss_120_mib"]
    if check_500k_ram.get("applicable"):
        lines.append(
            f"| 500k Keyed Comparison Delta RSS | < 120.0 MiB | {check_500k_ram['actual_delta_rss_mib']:.1f} MiB | {'**PASS**' if check_500k_ram['passed'] else '**FAIL**'} |"
        )

    lines.extend(
        [
            "",
            f"**Final Milestone 6.0 Benchmark Verdict:** {'ALL BUDGETS PASSED' if report.all_budgets_passed else 'BUDGET BREACHED'}",
            "",
        ]
    )

    return "\n".join(lines)


if __name__ == "__main__":
    out_dir = Path("benchmarks/output")
    execute_full_benchmark_suite(quick=False, output_dir=out_dir)
