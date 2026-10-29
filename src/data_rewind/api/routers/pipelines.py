"""Pipeline definition validation and execution endpoints.

Conforms to SPEC-MOD-01, SPEC-MOD-03, and SPEC-MOD-07 §3.1.
"""

from __future__ import annotations

import json
import time
from typing import Any
from uuid import uuid4

import duckdb
from fastapi import APIRouter, HTTPException

from data_rewind.api.dependencies import APIDependencies
from data_rewind.api.schemas import (
    PipelineExecuteRequest,
    PipelineValidateRequest,
    PipelineValidateResponse,
)
from data_rewind.core.dag.validator import DAGValidator
from data_rewind.core.domain.errors import DataRewindError
from data_rewind.core.domain.models import TransformationStep
from data_rewind.core.expr.ast_sandbox import ASTSecurityValidator
from data_rewind.execution.engine import PipelineExecutor
from data_rewind.execution.models import ExecutionOptions

router = APIRouter(prefix="/pipelines", tags=["Pipelines & Execution"])


@router.post("/validate", response_model=PipelineValidateResponse)
def validate_pipeline(request: PipelineValidateRequest) -> PipelineValidateResponse:
    """Validate pipeline DAG topology, cycle detection, and AST expression security."""
    try:
        steps = [TransformationStep.model_validate(s) for s in request.steps]
    except Exception as exc:
        return PipelineValidateResponse(
            valid=False,
            error_message=f"Step schema validation error: {exc}",
        )

    # Validate AST expressions in steps
    for s in steps:
        if "predicate" in s.parameters:
            try:
                ASTSecurityValidator.validate(str(s.parameters["predicate"]))
            except Exception as exc:
                return PipelineValidateResponse(
                    valid=False,
                    error_message=f"Step '{s.step_id}' predicate security violation: {exc}",
                )
        if "expression" in s.parameters:
            try:
                ASTSecurityValidator.validate(str(s.parameters["expression"]))
            except Exception as exc:
                return PipelineValidateResponse(
                    valid=False,
                    error_message=f"Step '{s.step_id}' expression security violation: {exc}",
                )

    # Validate DAG topological order and detect cycles
    try:
        step_ids = {s.step_id for s in steps}
        inferred_inputs = request.inputs or list(
            {dep for s in steps for dep in s.input_step_ids if dep not in step_ids}
        )
        topo_order = DAGValidator.validate_and_order(steps, inferred_inputs)
        return PipelineValidateResponse(valid=True, topological_order=topo_order)
    except DataRewindError as exc:
        return PipelineValidateResponse(valid=False, error_message=str(exc))
    except Exception as exc:
        return PipelineValidateResponse(valid=False, error_message=f"DAG validation error: {exc}")


@router.post("/execute")
def execute_pipeline(request: PipelineExecuteRequest) -> dict[str, Any]:
    """Execute declarative pipeline steps and materialize Parquet checkpoints."""
    settings = APIDependencies.get_settings()
    if settings.profile == "hosted_demo":
        raise HTTPException(
            status_code=403,
            detail={
                "code": "FEATURE_RESTRICTED_IN_DEMO",
                "message": (
                    "Ad-hoc pipeline execution is restricted in the hosted portfolio demonstration. "
                    "Use the Demo Sandbox to test full forensic investigations on synthetic datasets, "
                    "or run Data Rewind locally for full Developer Mode pipeline execution."
                ),
                "remediation": "Select one of the 4 demonstration scenarios from Demo Sandbox, or run Data Rewind locally.",
            },
        )
    ws_dir = APIDependencies.get_workspace_dir()
    run_id = uuid4()

    try:
        steps = [TransformationStep.model_validate(s) for s in request.steps]
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail={"code": "SCHEMA_VALIDATION_ERROR", "message": str(exc)},
        ) from exc

    inputs_data: dict[str, Any] = dict(request.inputs)

    # If dataset_ids provided, load from raw_inputs
    if request.dataset_ids:
        raw_dir = APIDependencies.get_raw_inputs_dir()

        for input_name, ds_id in request.dataset_ids.items():
            csv_path = raw_dir / f"{ds_id}.csv"
            if not csv_path.exists():
                for meta_f in raw_dir.glob("*.meta.json"):
                    m = json.loads(meta_f.read_text(encoding="utf-8"))
                    if m.get("dataset_id") == ds_id:
                        csv_path = raw_dir / f"{m['sha256_hash']}.csv"
                        break
            if csv_path.exists():
                con = duckdb.connect(":memory:")
                cur = con.execute(f"SELECT * FROM read_csv_auto('{csv_path.as_posix()}')")
                cols = [desc[0] for desc in cur.description]
                rows = cur.fetchall()
                con.close()
                inputs_data[input_name] = [dict(zip(cols, r, strict=False)) for r in rows]

    options = ExecutionOptions(
        workspace_root=ws_dir,
        fail_fast=True,
        export_intermediate_checkpoints=True,
    )

    start_time = time.perf_counter()
    try:
        execution_result = PipelineExecutor.execute_pipeline(
            steps=steps,
            inputs=inputs_data,
            options=options,
            run_id=run_id,
        )
        duration_ms = (time.perf_counter() - start_time) * 1000.0

        return {
            "run_id": str(execution_result.run_id),
            "status": execution_result.status.value,
            "duration_ms": round(duration_ms, 2),
            "step_results": {
                sid: {
                    "step_id": res.step_id,
                    "status": res.status.value,
                    "row_count": res.row_count,
                    "output_hash": res.multiset_hash,
                    "execution_time_ms": res.duration_ms,
                    "error_message": res.error_message,
                }
                for sid, res in execution_result.step_results.items()
            },
        }
    except DataRewindError as exc:
        raise HTTPException(
            status_code=400,
            detail={"code": exc.code, "message": str(exc), "details": exc.details},
        ) from exc
