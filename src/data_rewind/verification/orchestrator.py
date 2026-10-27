"""Data Rewind Fix Verification Orchestrator.

Conforms to SPEC-MOD-05 (Fix Verification & Forensic Reports) and
SPEC-MOD-07 (System Architecture & API Contracts).
Coordinates:
- Step-by-step comparative analysis across R0 (baseline), R1 (faulted), R2 (candidate fix)
- Lineage taint propagation and blast radius derivation
- Dual-axis fix evaluation via TriRunEvaluator
- Forensic investigation dossier assembly and local SQLite persistence
"""

from __future__ import annotations

import time
from collections.abc import Sequence
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

from data_rewind.comparator.engine import TabularComparator
from data_rewind.comparator.models import ComparisonConfig, TabularDiffResult
from data_rewind.core.dag.validator import DAGValidator
from data_rewind.core.db.duckdb_runtime import DuckDBConfig, DuckDBRuntime
from data_rewind.core.domain.models import TransformationStep
from data_rewind.lineage.engine import LineageEngine
from data_rewind.lineage.models import BlastRadiusReport
from data_rewind.verification.evaluator import TriRunEvaluator
from data_rewind.verification.models import (
    ForensicDossier,
    ForensicDossierMetadata,
    IntentionalUpdateContract,
    MissingEvidenceDeclaration,
)
from data_rewind.verification.persistence import VerificationRepository


