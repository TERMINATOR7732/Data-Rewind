"""Data Rewind Demonstration Scenario Runner.

Conforms to Decision D-04 and SPEC-MOD-01/04.
Executes synthetic demo scenarios end-to-end and returns complete investigations.
"""

from __future__ import annotations

from pathlib import Path
from uuid import uuid4

from data_rewind.core.domain.errors import DataRewindError
from data_rewind.execution.engine import PipelineExecutor
from data_rewind.execution.models import ExecutionOptions
from data_rewind.investigation.models import Investigation
from data_rewind.investigation.orchestrator import InvestigationOrchestrator
from data_rewind.investigation.persistence import InvestigationRepository
from data_rewind.scenarios.definitions import SCENARIO_REGISTRY, ScenarioDefinition


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
