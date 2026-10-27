"""Data Rewind Demonstration Scenario Runner.

Conforms to Decision D-04 and SPEC-MOD-01/04.
Executes synthetic demo scenarios end-to-end and returns complete investigations.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any
from uuid import uuid4

from data_rewind.core.domain.errors import DataRewindError
from data_rewind.core.domain.models import TransformationStep
from data_rewind.execution.engine import PipelineExecutor
from data_rewind.execution.models import ExecutionOptions
from data_rewind.investigation.models import Investigation
from data_rewind.investigation.orchestrator import InvestigationOrchestrator
from data_rewind.investigation.persistence import InvestigationRepository
from data_rewind.scenarios.definitions import SCENARIO_REGISTRY, ScenarioDefinition
from data_rewind.verification.models import ForensicDossier, IntentionalUpdateContract
from data_rewind.verification.orchestrator import FixVerificationOrchestrator
from data_rewind.verification.persistence import VerificationRepository


class ScenarioRunner:
    """Executes deterministic demonstration scenarios against the pipeline and comparator."""

    @classmethod
    def get_available_scenarios(cls) -> list[ScenarioDefinition]:
        """Return list of all registered demonstration scenarios."""
        return list(SCENARIO_REGISTRY.values())

    @classmethod
    def run_scenario(
        cls,
        scenario_id: str,
        workspace_root: Path,
        repository: InvestigationRepository | None = None,
    ) -> Investigation:
        """Execute a specific demonstration scenario end-to-end."""
        sid = scenario_id.lower()
        if sid not in SCENARIO_REGISTRY:
            raise DataRewindError(
                f"Unknown scenario ID: '{scenario_id}'. Available: {list(SCENARIO_REGISTRY.keys())}",
                code="UNKNOWN_SCENARIO",
            )

        scenario = SCENARIO_REGISTRY[sid]
        root = workspace_root.resolve()

        baseline_run_id = uuid4()
        target_run_id = uuid4()

        options = ExecutionOptions(
            workspace_root=root,
            fail_fast=True,
            export_intermediate_checkpoints=True,
        )

        # 1. Execute baseline pipeline
        base_exec = PipelineExecutor.execute_pipeline(
            steps=scenario.steps,
            inputs=scenario.baseline_inputs,  # type: ignore[arg-type]
            options=options,
            run_id=baseline_run_id,
        )

        # 2. Execute target pipeline
        target_steps = scenario.target_steps or scenario.steps
        targ_exec = PipelineExecutor.execute_pipeline(
            steps=target_steps,
            inputs=scenario.target_inputs,  # type: ignore[arg-type]
            options=options,
            run_id=target_run_id,
        )

        # 3. Gather checkpoint paths for comparison
        base_step_data = {
            s: res.parquet_path
            for s, res in base_exec.step_results.items()
            if res.parquet_path is not None
        }
        targ_step_data = {
            s: res.parquet_path
            for s, res in targ_exec.step_results.items()
            if res.parquet_path is not None
        }

        # 4. Orchestrate investigation
        investigation = InvestigationOrchestrator.investigate_runs(
            title=f"Scenario {scenario.scenario_id.upper()}: {scenario.title}",
            baseline_run_id=baseline_run_id,
            target_run_id=target_run_id,
            steps=scenario.steps,
            target_steps=scenario.target_steps,
            baseline_step_data=base_step_data,  # type: ignore[arg-type]
            target_step_data=targ_step_data,  # type: ignore[arg-type]
            primary_keys_by_step=scenario.primary_keys_by_step,
            repository=repository,
        )

        return investigation

    @classmethod
    def verify_scenario_fix(
        cls,
        scenario_id: str,
        workspace_root: Path,
        fix_mode: str = "clean",
        intentional_contract: IntentionalUpdateContract | None = None,
        repository: VerificationRepository | None = None,
    ) -> ForensicDossier:
        """Execute Tri-Run Fix Verification for a scenario under specified remediation mode."""
        sid = scenario_id.lower()
        if sid not in SCENARIO_REGISTRY:
            raise DataRewindError(
                f"Unknown scenario ID: '{scenario_id}'. Available: {list(SCENARIO_REGISTRY.keys())}",
                code="UNKNOWN_SCENARIO",
            )

        scenario = SCENARIO_REGISTRY[sid]
        root = workspace_root.resolve()

        baseline_run_id = uuid4()
        faulted_run_id = uuid4()
        candidate_run_id = uuid4()

        options = ExecutionOptions(
            workspace_root=root,
            fail_fast=True,
            export_intermediate_checkpoints=True,
        )

        # 1. Execute R0 (Baseline Run)
        base_exec = PipelineExecutor.execute_pipeline(
            steps=scenario.steps,
            inputs=scenario.baseline_inputs,  # type: ignore[arg-type]
            options=options,
            run_id=baseline_run_id,
        )

        # 2. Execute R1 (Faulted Run)
        target_steps = scenario.target_steps or scenario.steps
        fault_exec = PipelineExecutor.execute_pipeline(
            steps=target_steps,
            inputs=scenario.target_inputs,  # type: ignore[arg-type]
            options=options,
            run_id=faulted_run_id,
        )

        # 3. Formulate Candidate (R2) Inputs & Steps based on fix_mode
        fix_inputs = dict(scenario.baseline_inputs)
        fix_steps = list(scenario.steps)

        if fix_mode == "unresolved":
            # Candidate fix produced identical output to faulted run
            fix_inputs = dict(scenario.target_inputs)
            fix_steps = list(target_steps)
        elif fix_mode == "collateral":
            # Fixes EOD, but modifies unrelated step or introduces unexpected filter
            fix_inputs = dict(scenario.baseline_inputs)
            # Add an extra condition to the final step or first step that filters out data
            mutated_steps: list[TransformationStep] = []
            for s in scenario.steps:
                if s.step_id == scenario.expected_eod_step:
                    mutated_steps.append(s)
                else:
                    # Mutate non-EOD step parameters to trigger collateral regression
                    new_params = dict(s.parameters)
                    if "predicate" in new_params:
                        new_params["predicate"] = f"({new_params['predicate']}) and 1 == 2"
                    mutated_steps.append(
                        TransformationStep(
                            step_id=s.step_id,
                            operation_type=s.operation_type,
                            input_step_ids=list(s.input_step_ids),
                            parameters=new_params,
                        )
                    )
            fix_steps = mutated_steps
        elif fix_mode == "partial":
            # Partially fixes target inputs (e.g. blend of baseline and target)
            partial_inputs: dict[str, list[dict[str, Any]]] = {}
            for k, b_rows in scenario.baseline_inputs.items():
                t_rows = scenario.target_inputs.get(k, b_rows)
                # Keep half from target, half from baseline
                if len(t_rows) > 1:
                    partial_inputs[k] = [t_rows[0]] + b_rows[1:]
                else:
                    partial_inputs[k] = t_rows
            fix_inputs = partial_inputs
        elif fix_mode == "intentional":
            # Candidate intentional update
            fix_inputs = dict(scenario.baseline_inputs)
            fix_steps = list(scenario.steps)

        # 4. Execute R2 (Candidate Fix Run)
        cand_exec = PipelineExecutor.execute_pipeline(
            steps=fix_steps,
            inputs=fix_inputs,  # type: ignore[arg-type]
            options=options,
            run_id=candidate_run_id,
        )

        # 5. Collect checkpoints
        base_step_data = {
            s: res.parquet_path
            for s, res in base_exec.step_results.items()
            if res.parquet_path is not None
        }
        fault_step_data = {
            s: res.parquet_path
            for s, res in fault_exec.step_results.items()
            if res.parquet_path is not None
        }
        cand_step_data = {
            s: res.parquet_path
            for s, res in cand_exec.step_results.items()
            if res.parquet_path is not None
        }

        # 6. Run Tri-Run Verification Orchestration
        dossier = FixVerificationOrchestrator.verify_fix(
            title=f"Fix Verification: {scenario.title} ({fix_mode.upper()})",
            baseline_run_id=baseline_run_id,
            faulted_run_id=faulted_run_id,
            candidate_run_id=candidate_run_id,
            steps=scenario.steps,
            baseline_step_data=base_step_data,  # type: ignore[arg-type]
            faulted_step_data=fault_step_data,  # type: ignore[arg-type]
            candidate_step_data=cand_step_data,  # type: ignore[arg-type]
            primary_keys_by_step=scenario.primary_keys_by_step,
            eod_step_id=scenario.expected_eod_step,
            intentional_contract=intentional_contract,
            pipeline_name=f"Scenario {scenario.scenario_id.upper()}",
            repository=repository,
        )

        return dossier
