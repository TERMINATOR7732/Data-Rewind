"""Demonstration scenario endpoints (SCN-01 to SCN-04).

Conforms to SPEC-MOD-01, SPEC-MOD-04, and Decision D-04.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

from data_rewind.api.dependencies import APIDependencies
from data_rewind.api.schemas import ScenarioSummary, VerificationRunRequest
from data_rewind.core.domain.errors import DataRewindError
from data_rewind.scenarios.definitions import SCENARIO_REGISTRY
from data_rewind.scenarios.runner import ScenarioRunner
from data_rewind.verification.models import IntentionalUpdateContract

router = APIRouter(prefix="/scenarios", tags=["Demonstration Scenarios"])


@router.get("", response_model=list[ScenarioSummary])
def list_scenarios() -> list[ScenarioSummary]:
    """List all registered demonstration scenarios with metadata."""
    results: list[ScenarioSummary] = []
    for s in ScenarioRunner.get_available_scenarios():
        results.append(
            ScenarioSummary(
                scenario_id=s.scenario_id,
                title=s.title,
                description=s.description,
                expected_eod_step=s.expected_eod_step,
                expected_rule_id=(
                    s.expected_rule_id.value
                    if hasattr(s.expected_rule_id, "value")
                    else str(s.expected_rule_id)
                ),
                step_count=len(s.steps),
                input_tables=list(s.baseline_inputs.keys()),
                primary_keys_by_step=s.primary_keys_by_step,
            )
        )
    return results


@router.get("/{scenario_id}")
def get_scenario(scenario_id: str) -> dict[str, Any]:
    """Retrieve full details of a specific scenario including steps and inputs."""
    sid = scenario_id.lower()
    if sid not in SCENARIO_REGISTRY:
        raise HTTPException(
            status_code=404,
            detail=f"Scenario '{scenario_id}' not found. Available: {list(SCENARIO_REGISTRY.keys())}",
        )
    s = SCENARIO_REGISTRY[sid]
    return {
        "scenario_id": s.scenario_id,
        "title": s.title,
        "description": s.description,
        "expected_eod_step": s.expected_eod_step,
        "expected_rule_id": (
            s.expected_rule_id.value
            if hasattr(s.expected_rule_id, "value")
            else str(s.expected_rule_id)
        ),
        "primary_keys_by_step": s.primary_keys_by_step,
        "steps": [step.model_dump() for step in s.steps],
        "target_steps": [step.model_dump() for step in (s.target_steps or [])],
        "baseline_inputs": {k: len(v) for k, v in s.baseline_inputs.items()},
        "target_inputs": {k: len(v) for k, v in s.target_inputs.items()},
    }


@router.post("/{scenario_id}/run")
def run_scenario(scenario_id: str) -> dict[str, Any]:
    """Execute scenario end-to-end and return the complete forensic investigation."""
    sid = scenario_id.lower()
    if sid not in SCENARIO_REGISTRY:
        raise HTTPException(
            status_code=404,
            detail=f"Scenario '{scenario_id}' not found.",
        )

    ws_dir = APIDependencies.get_workspace_dir()
    repo = APIDependencies.get_investigation_repository()

    try:
        investigation = ScenarioRunner.run_scenario(
            scenario_id=sid,
            workspace_root=ws_dir,
            repository=repo,
        )
        return investigation.model_dump()
    except DataRewindError as exc:
        raise HTTPException(
            status_code=400,
            detail={"code": exc.code, "message": str(exc), "details": exc.details},
        ) from exc


@router.post("/{scenario_id}/verify")
def verify_scenario(scenario_id: str, request: VerificationRunRequest) -> dict[str, Any]:
    """Execute Tri-Run Fix Verification for a scenario under specified remediation mode."""
    sid = scenario_id.lower()
    if sid not in SCENARIO_REGISTRY:
        raise HTTPException(
            status_code=404,
            detail=f"Scenario '{scenario_id}' not found.",
        )

    ws_dir = APIDependencies.get_workspace_dir()
    repo = APIDependencies.get_verification_repository()

    contract: IntentionalUpdateContract | None = None
    if request.intentional_contract:
        contract = IntentionalUpdateContract.model_validate(request.intentional_contract)

    try:
        dossier = ScenarioRunner.verify_scenario_fix(
            scenario_id=sid,
            workspace_root=ws_dir,
            fix_mode=request.fix_mode,
            intentional_contract=contract,
            repository=repo,
        )
        return dossier.model_dump()
    except DataRewindError as exc:
        raise HTTPException(
            status_code=400,
            detail={"code": exc.code, "message": str(exc), "details": exc.details},
        ) from exc
