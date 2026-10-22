"""Data Rewind minimal local developer diagnostic CLI.

Provides diagnostics reporting:
- Installed engine version
- Python runtime & platform
- DuckDB version
- Configuration validity
- Workspace storage availability
"""

from __future__ import annotations

import argparse
import sys

import duckdb

from data_rewind import __version__
from data_rewind.core.config.guards import ResourceGuards
from data_rewind.core.config.settings import Settings


def print_diagnostics() -> int:
    """Print system and configuration diagnostics to stdout."""
    settings = Settings.load()

    print("=" * 60)
    print("DATA REWIND -- LOCAL SYSTEM DIAGNOSTICS")
    print("=" * 60)
    print(f"Engine Version:         {__version__}")
    print(f"Active Profile:         {settings.profile}")
    print(f"Python Runtime:         {sys.version.split()[0]} ({sys.platform})")
    print(f"DuckDB Version:         {duckdb.__version__}")
    print(f"Base Workspace Root:    {settings.base_data_dir}")

    # Check workspace availability
    try:
        settings.base_data_dir.mkdir(parents=True, exist_ok=True)
        workspace_accessible = settings.base_data_dir.is_dir()
    except Exception:
        workspace_accessible = False
    print(f"Workspace Accessible:   {'YES' if workspace_accessible else 'NO'}")

    # Preflight disk space check
    try:
        ResourceGuards.check_preflight_disk_space(settings.base_data_dir, settings.limits)
        disk_ok = True
    except Exception as exc:
        disk_ok = False
        print(f"Disk Warning:           {exc}")
    print(f"Disk Admission Gate:    {'PASS (> 100 MB free)' if disk_ok else 'FAIL'}")

    # Memory ceiling
    print(f"Process RSS Ceiling:    {settings.limits.max_process_rss_mib} MiB")
    print(f"DuckDB Query Memory:    {settings.limits.duckdb_max_memory_mib} MiB")
    print(f"Max CSV Upload Limit:   {settings.limits.max_raw_csv_bytes // 1_000_000} MB")
    print(f"Max Dataset Rows:       {settings.limits.max_dataset_rows:,} rows")
    print(f"Max Dataset Columns:    {settings.limits.max_column_count} columns")
    print("=" * 60)
    return 0


def main() -> None:
    """CLI entry point."""
    parser = argparse.ArgumentParser(
        prog="data-rewind",
        description="Data Rewind — Understand the past. Verify the present.",
    )
    parser.add_argument("--version", "-v", action="version", version=f"Data Rewind {__version__}")
    subparsers = parser.add_subparsers(dest="command")

    subparsers.add_parser("diagnostics", help="Display local diagnostic and environment info")
    subparsers.add_parser("smoke-test", help="Execute core engine foundations smoke test")

    bench_parser = subparsers.add_parser(
        "benchmark", help="Execute reproducible benchmark protocol"
    )
    bench_parser.add_argument(
        "--quick",
        action="store_true",
        help="Run fast CI/smoke benchmark suite without 500k-row target verification",
    )
    bench_parser.add_argument(
        "--output",
        "-o",
        type=str,
        default=None,
        help="Path to write JSON benchmark dossier",
    )

    args = parser.parse_args()

    if args.command == "smoke-test":
        from data_rewind.smoke_test import run_smoke_test

        sys.exit(run_smoke_test())
    elif args.command == "benchmark":
        from pathlib import Path

        from data_rewind.benchmarks import format_report_table, run_benchmarks

        out_path = Path(args.output) if args.output else None
        print("Executing Data Rewind Reproducible Benchmark Protocol...")
        report = run_benchmarks(quick=args.quick, output_path=out_path)
        print("\n" + format_report_table(report))
        sys.exit(0 if report.all_targets_met else 1)
    elif args.command == "diagnostics" or not args.command:
        sys.exit(print_diagnostics())


if __name__ == "__main__":
    main()
