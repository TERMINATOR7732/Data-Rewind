"""Data Rewind Forensic Investigation Orchestrator.

Conforms to SPEC-MOD-01, SPEC-MOD-04, and SPEC-MOD-07.
Coordinates:
- Step-by-step tabular comparisons
- EOD root cause detection & diagnostic rules (DR-01 to DR-06)
- Downstream lineage taint propagation and blast radius calculation
- Evidence-backed forensic report generation & persistence
"""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

from data_rewind.comparator.engine import TabularComparator
from data_rewind.comparator.models import ComparisonConfig, TabularDiffResult
from data_rewind.core.dag.validator import DAGValidator
from data_rewind.core.db.duckdb_runtime import DuckDBConfig, DuckDBRuntime
from data_rewind.core.domain.models import TransformationStep
from data_rewind.diagnostics.eod import EODDetector
from data_rewind.diagnostics.models import EODResult, StepDiagnosticContext
from data_rewind.investigation.models import Investigation, InvestigationStatus
from data_rewind.investigation.persistence import InvestigationRepository
from data_rewind.lineage.engine import LineageEngine
from data_rewind.lineage.models import BlastRadiusReport


class InvestigationOrchestrator:
    """Orchestrates comprehensive forensic investigations across pipeline executions."""

    @classmethod
    def investigate_runs(
        cls,
        title: str,
        baseline_run_id: UUID,
        target_run_id: UUID,
        steps: Sequence[TransformationStep],
        baseline_step_data: dict[str, list[dict[str, Any]] | Path],
        target_step_data: dict[str, list[dict[str, Any]] | Path],
        target_steps: Sequence[TransformationStep] | None = None,
        primary_keys_by_step: dict[str, list[str]] | None = None,
        step_dependencies: dict[str, list[str]] | None = None,
        terminal_step_ids: list[str] | None = None,
        repository: InvestigationRepository | None = None,
    ) -> Investigation:
        """Execute end-to-end investigation comparing baseline and target execution runs."""
        # 1. Resolve DAG topological order
        # Infer inputs from steps' input_step_ids that are not step_ids
        step_ids = {s.step_id for s in steps}
        inferred_inputs = list(
            {dep for s in steps for dep in s.input_step_ids if dep not in step_ids}
        )
        topological_order = DAGValidator.validate_and_order(list(steps), inferred_inputs)

        pks_map = primary_keys_by_step or {}
        step_map = {s.step_id: s for s in steps}
        target_step_map = {s.step_id: s for s in target_steps} if target_steps else step_map

        step_contexts: dict[str, StepDiagnosticContext] = {}
        step_comparisons: dict[str, TabularDiffResult] = {}
        baseline_hashes: dict[str, str | None] = {}
        target_hashes: dict[str, str | None] = {}

        # 2. Perform step-level tabular comparisons
        for sid in topological_order:
            step = step_map[sid]
            t_step = target_step_map.get(sid, step)
            b_data = baseline_step_data.get(sid, [])
            t_data = target_step_data.get(sid, [])

            b_rows = cls._load_rows(b_data)
            t_rows = cls._load_rows(t_data)

            pks = pks_map.get(sid)
            cfg = ComparisonConfig(
                primary_key=pks if pks else None,
                atol=1e-6,
                rtol=1e-5,
            )

            diff_res = TabularComparator.compare(b_rows, t_rows, config=cfg)
            step_comparisons[sid] = diff_res

            b_multiset = diff_res.baseline_fingerprint.multiset_hash
            t_multiset = diff_res.target_fingerprint.multiset_hash
            baseline_hashes[sid] = b_multiset
            target_hashes[sid] = t_multiset

            is_ingestion = any(dep in inferred_inputs for dep in step.input_step_ids)
            input_name = step.input_step_ids[0] if step.input_step_ids else None

            # Input hashes for the step: if ingestion, compare initial input hashes; else upstream step hashes
            b_in_hashes: list[str] = [
                h for dep in step.input_step_ids if (h := baseline_hashes.get(dep)) is not None
            ]
            t_in_hashes: list[str] = [
                h for dep in step.input_step_ids if (h := target_hashes.get(dep)) is not None
            ]

            step_contexts[sid] = StepDiagnosticContext(
                step_id=sid,
                operation=(
                    step.operation_type.value
                    if hasattr(step.operation_type, "value")
                    else str(step.operation_type)
                ),
                is_ingestion_node=is_ingestion,
                input_dataset_name=input_name,
                baseline_input_hashes=b_in_hashes,
                target_input_hashes=t_in_hashes,
                baseline_output_hash=b_multiset,
                target_output_hash=t_multiset,
                diff_result=diff_res,
                baseline_parameters=dict(step.parameters),
                target_parameters=dict(t_step.parameters),
                left_input_rows=len(b_rows),
                right_input_rows=len(t_rows),
            )

        # 3. Detect Earliest Observable Divergence (EOD) and evaluate diagnostic rules
        eod_res = EODDetector.detect_eod(
            topological_order=topological_order,
            step_contexts=step_contexts,
            step_dependencies=step_dependencies,
            terminal_step_ids=terminal_step_ids,
        )

        # 4. Compute downstream lineage taint propagation and blast radius
        origin_ids = eod_res.divergent_step_ids
        blast_res = LineageEngine.compute_downstream_blast_radius(
            steps=steps,
            origin_step_ids=origin_ids,
            baseline_hashes=baseline_hashes,
            target_hashes=target_hashes,
            terminal_sink_ids=terminal_step_ids,
        )

        # 5. Formulate forensic summary narrative
        summary_text = cls._build_summary(eod_res, blast_res)

        investigation = Investigation(
            investigation_id=uuid4(),
            title=title,
            baseline_run_id=baseline_run_id,
            target_run_id=target_run_id,
            status=InvestigationStatus.ACTIVE,
            topological_order=topological_order,
            step_comparisons=step_comparisons,
            eod_result=eod_res,
            blast_radius=blast_res,
            summary=summary_text,
        )

        # 6. Persist to repository if configured
        if repository is not None:
            repository.save(investigation)

        return investigation

    @classmethod
    def _load_rows(cls, data: list[dict[str, Any]] | Path | str) -> list[dict[str, Any]]:
        """Load records from in-memory list or parquet/csv file path."""
        if isinstance(data, list):
            return data
        p = Path(data)
        if not p.is_file():
            return []
        runtime = DuckDBRuntime(DuckDBConfig(database_path=":memory:"))
        runtime.connect()
        try:
            if p.suffix.lower() in (".parquet", ".pq"):
                return runtime.execute_query_dicts(f"SELECT * FROM read_parquet('{p.as_posix()}')")
            elif p.suffix.lower() == ".csv":
                return runtime.execute_query_dicts(
                    f"SELECT * FROM read_csv('{p.as_posix()}', header=true, auto_detect=true)"
                )
            return []
        finally:
            runtime.close()

    @classmethod
    def _build_summary(cls, eod: EODResult, blast: BlastRadiusReport) -> str:
        """Compose clear forensic summary based on empirical evidence."""
        if not eod.divergent_step_ids:
            return "No divergence observed between baseline and target runs. All outputs identical."

        primary = eod.primary_eod_step or "unknown"
        finding_texts = [f.rule_name for f in eod.findings]
        findings_str = (
            f" Triggered diagnostic rules: {', '.join(finding_texts)}." if finding_texts else ""
        )

        blast_pct = round(blast.blast_radius_ratio * 100.0, 1)
        confirmed_pct = round(blast.confirmed_divergence_ratio * 100.0, 1)

        terminal_str = (
            f" Terminal sinks affected: {', '.join(blast.affected_terminal_sinks)}."
            if blast.affected_terminal_sinks
            else " No terminal publication sinks affected."
        )

        return (
            f"Earliest Observable Divergence identified at step '{primary}' "
            f"[{eod.status.value}].{findings_str} Blast radius: {blast.tainted_nodes_count}/"
            f"{blast.total_nodes_count} nodes ({blast_pct}%), with {blast.confirmed_affected_count} "
            f"confirmed divergent ({confirmed_pct}%).{terminal_str}"
        )
