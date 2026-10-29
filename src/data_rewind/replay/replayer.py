"""Data Rewind Historical Replayer.

Conforms strictly to Section 3 of SPEC-MOD-03.
Evaluates prerequisites and returns one of five canonical outcomes:
- REPRODUCIBLE
- PARTIALLY_REPRODUCIBLE
- BLOCKED_MISSING_ARTIFACTS
- DIVERGENT
- FAILED_VERIFICATION
"""

from __future__ import annotations

import time
from pathlib import Path
from typing import Any
from uuid import uuid4

from data_rewind.core.domain.models import (
    OperationType,
    RunLifecycle,
    TransformationStep,
)
from data_rewind.core.integrity.hashing import (
    compute_content_hash,
    compute_pipeline_definition_hash,
)
from data_rewind.core.integrity.manifest import ReplayManifest
from data_rewind.execution.engine import PipelineExecutor
from data_rewind.execution.models import ExecutionOptions
from data_rewind.replay.models import (
    ReplayOutcome,
    ReplayResult,
    ReplayStepVerification,
)


class HistoricalReplayer:
    """Re-executes historical pipeline runs against pinned artifacts to verify determinism."""

    @classmethod
    def replay_run(
        cls,
        manifest: ReplayManifest,
        workspace_root: Path,
        historical_step_hashes: dict[str, str] | None = None,
        float_tolerance: float = 1e-6,
        historical_tables: dict[str, Any] | None = None,
    ) -> ReplayResult:
        """Evaluate prerequisites and replay run deterministically."""
        start_time = time.perf_counter()
        replay_id = uuid4()
        root = workspace_root.resolve()

        # 1. Verify existence of raw input artifacts by SHA-256 (SPEC-MOD-03 §3.4)
        inputs_map: dict[str, Path] = {}
        missing_artifacts: list[str] = []

        for inp in manifest.inputs:
            found_path = cls._find_input_artifact(root, inp.input_id, inp.content_hash)
            if found_path is None:
                missing_artifacts.append(f"{inp.input_id} (hash {inp.content_hash})")
            else:
                inputs_map[inp.input_id] = found_path

        if missing_artifacts:
            elapsed = (time.perf_counter() - start_time) * 1000.0
            first_missing = missing_artifacts[0]
            return ReplayResult(
                replay_run_id=replay_id,
                historical_run_id=manifest.run_id,
                outcome=ReplayOutcome.BLOCKED_MISSING_ARTIFACTS,
                explanation=(
                    f"Replay blocked: Raw input artifact '{first_missing}' "
                    f"is no longer retained in workspace storage."
                ),
                missing_artifacts=missing_artifacts,
                execution_duration_ms=round(elapsed, 3),
            )

        # 2. Reconstruct DAG steps from snapshot
        try:
            steps: list[TransformationStep] = []
            for snap in manifest.steps_snapshot:
                # Infer input dependencies if empty
                input_deps = list(snap.input_step_ids)
                if not input_deps and manifest.inputs:
                    input_deps = [manifest.inputs[0].input_id]

                steps.append(
                    TransformationStep(
                        step_id=snap.step_id,
                        operation_type=OperationType(snap.operation),
                        input_step_ids=input_deps,
                        parameters=dict(snap.parameters),
                    )
                )
        except Exception as exc:
            elapsed = (time.perf_counter() - start_time) * 1000.0
            return ReplayResult(
                replay_run_id=replay_id,
                historical_run_id=manifest.run_id,
                outcome=ReplayOutcome.FAILED_VERIFICATION,
                explanation=f"Replay execution failed during DAG reconstruction: {exc}",
                execution_duration_ms=round(elapsed, 3),
            )

        # 2b. Verify pipeline definition integrity (SPEC-MOD-03 §3.4 Requirement 2)
        computed_def_hash = compute_pipeline_definition_hash(steps)
        if (
            manifest.pipeline_definition_hash
            and manifest.pipeline_definition_hash != "0" * 64
            and manifest.pipeline_definition_hash
            != "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
            and computed_def_hash != manifest.pipeline_definition_hash
        ):
            elapsed = (time.perf_counter() - start_time) * 1000.0
            return ReplayResult(
                replay_run_id=replay_id,
                historical_run_id=manifest.run_id,
                outcome=ReplayOutcome.FAILED_VERIFICATION,
                explanation=(
                    f"Pipeline definition integrity failure: computed definition hash "
                    f"'{computed_def_hash}' does not match manifest pipeline_definition_hash "
                    f"'{manifest.pipeline_definition_hash}'."
                ),
                execution_duration_ms=round(elapsed, 3),
            )

        # 3. Execute pipeline in isolated sandbox
        exec_options = ExecutionOptions(
            workspace_root=root,
            fail_fast=True,
            export_intermediate_checkpoints=True,
        )
        exec_res = PipelineExecutor.execute_pipeline(
            steps=steps,
            inputs=inputs_map,  # type: ignore[arg-type]
            options=exec_options,
            run_id=replay_id,
        )

        elapsed = (time.perf_counter() - start_time) * 1000.0

        if exec_res.status == RunLifecycle.FAILED:
            return ReplayResult(
                replay_run_id=replay_id,
                historical_run_id=manifest.run_id,
                outcome=ReplayOutcome.FAILED_VERIFICATION,
                explanation=(
                    f"Replay execution failed during evaluation at step "
                    f"'{exec_res.failed_step_id}': {exec_res.error_message}"
                ),
                execution_duration_ms=round(elapsed, 3),
            )

        # 4. Compare replayed output multiset hashes against historical records
        step_verifications: dict[str, ReplayStepVerification] = {}
        late_divergence_step: str | None = None
        has_divergence = False
        has_missing_hashes = False
        has_partial_match = False

        hist_hashes: dict[str, str] = {}
        if historical_step_hashes is not None:
            hist_hashes = dict(historical_step_hashes)
        else:
            for snap in manifest.steps_snapshot:
                if snap.output_multiset_hash is not None:
                    hist_hashes[snap.step_id] = snap.output_multiset_hash

        for sid in exec_res.topological_order:
            step_result = exec_res.step_results.get(sid)
            replayed_hash = step_result.multiset_hash if step_result else None
            hist_hash = hist_hashes.get(sid)

            if hist_hash is not None and replayed_hash is not None:
                if hist_hash == replayed_hash:
                    step_verifications[sid] = ReplayStepVerification(
                        step_id=sid,
                        historical_multiset_hash=hist_hash,
                        replayed_multiset_hash=replayed_hash,
                        is_matched=True,
                        is_late_divergence_point=False,
                        variance_details=None,
                    )
                else:
                    # Output multiset hash differs. Check if within float tolerance or row reordering.
                    is_within_tolerance = False
                    tolerance_detail: str | None = None

                    hist_table = historical_tables.get(sid) if historical_tables else None
                    if hist_table is None:
                        hist_table = cls._find_step_artifact(root, sid, hist_hash)

                    if (
                        hist_table is not None
                        and step_result is not None
                        and step_result.parquet_path
                    ):
                        is_within_tolerance, tolerance_detail = cls._check_tolerance(
                            hist_table, step_result.parquet_path, float_tolerance
                        )

                    if is_within_tolerance:
                        has_partial_match = True
                        step_verifications[sid] = ReplayStepVerification(
                            step_id=sid,
                            historical_multiset_hash=hist_hash,
                            replayed_multiset_hash=replayed_hash,
                            is_matched=True,
                            is_late_divergence_point=False,
                            variance_details=tolerance_detail or "Matches within float tolerance",
                        )
                    else:
                        is_late_point = False
                        if not has_divergence:
                            has_divergence = True
                            is_late_point = True
                            late_divergence_step = sid

                        step_verifications[sid] = ReplayStepVerification(
                            step_id=sid,
                            historical_multiset_hash=hist_hash,
                            replayed_multiset_hash=replayed_hash,
                            is_matched=False,
                            is_late_divergence_point=is_late_point,
                            variance_details="Output multiset hash diverged",
                        )
            else:
                has_missing_hashes = True
                step_verifications[sid] = ReplayStepVerification(
                    step_id=sid,
                    historical_multiset_hash=hist_hash,
                    replayed_multiset_hash=replayed_hash,
                    is_matched=False,
                    variance_details="Missing historical multiset hash; output unverifiable",
                )

        if has_missing_hashes and not hist_hashes:
            return ReplayResult(
                replay_run_id=replay_id,
                historical_run_id=manifest.run_id,
                outcome=ReplayOutcome.FAILED_VERIFICATION,
                explanation=(
                    "Replay verification incomplete: historical output multiset hashes are missing "
                    "from the manifest and verification cannot be proven."
                ),
                step_verifications=step_verifications,
                execution_duration_ms=round(elapsed, 3),
            )

        if has_divergence:
            return ReplayResult(
                replay_run_id=replay_id,
                historical_run_id=manifest.run_id,
                outcome=ReplayOutcome.DIVERGENT,
                explanation=(
                    f"Divergence detected: Engine re-execution produced output hashes differing "
                    f"from historical records starting at step '{late_divergence_step}'."
                ),
                step_verifications=step_verifications,
                late_divergence_step_id=late_divergence_step,
                execution_duration_ms=round(elapsed, 3),
            )

        if has_partial_match or has_missing_hashes:
            explanation = (
                "Historical run partially reproduced: step outputs match within configured "
                "floating-point/row-order tolerances."
                if has_partial_match
                else "Historical run partially reproduced: available checkpoints matched 100%, "
                "but some intermediate step hashes were not recorded in manifest."
            )
            return ReplayResult(
                replay_run_id=replay_id,
                historical_run_id=manifest.run_id,
                outcome=ReplayOutcome.PARTIALLY_REPRODUCIBLE,
                explanation=explanation,
                step_verifications=step_verifications,
                execution_duration_ms=round(elapsed, 3),
            )

        return ReplayResult(
            replay_run_id=replay_id,
            historical_run_id=manifest.run_id,
            outcome=ReplayOutcome.REPRODUCIBLE,
            explanation="Historical run successfully reproduced with 100% mathematical equivalence.",
            step_verifications=step_verifications,
            execution_duration_ms=round(elapsed, 3),
        )

    @classmethod
    def _find_step_artifact(
        cls, workspace_root: Path, step_id: str, expected_hash: str | None = None
    ) -> Path | None:
        """Find historical step output artifact in workspace."""
        candidate_dirs = [
            workspace_root / "checkpoints",
            workspace_root / "artifacts",
            workspace_root,
        ]
        candidates: list[Path] = []
        for d in candidate_dirs:
            if expected_hash:
                candidates.extend(
                    [
                        d / f"{expected_hash}.parquet",
                        d / f"{expected_hash}.csv",
                    ]
                )
            candidates.extend(
                [
                    d / f"{step_id}.parquet",
                    d / f"{step_id}.csv",
                ]
            )
        for c in candidates:
            if c.is_file():
                return c
        return None

    @classmethod
    def _check_tolerance(
        cls,
        hist_table: Path | list[dict[str, Any]],
        replayed_parquet: Path,
        float_tolerance: float,
    ) -> tuple[bool, str | None]:
        """Verify whether differences are within acceptable float tolerance or row reordering."""
        try:
            import duckdb

            from data_rewind.comparator.engine import TabularComparator
            from data_rewind.comparator.models import CaseClassification, ComparisonConfig

            conn = duckdb.connect(":memory:")
            try:
                replayed_posix = replayed_parquet.resolve().as_posix()
                conn.execute(f"CREATE TABLE replayed AS SELECT * FROM '{replayed_posix}'")

                # Attempt to infer a candidate key for row alignment in numeric comparisons
                inferred_pk: list[str] = []
                if isinstance(hist_table, list) and hist_table:
                    first_row = hist_table[0]
                    for candidate in ("id", "order_id", "txn_id", "metric_id", "account_id"):
                        if candidate in first_row:
                            inferred_pk = [candidate]
                            break
                    if not inferred_pk:
                        non_floats = [k for k, v in first_row.items() if not isinstance(v, float)]
                        if non_floats and len(non_floats) < len(first_row):
                            inferred_pk = non_floats

                    cmp_cfg = ComparisonConfig(
                        primary_key=inferred_pk,
                        atol=float_tolerance,
                        rtol=float_tolerance,
                    )
                    cols = [d[0] for d in conn.execute("SELECT * FROM replayed").description]
                    replayed_rows = [
                        dict(zip(cols, r, strict=False))
                        for r in conn.execute("SELECT * FROM replayed").fetchall()
                    ]
                    diff_res = TabularComparator.compare(hist_table, replayed_rows, config=cmp_cfg)
                elif isinstance(hist_table, (Path, str)):
                    hist_path = Path(hist_table).resolve()
                    hist_posix = hist_path.as_posix()
                    if hist_posix.lower().endswith(".csv"):
                        conn.execute(
                            f"CREATE TABLE hist AS SELECT * FROM read_csv_auto('{hist_posix}')"
                        )
                    else:
                        conn.execute(f"CREATE TABLE hist AS SELECT * FROM '{hist_posix}'")

                    cols_info = conn.execute("PRAGMA table_info('replayed')").fetchall()
                    col_names = [r[1] for r in cols_info]
                    for candidate in ("id", "order_id", "txn_id", "metric_id", "account_id"):
                        if candidate in col_names:
                            inferred_pk = [candidate]
                            break

                    cmp_cfg = ComparisonConfig(
                        primary_key=inferred_pk,
                        atol=float_tolerance,
                        rtol=float_tolerance,
                    )
                    diff_res = TabularComparator.compare_tables(
                        conn, "hist", "replayed", config=cmp_cfg
                    )

                row_count_match = diff_res.baseline_row_count == diff_res.target_row_count
                if (
                    row_count_match
                    and not diff_res.schema_diff.added_columns
                    and not diff_res.schema_diff.removed_columns
                ):
                    if diff_res.is_equal or (
                        diff_res.modified_count == 0
                        and diff_res.added_count == 0
                        and diff_res.removed_count == 0
                    ):
                        return True, "Matches within float tolerance or row reordering"
                    if (
                        CaseClassification.CASE_11_FLOAT_TOLERANCE in diff_res.case_classifications
                        and diff_res.added_count == 0
                        and diff_res.removed_count == 0
                    ):
                        return (
                            True,
                            f"Numeric variance within tolerance (float_tolerance <= {float_tolerance})",
                        )
                    if (
                        CaseClassification.CASE_6_REORDERED_ROWS in diff_res.case_classifications
                        and diff_res.modified_count == 0
                    ):
                        return True, "Row order drift only; multiset identical"
            finally:
                conn.close()
        except Exception:
            return False, None
        return False, None

    @classmethod
    def _find_input_artifact(
        cls, workspace_root: Path, input_id: str, expected_hash: str
    ) -> Path | None:
        """Find an input artifact matching expected SHA-256 hash in workspace vault."""
        candidate_dirs = [
            workspace_root / "raw_inputs",
            workspace_root / "artifacts",
            workspace_root,
        ]

        # Specific candidate file names
        candidates: list[Path] = []
        for d in candidate_dirs:
            candidates.extend(
                [
                    d / f"{expected_hash}.csv",
                    d / f"{expected_hash}.parquet",
                    d / f"{input_id}.csv",
                    d / f"{input_id}.parquet",
                ]
            )

        for cand in candidates:
            if cand.is_file():
                try:
                    if compute_content_hash(cand) == expected_hash:
                        return cand
                except Exception:
                    continue

        # Broader search in candidate dirs for any matching hash
        for d in candidate_dirs:
            if d.is_dir():
                for f in d.iterdir():
                    if f.is_file() and f.suffix.lower() in (".csv", ".parquet"):
                        try:
                            if compute_content_hash(f) == expected_hash:
                                return f
                        except Exception:
                            continue

        return None