class FixVerificationOrchestrator:
    """Orchestrates comprehensive Tri-Run Fix Verification workflows and dossier compilation."""

    @classmethod
    def verify_fix(
        cls,
        title: str,
        faulted_run_id: UUID,
        candidate_run_id: UUID,
        steps: Sequence[TransformationStep],
        faulted_step_data: dict[str, list[dict[str, Any]] | Path | str],
        candidate_step_data: dict[str, list[dict[str, Any]] | Path | str],
        baseline_run_id: UUID | None = None,
        baseline_step_data: dict[str, list[dict[str, Any]] | Path | str] | None = None,
        primary_keys_by_step: dict[str, list[str]] | None = None,
        terminal_step_ids: list[str] | None = None,
        eod_step_id: str | None = None,
        intentional_contract: IntentionalUpdateContract | None = None,
        reproducibility_signatures: dict[str, str] | None = None,
        pipeline_name: str = "Pipeline",
        pipeline_version_hash: str = "0" * 64,
        investigator_session: str = "local_investigator",
        repository: VerificationRepository | None = None,
    ) -> ForensicDossier:
        """Execute end-to-end Tri-Run Fix Verification and compile forensic dossier."""
        start_time = time.perf_counter()

        # 1. Resolve DAG topological ordering
        step_ids = {s.step_id for s in steps}
        inferred_inputs = list(
            {dep for s in steps for dep in s.input_step_ids if dep not in step_ids}
        )
        topological_order = DAGValidator.validate_and_order(list(steps), inferred_inputs)

        # 2. Determine sink step IDs (terminal nodes)
        if terminal_step_ids:
            sinks = list(terminal_step_ids)
        else:
            # Sinks are nodes with no downstream dependents in DAG
            dep_set = {dep for s in steps for dep in s.input_step_ids}
            sinks = [s.step_id for s in steps if s.step_id not in dep_set]
            if not sinks and topological_order:
                sinks = [topological_order[-1]]

        pks_map = primary_keys_by_step or {}
        missing_evidence: list[MissingEvidenceDeclaration] = []

        # 3. Perform step-level tabular comparisons
        step_comparisons_r2_r1: dict[str, TabularDiffResult] = {}
        step_comparisons_r2_r0: dict[str, TabularDiffResult] | None = (
            {} if baseline_run_id is not None else None
        )
        step_comparisons_r1_r0: dict[str, TabularDiffResult] | None = (
            {} if baseline_run_id is not None else None
        )

        base_data_map = baseline_step_data or {}
        r1_hashes: dict[str, str | None] = {}
        r2_hashes: dict[str, str | None] = {}
        r0_hashes: dict[str, str | None] = {}

        for sid in topological_order:
            pks = pks_map.get(sid)
            cfg = ComparisonConfig(
                primary_key=pks if pks else None,
                atol=1e-6,
                rtol=1e-5,
            )

            r1_rows = cls._load_rows(faulted_step_data.get(sid, []))
            r2_rows = cls._load_rows(candidate_step_data.get(sid, []))

            # Compare R2 vs R1 (Remediation Axis)
            diff_r2_r1 = TabularComparator.compare(r1_rows, r2_rows, config=cfg)
            step_comparisons_r2_r1[sid] = diff_r2_r1
            r1_hashes[sid] = diff_r2_r1.baseline_fingerprint.multiset_hash
            r2_hashes[sid] = diff_r2_r1.target_fingerprint.multiset_hash

            if (
                baseline_run_id is not None
                and step_comparisons_r2_r0 is not None
                and step_comparisons_r1_r0 is not None
            ):
                r0_raw = base_data_map.get(sid)
                if r0_raw is None:
                    missing_evidence.append(
                        MissingEvidenceDeclaration(
                            category="BASELINE_CHECKPOINT",
                            description=f"Baseline step output for '{sid}' is not available.",
                            remediation_advice=f"Materialize baseline step '{sid}' for full verification.",
                        )
                    )
                else:
                    r0_rows = cls._load_rows(r0_raw)
                    # Compare R2 vs R0 (Baseline Equivalence Axis)
                    diff_r2_r0 = TabularComparator.compare(r0_rows, r2_rows, config=cfg)
                    step_comparisons_r2_r0[sid] = diff_r2_r0
                    r0_hashes[sid] = diff_r2_r0.baseline_fingerprint.multiset_hash

                    # Compare R1 vs R0 (Defect Detection & EOD)
                    diff_r1_r0 = TabularComparator.compare(r0_rows, r1_rows, config=cfg)
                    step_comparisons_r1_r0[sid] = diff_r1_r0

        # 4. Compute Lineage Blast Radius if baseline is available
        blast_res: BlastRadiusReport | None = None
        if baseline_run_id is not None and step_comparisons_r1_r0:
            origin_steps = [sid for sid, d in step_comparisons_r1_r0.items() if not d.is_equal]
            if origin_steps:
                blast_res = LineageEngine.compute_downstream_blast_radius(
                    steps=steps,
                    origin_step_ids=origin_steps,
                    baseline_hashes=r0_hashes,
                    target_hashes=r1_hashes,
                    terminal_sink_ids=sinks,
                )

        duration_ms = (time.perf_counter() - start_time) * 1000.0

        # 5. Evaluate Dual-Axis Verification & Verdict
        verification = TriRunEvaluator.evaluate(
            title=title,
            faulted_run_id=faulted_run_id,
            candidate_run_id=candidate_run_id,
            topological_order=topological_order,
            sink_step_ids=sinks,
            step_comparisons_r2_r1=step_comparisons_r2_r1,
            baseline_run_id=baseline_run_id,
            step_comparisons_r2_r0=step_comparisons_r2_r0,
            step_comparisons_r1_r0=step_comparisons_r1_r0,
            eod_step_id=eod_step_id,
            intentional_contract=intentional_contract,
            blast_radius=blast_res,
            missing_evidence_declarations=missing_evidence,
            execution_duration_ms=duration_ms,
        )

        # 6. Assemble Forensic Investigation Dossier
        metadata = ForensicDossierMetadata(
            dossier_id=uuid4(),
            pipeline_name=pipeline_name,
            pipeline_version_hash=pipeline_version_hash,
            investigator_session=investigator_session,
            baseline_run_id=baseline_run_id,
            faulted_run_id=faulted_run_id,
            candidate_run_id=candidate_run_id,
            created_at=verification.created_at,
        )

        signatures = dict(reproducibility_signatures or {})
        # Automatically register output multiset signatures for auditability
        for sid, h in r2_hashes.items():
            if h:
                signatures[f"step_output_multiset_{sid}"] = h

        dossier = ForensicDossier(
            metadata=metadata,
            verification=verification,
            reproducibility_signatures=signatures,
        )

        # 7. Persist to repository if configured
        if repository is not None:
            repository.save_dossier(dossier)

        return dossier

    @classmethod
    def _load_rows(cls, data: list[dict[str, Any]] | Path | str) -> list[dict[str, Any]]:
        """Load tabular rows from in-memory list or parquet/csv file."""
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
