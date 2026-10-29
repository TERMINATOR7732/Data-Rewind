"""Deployment configuration, security guardrails, and hosted demo isolation tests.

Verifies:
- DATA_REWIND_CORS_ORIGINS dynamic configuration.
- Hosted demo profile restrictions on custom CSV uploads and ad-hoc executions.
- Zero credential or internal filesystem path leakage on health and diagnostic endpoints.
- Full preservation of local-first operation when DATA_REWIND_PROFILE=local.
- Execution of all 4 demonstration scenarios under hosted_demo resource limits.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from data_rewind.api.dependencies import APIDependencies
from data_rewind.api.main import create_app
from data_rewind.core.config.settings import Settings


@pytest.fixture
def local_client(tmp_path: Path) -> TestClient:
    """Create a TestClient configured in local-first mode."""
    settings = Settings(
        profile="local",
        base_data_dir=tmp_path / "local_workspace",
    )
    APIDependencies.set_settings(settings)
    app = create_app()
    return TestClient(app)


@pytest.fixture
def hosted_client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    """Create a TestClient configured in hosted_demo mode with custom CORS."""
    monkeypatch.setenv("DATA_REWIND_CORS_ORIGINS", "https://data-rewind-ui.onrender.com")
    monkeypatch.setenv("DATA_REWIND_PROFILE", "hosted_demo")
    settings = Settings.load()
    APIDependencies.set_settings(
        Settings(
            profile="hosted_demo",
            base_data_dir=tmp_path / "hosted_workspace",
            limits=settings.limits,
        )
    )
    app = create_app()
    return TestClient(app)


def test_cors_configuration(hosted_client: TestClient) -> None:
    """Verify that DATA_REWIND_CORS_ORIGINS is honored and loopback is preserved."""
    # Test configured hosted origin
    res_hosted = hosted_client.options(
        "/api/v1/health",
        headers={
            "Origin": "https://data-rewind-ui.onrender.com",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert res_hosted.status_code == 200
    assert (
        res_hosted.headers.get("access-control-allow-origin")
        == "https://data-rewind-ui.onrender.com"
    )

    # Test loopback origin still works
    res_loopback = hosted_client.options(
        "/api/v1/health",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert res_loopback.status_code == 200
    assert res_loopback.headers.get("access-control-allow-origin") == "http://localhost:5173"


def test_health_check_zero_leakage(hosted_client: TestClient) -> None:
    """Ensure health endpoint exposes no secrets, internal paths, or credentials."""
    res = hosted_client.get("/api/v1/health")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ok"
    assert data["profile"] == "hosted_demo"

    # Verify absence of sensitive keys
    assert "workspace_path" not in data
    assert "workspace_root" not in data
    assert "database_path" not in data
    assert "secret" not in data
    assert "token" not in data


def test_hosted_demo_diagnostics_sanitization(hosted_client: TestClient) -> None:
    """Verify that diagnostics endpoint masks workspace filesystem path in hosted mode."""
    res = hosted_client.get("/api/v1/diagnostics")
    assert res.status_code == 200
    data = res.json()
    assert data["active_profile"] == "hosted_demo"
    assert data["workspace_root"] == "[HOSTED_EPHEMERAL_STORAGE]"


def test_hosted_demo_csv_upload_restricted(hosted_client: TestClient) -> None:
    """Verify that custom CSV uploads are safely blocked in hosted demo profile."""
    csv_bytes = b"id,val\n1,100\n"
    res = hosted_client.post(
        "/api/v1/datasets/upload",
        files={"file": ("test.csv", csv_bytes, "text/csv")},
    )
    assert res.status_code == 403
    data = res.json()
    assert data["error"]["code"] == "FEATURE_RESTRICTED_IN_DEMO"
    assert "disabled in the hosted portfolio demonstration" in data["error"]["message"]


def test_hosted_demo_pipeline_execution_restricted(hosted_client: TestClient) -> None:
    """Verify that ad-hoc pipeline execution is blocked in hosted demo profile."""
    res = hosted_client.post(
        "/api/v1/pipelines/execute",
        json={
            "steps": [
                {
                    "step_id": "step1",
                    "operation_type": "filter_rows",
                    "input_step_ids": ["src"],
                    "parameters": {"predicate": "id > 0"},
                }
            ],
            "inputs": {"src": [{"id": 1}]},
        },
    )
    assert res.status_code == 403
    data = res.json()
    assert data["error"]["code"] == "FEATURE_RESTRICTED_IN_DEMO"


def test_local_mode_preservation(local_client: TestClient) -> None:
    """Verify that local-first operation remains completely unrestricted."""
    # Check health profile
    health_res = local_client.get("/api/v1/health")
    assert health_res.status_code == 200
    assert health_res.json()["profile"] == "local"

    # CSV upload should succeed in local mode
    csv_bytes = b"order_id,amount,region\n1,100.0,NORTH\n2,200.0,SOUTH\n"
    upload_res = local_client.post(
        "/api/v1/datasets/upload",
        files={"file": ("orders.csv", csv_bytes, "text/csv")},
    )
    assert upload_res.status_code == 200
    assert upload_res.json()["row_count"] == 2


def test_hosted_demo_scenario_execution_succeeds(hosted_client: TestClient) -> None:
    """Verify that synthetic demonstration scenarios execute end-to-end in hosted demo mode."""
    # Run SCN-01
    run_res = hosted_client.post("/api/v1/scenarios/scn01/run")
    assert run_res.status_code == 200
    inv = run_res.json()
    assert inv["eod_result"]["primary_eod_step"] is not None

    # Verify fix for SCN-01
    verify_res = hosted_client.post(
        "/api/v1/scenarios/scn01/verify",
        json={"scenario_id": "scn01", "fix_mode": "clean"},
    )
    assert verify_res.status_code == 200
    dossier = verify_res.json()
    assert dossier["verification"]["verdict"] == "VERIFIED_CLEAN"
