"""Data Rewind developer diagnostic and forensic orchestration CLI.

Conforms to SPEC-MOD-01, SPEC-MOD-03, SPEC-MOD-04, and SPEC-MOD-07.
Provides subcommands:
- diagnostics
- smoke-test
- benchmark
- investigate
- lineage
- replay
- manifest
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from uuid import uuid4

import duckdb

from data_rewind import __version__
from data_rewind.core.config.guards import ResourceGuards
from data_rewind.core.config.settings import Settings
from data_rewind.core.integrity.hashing import (
    compute_content_hash,
    compute_multiset_hash,
)
from data_rewind.core.integrity.manifest import ManifestInput, ReplayManifest
from data_rewind.execution.engine import PipelineExecutor
from data_rewind.execution.models import ExecutionOptions
from data_rewind.replay.manifest_generator import generate_replay_manifest
from data_rewind.replay.replayer import HistoricalReplayer
from data_rewind.scenarios.definitions import SCENARIO_REGISTRY
from data_rewind.scenarios.runner import ScenarioRunner
from data_rewind.verification.models import (
    IntentionalUpdateContract,
    VerificationVerdict,
)
from data_rewind.verification.persistence import VerificationRepository
from data_rewind.verification.reports import (
    CSVDossierExporter,
    JSONDossierExporter,
    MarkdownDossierExporter,
)


def handle_serve(args: argparse.Namespace) -> int:
    """Launch the Data Rewind FastAPI local server on loopback."""
    import uvicorn

    host = getattr(args, "host", "127.0.0.1") or "127.0.0.1"
    port = args.port or 8000
    print(f"Starting Data Rewind API server on http://{host}:{port}/api/v1 (loopback only)...")
    uvicorn.run("data_rewind.api.main:app", host=host, port=port, log_level="info")
    return 0


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


def handle_investigate(args: argparse.Namespace) -> int:
    """Execute forensic investigation and print findings."""
    settings = Settings.load()
    scenario_id = (args.scenario or "scn01").lower()
    investigation = ScenarioRunner.run_scenario(scenario_id, settings.base_data_dir)

    if args.format == "json":
        output = investigation.model_dump_json(indent=2)
        if args.output:
            Path(args.output).write_text(output, encoding="utf-8")
        else:
            print(output)
        return 0

    print("=" * 65)
    print(f"DATA REWIND FORENSIC INVESTIGATION: {investigation.title}")
    print("=" * 65)
    print(f"Investigation ID:       {investigation.investigation_id}")
    print(f"Status:                 {investigation.status.value}")
    print(f"Primary EOD Step:       {investigation.eod_result.primary_eod_step}")
    print(f"EOD Classification:     {investigation.eod_result.status.value}")
    print(f"Blast Radius Ratio:     {investigation.blast_radius.blast_radius_ratio * 100.0:.1f}%")
    print(
        f"Confirmed Affected:     {investigation.blast_radius.confirmed_affected_count}/{investigation.blast_radius.total_nodes_count} nodes"
    )
    print(f"Terminal Sinks Tainted: {len(investigation.blast_radius.affected_terminal_sinks)}")
    print("-" * 65)
    print("SUMMARY:")
    print(investigation.summary)
    print("-" * 65)

    if investigation.eod_result.findings:
        print("DIAGNOSTIC FINDINGS:")
        for idx, f in enumerate(investigation.eod_result.findings, 1):
            print(f"  {idx}. [{f.rule_name}] ({f.evidence_tier.value}) at step '{f.step_id}'")
            print(f"     Message: {f.message}")

    print("=" * 65)
    if args.output:
        Path(args.output).write_text(investigation.model_dump_json(indent=2), encoding="utf-8")
    return 0


def handle_lineage(args: argparse.Namespace) -> int:
    """Display lineage graph and taint propagation."""
    settings = Settings.load()
    scenario_id = (args.scenario or "scn01").lower()
    investigation = ScenarioRunner.run_scenario(scenario_id, settings.base_data_dir)
    blast = investigation.blast_radius

    if args.format == "json":
        print(blast.model_dump_json(indent=2))
        return 0

    print("=" * 75)
    print(f"DATA REWIND LINEAGE TAINT REPORT: {scenario_id.upper()}")
    print("=" * 75)
    print(f"{'STEP ID':<25} {'OPERATION':<20} {'TAINT STATUS':<22} {'DIVERGENT':<10}")
    print("-" * 75)
    for sid, node in blast.nodes.items():
        print(
            f"{sid:<25} {node.operation:<20} {node.taint_status.value:<22} "
            f"{'YES' if node.is_divergent else 'NO':<10}"
        )
    print("-" * 75)
    print(
        f"Total Nodes: {blast.total_nodes_count} | Tainted: {blast.tainted_nodes_count} | "
        f"Confirmed: {blast.confirmed_affected_count} | Masked: {blast.masked_count} | "
        f"Clean: {blast.untainted_count}"
    )
    print(f"Affected Terminal Sinks: {', '.join(blast.affected_terminal_sinks) or 'None'}")
    print("=" * 75)
    return 0


def handle_replay(args: argparse.Namespace) -> int:
    """Execute historical replay and print reproducibility verification."""
    settings = Settings.load()

    if args.manifest:
        p = Path(args.manifest)
        if not p.is_file():
            print(f"Error: Manifest file not found: {p}", file=sys.stderr)
            return 1
        manifest = ReplayManifest.from_json(p.read_text(encoding="utf-8"))
        res = HistoricalReplayer.replay_run(manifest, settings.base_data_dir)
    else:
        # Replay demo scenario
        scenario_id = (args.scenario or "scn01").lower()
        if scenario_id not in SCENARIO_REGISTRY:
            print(f"Error: Unknown scenario '{scenario_id}'", file=sys.stderr)
            return 1
        scenario = SCENARIO_REGISTRY[scenario_id]

        # Pin baseline inputs to raw_inputs vault
        raw_inputs_dir = settings.base_data_dir / "raw_inputs"
        raw_inputs_dir.mkdir(parents=True, exist_ok=True)
        manifest_inputs: list[ManifestInput] = []

        import csv

        for inp_name, rows in scenario.baseline_inputs.items():
            tmp_csv = raw_inputs_dir / f"{inp_name}_temp.csv"
            if rows:
                with open(tmp_csv, "w", newline="", encoding="utf-8") as f:
                    writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
                    writer.writeheader()
                    writer.writerows(rows)
            else:
                tmp_csv.write_text("dummy\n", encoding="utf-8")

            c_hash = compute_content_hash(tmp_csv)
            m_hash = compute_multiset_hash(rows)
            pinned_path = raw_inputs_dir / f"{c_hash}.csv"
            tmp_csv.replace(pinned_path)

            manifest_inputs.append(
                ManifestInput(
                    input_id=inp_name,
                    version_id=uuid4(),
                    content_hash=c_hash,
                    multiset_hash=m_hash,
                    row_count=len(rows),
                    byte_size=pinned_path.stat().st_size,
                )
            )

        run_id = uuid4()
        pipeline_version_id = uuid4()
        manifest = generate_replay_manifest(
            run_id=run_id,
            pipeline_version_id=pipeline_version_id,
            pipeline_definition_hash="0" * 64,
            inputs=manifest_inputs,
            steps=scenario.steps,
        )

        # Baseline execution to obtain historical step hashes
        base_exec = PipelineExecutor.execute_pipeline(
            steps=scenario.steps,
            inputs=scenario.baseline_inputs,  # type: ignore[arg-type]
            options=ExecutionOptions(workspace_root=settings.base_data_dir, fail_fast=True),
            run_id=run_id,
        )
        hist_hashes = {
            s: res.multiset_hash
            for s, res in base_exec.step_results.items()
            if res.multiset_hash is not None
        }

        res = HistoricalReplayer.replay_run(
            manifest=manifest,
            workspace_root=settings.base_data_dir,
            historical_step_hashes=hist_hashes,
        )

    if args.format == "json":
        print(res.model_dump_json(indent=2))
        return 0

    print("=" * 65)
    print("DATA REWIND HISTORICAL REPLAY VERIFICATION")
    print("=" * 65)
    print(f"Replay Run ID:          {res.replay_run_id}")
    print(f"Historical Run ID:      {res.historical_run_id}")
    print(f"Outcome Status:         {res.outcome.value}")
    print(f"Explanation:            {res.explanation}")
    if res.late_divergence_step_id:
        print(f"Late Divergence Step:   {res.late_divergence_step_id}")
    if res.missing_artifacts:
        print(f"Missing Artifacts:      {res.missing_artifacts}")
    print(f"Execution Duration:     {res.execution_duration_ms:.2f} ms")
    print("-" * 65)
    if res.step_verifications:
        print("STEP VERIFICATIONS:")
        for sid, ver in res.step_verifications.items():
            match_str = "MATCH" if ver.is_matched else "DIVERGED"
            print(f"  [{match_str}] Step '{sid}': {ver.replayed_multiset_hash or 'N/A'}")
    print("=" * 65)
    return 0


def handle_manifest(args: argparse.Namespace) -> int:
    """Generate canonical replay manifest JSON for a scenario or pipeline."""
    scenario_id = (args.scenario or "scn01").lower()
    if scenario_id not in SCENARIO_REGISTRY:
        print(f"Error: Unknown scenario '{scenario_id}'", file=sys.stderr)
        return 1

    scenario = SCENARIO_REGISTRY[scenario_id]
    manifest_inputs = [
        ManifestInput(
            input_id=name,
            version_id=uuid4(),
            content_hash="0" * 64,
            multiset_hash=compute_multiset_hash(rows),
            row_count=len(rows),
            byte_size=1024,
        )
        for name, rows in scenario.baseline_inputs.items()
    ]

    manifest = generate_replay_manifest(
        run_id=uuid4(),
        pipeline_version_id=uuid4(),
        pipeline_definition_hash="0" * 64,
        inputs=manifest_inputs,
        steps=scenario.steps,
    )

    manifest_json = manifest.to_canonical_json()
    if args.output:
        Path(args.output).write_text(manifest_json, encoding="utf-8")
        print(f"Manifest saved to: {args.output}")
    else:
        print(manifest_json)
    return 0


def handle_verify_fix(args: argparse.Namespace) -> int:
    """Execute Tri-Run Fix Verification for a scenario and display forensic report."""
    settings = Settings.load()
    scenario_id = (args.scenario or "scn01").lower()
    fix_mode = getattr(args, "fix_mode", "clean") or "clean"

    db_path = settings.base_data_dir / "metadata.db"
    repo = VerificationRepository(db_path)

    contract = None
    if fix_mode == "intentional":
        contract = IntentionalUpdateContract(
            allowed_steps=["ingest_orders", "compute_fee", "join_orders", "normalize_scores"],
            allowed_columns_by_step={},
            justification="Intentional pipeline logic update verified against business contract.",
        )

    dossier = ScenarioRunner.verify_scenario_fix(
        scenario_id=scenario_id,
        workspace_root=settings.base_data_dir,
        fix_mode=fix_mode,
        intentional_contract=contract,
        repository=repo,
    )

    fmt = args.format
    output_text = ""
    if fmt == "json":
        output_text = JSONDossierExporter.export(dossier)
    elif fmt == "markdown":
        output_text = MarkdownDossierExporter.export(dossier)
    elif fmt == "csv-safe":
        output_text, _ = CSVDossierExporter.export_verification_summary(
            dossier.verification, export_mode="safe"
        )
    elif fmt == "csv-raw":
        output_text, _ = CSVDossierExporter.export_verification_summary(
            dossier.verification, export_mode="raw"
        )
    else:
        v = dossier.verification
        print("=" * 65)
        print("DATA REWIND TRI-RUN FIX VERIFICATION")
        print("=" * 65)
        print(f"Verification ID:        {v.verification_id}")
        print(f"Scenario:               {scenario_id.upper()}")
        print(f"Fix Mode Tested:        {fix_mode.upper()}")
        print(f"Verdict:                {v.verdict.value}")
        print(f"Meaning:                {v.verdict_meaning}")
        print(f"Reason Codes:           {', '.join(v.verdict_reason_codes)}")
        print(f"R0 Baseline Run ID:     {v.baseline_run_id}")
        print(f"R1 Faulted Run ID:      {v.faulted_run_id}")
        print(f"R2 Candidate Fix ID:    {v.candidate_run_id}")
        print("-" * 65)
        print("DUAL-AXIS RESULTS:")
        print(
            f"  Axis 1 (Remediation): EOD Remediated={'YES' if v.dual_axis.remediation_axis.eod_remediated else 'NO'} "
            f"({v.dual_axis.remediation_axis.explanation})"
        )
        if v.dual_axis.baseline_axis:
            print(
                f"  Axis 2 (Baseline):    Sinks Equivalent={'YES' if v.dual_axis.baseline_axis.baseline_equivalent_at_sinks else 'NO'} "
                f"({v.dual_axis.baseline_axis.explanation})"
            )
            if v.dual_axis.baseline_axis.collateral_regressions:
                print(
                    f"  Collateral Faults:    {', '.join(v.dual_axis.baseline_axis.collateral_regressions)}"
                )
        print("=" * 65)

    if output_text:
        if args.output:
            Path(args.output).write_text(output_text, encoding="utf-8")
            print(f"Report exported to: {args.output}")
        else:
            print(output_text)

    is_success = dossier.verification.verdict in (
        VerificationVerdict.VERIFIED_CLEAN,
        VerificationVerdict.INTENTIONAL_UPDATE,
    )
    return 0 if is_success else 1


def handle_export_report(args: argparse.Namespace) -> int:
    """Export an existing persisted verification dossier to requested format."""
    settings = Settings.load()
    db_path = settings.base_data_dir / "metadata.db"
    repo = VerificationRepository(db_path)

    verif_id_str = args.verification_id
    try:
        from uuid import UUID

        verif_id = UUID(verif_id_str)
    except ValueError:
        print(f"Error: Invalid verification UUID '{verif_id_str}'", file=sys.stderr)
        return 1

    dossier = repo.get_dossier_by_verification(verif_id)
    if not dossier:
        print(f"Error: Dossier not found for verification ID '{verif_id}'", file=sys.stderr)
        return 1

    fmt = args.format
    if fmt == "json":
        content = JSONDossierExporter.export(dossier)
    elif fmt == "markdown":
        content = MarkdownDossierExporter.export(dossier)
    elif fmt == "csv-safe":
        content, _ = CSVDossierExporter.export_verification_summary(
            dossier.verification, export_mode="safe"
        )
    elif fmt == "csv-raw":
        content, _ = CSVDossierExporter.export_verification_summary(
            dossier.verification, export_mode="raw"
        )
    else:
        content = MarkdownDossierExporter.export(dossier)

    if args.output:
        Path(args.output).write_text(content, encoding="utf-8")
        print(f"Report exported successfully to: {args.output}")
    else:
        print(content)
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

    inv_parser = subparsers.add_parser(
        "investigate", help="Execute forensic investigation comparing runs"
    )
    inv_parser.add_argument(
        "--scenario", "-s", type=str, default="scn01", help="Scenario ID (scn01..scn04)"
    )
    inv_parser.add_argument(
        "--format", "-f", choices=["text", "json"], default="text", help="Output format"
    )
    inv_parser.add_argument("--output", "-o", type=str, default=None, help="Output file path")

    lineage_parser = subparsers.add_parser(
        "lineage", help="Display downstream taint propagation and blast radius"
    )
    lineage_parser.add_argument(
        "--scenario", "-s", type=str, default="scn01", help="Scenario ID (scn01..scn04)"
    )
    lineage_parser.add_argument(
        "--format", "-f", choices=["text", "json"], default="text", help="Output format"
    )

    replay_parser = subparsers.add_parser(
        "replay", help="Replay historical execution against pinned manifest"
    )
    replay_parser.add_argument(
        "--manifest", "-m", type=str, default=None, help="Path to manifest JSON"
    )
    replay_parser.add_argument(
        "--scenario", "-s", type=str, default="scn01", help="Demo scenario to replay"
    )
    replay_parser.add_argument(
        "--format", "-f", choices=["text", "json"], default="text", help="Output format"
    )

    manifest_parser = subparsers.add_parser(
        "manifest", help="Generate pinned replay manifest for scenario"
    )
    manifest_parser.add_argument(
        "--scenario", "-s", type=str, default="scn01", help="Scenario ID (scn01..scn04)"
    )
    manifest_parser.add_argument("--output", "-o", type=str, default=None, help="Output file path")

    verify_parser = subparsers.add_parser(
        "verify-fix", help="Execute Tri-Run Fix Verification for a scenario"
    )
    verify_parser.add_argument(
        "--scenario", "-s", type=str, default="scn01", help="Scenario ID (scn01..scn04)"
    )
    verify_parser.add_argument(
        "--fix-mode",
        "-m",
        choices=["clean", "intentional", "partial", "unresolved", "collateral"],
        default="clean",
        help="Candidate remediation mode to test",
    )
    verify_parser.add_argument(
        "--format",
        "-f",
        choices=["text", "json", "markdown", "csv-safe", "csv-raw"],
        default="text",
        help="Report export format",
    )
    verify_parser.add_argument("--output", "-o", type=str, default=None, help="Output file path")

    export_parser = subparsers.add_parser(
        "export-report", help="Export persisted forensic dossier to JSON, Markdown, or CSV"
    )
    export_parser.add_argument(
        "--verification-id",
        "-id",
        type=str,
        required=True,
        help="Verification UUID to export",
    )
    export_parser.add_argument(
        "--format",
        "-f",
        choices=["json", "markdown", "csv-safe", "csv-raw"],
        default="markdown",
        help="Dossier format",
    )
    export_parser.add_argument("--output", "-o", type=str, default=None, help="Output file path")

    serve_parser = subparsers.add_parser(
        "serve", help="Launch Data Rewind local-first API server on loopback (127.0.0.1)"
    )
    serve_parser.add_argument(
        "--host",
        type=str,
        default="127.0.0.1",
        choices=["127.0.0.1", "localhost"],
        help="Host interface (must be loopback, default: 127.0.0.1)",
    )
    serve_parser.add_argument(
        "--port", "-p", type=int, default=8000, help="Port to bind (default: 8000)"
    )

    args = parser.parse_args()

    if args.command == "smoke-test":
        from data_rewind.smoke_test import run_smoke_test

        sys.exit(run_smoke_test())
    elif args.command == "benchmark":
        from pathlib import Path

        from data_rewind.benchmarks.e2e_suite import (
            execute_full_benchmark_suite,
            format_markdown_report,
        )

        out_dir = Path(args.output).parent if args.output else Path("benchmarks/output")
        print("Executing Data Rewind End-to-End Performance & Memory Benchmark Suite...")
        report = execute_full_benchmark_suite(quick=args.quick, output_dir=out_dir)
        print("\n" + format_markdown_report(report))
        sys.exit(0 if report.all_budgets_passed else 1)
    elif args.command == "investigate":
        sys.exit(handle_investigate(args))
    elif args.command == "lineage":
        sys.exit(handle_lineage(args))
    elif args.command == "replay":
        sys.exit(handle_replay(args))
    elif args.command == "manifest":
        sys.exit(handle_manifest(args))
    elif args.command == "verify-fix":
        sys.exit(handle_verify_fix(args))
    elif args.command == "export-report":
        sys.exit(handle_export_report(args))
    elif args.command == "serve":
        sys.exit(handle_serve(args))
    elif args.command == "diagnostics" or not args.command:
        sys.exit(print_diagnostics())


if __name__ == "__main__":
    main()
