"""Comprehensive Integration Tests for Data Rewind REST API.

Tests all endpoints under /api/v1 conforming to SPEC-MOD-07 §3 and SPEC-MOD-08.
"""

from __future__ import annotations

import io
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from data_rewind.api.dependencies import APIDependencies
from data_rewind.api.main import create_app
from data_rewind.core.config.settings import Settings


@pytest.fixture
def client(tmp_path: Path) -> TestClient:
    """Create a TestClient with an isolated temporary workspace directory."""
    test_settings = Settings(
        profile="local",
        base_data_dir=tmp_path / "data_rewind_test",
    )
    APIDependencies.set_settings(test_settings)
    app = create_app()
    return TestClient(app)


def test_health_and_diagnostics(client: TestClient) -> None:
    """Verify health and system diagnostic endpoints."""
    res = client.get("/api/v1/health")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ok"
    assert data["app_name"] == "Data Rewind"
    assert "version" in data
    assert "limits" in data
    assert data["limits"]["max_raw_csv_bytes"] == 50_000_000
    assert data["free_disk_mb"] > 0
    assert data["rss_mib"] > 0

    diag_res = client.get("/api/v1/diagnostics")
    assert diag_res.status_code == 200
    diag_data = diag_res.json()
    assert diag_data["disk_admission_gate"] is True
    assert "engine_version" in diag_data
    assert "duckdb_version" in diag_data


def test_list_and_get_scenarios(client: TestClient) -> None:
    """Verify demonstration scenario discovery endpoints."""
    res = client.get("/api/v1/scenarios")
    assert res.status_code == 200
    scenarios = res.json()
    assert len(scenarios) >= 4
    ids = [s["scenario_id"] for s in scenarios]
    assert "scn01" in ids
    assert "scn02" in ids
    assert "scn03" in ids
    assert "scn04" in ids

    # Detail lookup
    detail_res = client.get("/api/v1/scenarios/scn01")
    assert detail_res.status_code == 200
    detail = detail_res.json()
    assert detail["scenario_id"] == "scn01"
    assert detail["expected_eod_step"] == "ingest_orders"
    assert len(detail["steps"]) > 0

    # Non-existent scenario
    missing = client.get("/api/v1/scenarios/unknown_999")
    assert missing.status_code == 404


def test_run_scenario_investigation(client: TestClient) -> None:
    """Verify running a demonstration scenario returns a full forensic investigation."""
    res = client.post("/api/v1/scenarios/scn01/run")
    assert res.status_code == 200
    inv = res.json()
    assert "investigation_id" in inv
    assert "eod_result" in inv
    assert inv["eod_result"]["primary_eod_step"] == "ingest_orders"
    assert "blast_radius" in inv
    assert "step_comparisons" in inv
    assert len(inv["step_comparisons"]) > 0

    # Verify persisted in repository
    comp_list = client.get("/api/v1/comparisons")
    assert comp_list.status_code == 200
    summaries = comp_list.json()
    assert len(summaries) >= 1
    assert any(s["investigation_id"] == inv["investigation_id"] for s in summaries)

    # Fetch investigation by UUID
    fetch_res = client.get(f"/api/v1/comparisons/{inv['investigation_id']}")
    assert fetch_res.status_code == 200
    assert fetch_res.json()["investigation_id"] == inv["investigation_id"]

    # Step diff rows
    diff_res = client.get(f"/api/v1/comparisons/{inv['investigation_id']}/steps/ingest_orders/diff")
    assert diff_res.status_code == 200
    diff_page = diff_res.json()
    assert diff_page["step_id"] == "ingest_orders"
    assert diff_page["total_matching_rows"] > 0
    assert len(diff_page["rows"]) > 0


def test_verify_scenario_fix(client: TestClient) -> None:
    """Verify tri-run fix verification for scenario SCN-01 under clean and collateral modes."""
    # 1. Clean fix mode
    clean_res = client.post(
        "/api/v1/scenarios/scn01/verify",
        json={"scenario_id": "scn01", "fix_mode": "clean"},
    )
    assert clean_res.status_code == 200
    clean_dossier = clean_res.json()
    assert clean_dossier["verification"]["verdict"] == "VERIFIED_CLEAN"
    assert clean_dossier["metadata"]["pipeline_name"] == "Scenario SCN01"
    dossier_id = clean_dossier["metadata"]["dossier_id"]

    # 2. Unresolved or collateral fix mode
    unresolved_res = client.post(
        "/api/v1/scenarios/scn01/verify",
        json={"scenario_id": "scn01", "fix_mode": "unresolved"},
    )
    assert unresolved_res.status_code == 200
    unresolved_dossier = unresolved_res.json()
    assert unresolved_dossier["verification"]["verdict"] in (
        "REGRESSION_UNRESOLVED",
        "INCONCLUSIVE_VERIFICATION",
    )

    # Verify dossier retrieval
    d_fetch = client.get(f"/api/v1/verifications/dossiers/{dossier_id}")
    assert d_fetch.status_code == 200

    # Verify report exports
    for fmt in ("json", "markdown", "safe_csv", "raw_csv"):
        export_res = client.get(f"/api/v1/reports/{dossier_id}/export?format={fmt}")
        assert export_res.status_code == 200
        assert len(export_res.content) > 0


def test_dataset_upload_and_preview(client: TestClient) -> None:
    """Verify CSV dataset upload, schema inspection, and preview."""
    csv_content = b"id,name,amount,category\n101,Alpha,19.99,Hardware\n102,Beta,45.50,Software\n"
    res = client.post(
        "/api/v1/datasets/upload",
        files={"file": ("test_data.csv", io.BytesIO(csv_content), "text/csv")},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["filename"] == "test_data.csv"
    assert data["row_count"] == 2
    assert data["column_count"] == 4
    assert len(data["columns"]) == 4

    # List datasets
    list_res = client.get("/api/v1/datasets")
    assert list_res.status_code == 200
    assert len(list_res.json()) >= 1

    # Preview dataset
    preview_res = client.get(f"/api/v1/datasets/{data['dataset_id']}/preview")
    assert preview_res.status_code == 200
    preview = preview_res.json()
    assert len(preview["sample_rows"]) == 2
    assert preview["sample_rows"][0]["id"] == 101


def test_dataset_upload_guardrails(client: TestClient) -> None:
    """Verify ingestion guards: invalid extension, empty file, oversized cells, too many columns."""
    # 1. Non-CSV
    res_txt = client.post(
        "/api/v1/datasets/upload",
        files={"file": ("test.txt", io.BytesIO(b"hello"), "text/plain")},
    )
    assert res_txt.status_code == 400

    # 2. Empty file
    res_empty = client.post(
        "/api/v1/datasets/upload",
        files={"file": ("empty.csv", io.BytesIO(b""), "text/csv")},
    )
    assert res_empty.status_code == 400

    # 3. Cell exceeding 4096 chars
    oversized_cell = "A" * 4100
    bad_csv = f"col1,col2\n1,{oversized_cell}\n".encode()
    res_cell = client.post(
        "/api/v1/datasets/upload",
        files={"file": ("bad_cell.csv", io.BytesIO(bad_csv), "text/csv")},
    )
    assert res_cell.status_code == 400
    assert "CELL_LENGTH_LIMIT_EXCEEDED" in res_cell.text

    # 4. Too many columns
    cols = [f"c{i}" for i in range(105)]
    wide_csv = (",".join(cols) + "\n" + ",".join(["1"] * 105) + "\n").encode()
    res_wide = client.post(
        "/api/v1/datasets/upload",
        files={"file": ("wide.csv", io.BytesIO(wide_csv), "text/csv")},
    )
    assert res_wide.status_code == 400
    assert "COLUMN_COUNT_LIMIT_EXCEEDED" in res_wide.text


def test_pipeline_validation_and_execution(client: TestClient) -> None:
    """Verify pipeline validation and execution endpoints."""
    # Valid pipeline
    valid_payload = {
        "steps": [
            {
                "step_id": "filter_step",
                "operation_type": "filter_rows",
                "input_step_ids": ["raw_table"],
                "parameters": {"predicate": "val > 10"},
            }
        ],
        "inputs": ["raw_table"],
    }
    v_res = client.post("/api/v1/pipelines/validate", json=valid_payload)
    assert v_res.status_code == 200
    assert v_res.json()["valid"] is True
    assert v_res.json()["topological_order"] == ["filter_step"]

    # Invalid AST security violation
    malicious_payload = {
        "steps": [
            {
                "step_id": "bad_step",
                "operation_type": "filter_rows",
                "input_step_ids": ["raw_table"],
                "parameters": {"predicate": "__import__('os').system('whoami')"},
            }
        ],
        "inputs": ["raw_table"],
    }
    m_res = client.post("/api/v1/pipelines/validate", json=malicious_payload)
    assert m_res.status_code == 200
    assert m_res.json()["valid"] is False
    assert "security violation" in m_res.json()["error_message"]

    # Execute pipeline
    exec_payload = {
        "steps": [
            {
                "step_id": "filter_step",
                "operation_type": "filter_rows",
                "input_step_ids": ["input_data"],
                "parameters": {"predicate": "x > 5"},
            }
        ],
        "inputs": {
            "input_data": [{"x": 1}, {"x": 10}, {"x": 20}],
        },
    }
    exec_res = client.post("/api/v1/pipelines/execute", json=exec_payload)
    assert exec_res.status_code == 200
    exec_data = exec_res.json()
    assert exec_data["status"] == "COMPLETED"
    assert exec_data["step_results"]["filter_step"]["row_count"] == 2


def test_workspace_storage_and_purge(client: TestClient) -> None:
    """Verify workspace storage telemetry and application-managed purge."""
    # Create test files in raw_inputs and artifacts
    raw_dir = APIDependencies.get_raw_inputs_dir()
    test_raw = raw_dir / "dummy_raw.csv"
    test_raw.write_text("a,b\n1,2\n")

    ws_dir = APIDependencies.get_workspace_dir()
    art_dir = ws_dir / "artifacts"
    art_dir.mkdir(parents=True, exist_ok=True)
    test_art = art_dir / "dummy.parquet"
    test_art.write_bytes(b"PAR1dummydata")

    ws_res = client.get("/api/v1/workspaces")
    assert ws_res.status_code == 200
    data = ws_res.json()
    assert "total_storage_bytes" in data
    assert data["file_count"] >= 2

    # Purge
    purge_res = client.delete("/api/v1/workspaces/purge")
    assert purge_res.status_code == 200
    p_data = purge_res.json()
    assert p_data["vacuum_completed"] is True
    assert p_data["purged_bytes"] > 0
    assert p_data["unlinked_files_count"] >= 2


def test_verification_listing_and_not_found(client: TestClient) -> None:
    """Verify listing verifications and error handling on unknown UUIDs."""
    # List verifications
    v_res = client.get("/api/v1/verifications")
    assert v_res.status_code == 200

    # Bad UUID
    bad_res = client.get("/api/v1/verifications/not-a-uuid")
    assert bad_res.status_code == 400

    # Non-existent UUID
    missing_res = client.get("/api/v1/verifications/00000000-0000-0000-0000-000000000000")
    assert missing_res.status_code == 404

    # Bad UUID in dossier
    bad_dossier = client.get("/api/v1/verifications/dossiers/not-a-uuid")
    assert bad_dossier.status_code == 400

    # Report export bad UUID and unsupported format
    bad_export_uuid = client.get("/api/v1/reports/not-a-uuid/export")
    assert bad_export_uuid.status_code == 400

    # Bad comparison UUID
    bad_comp = client.get("/api/v1/comparisons/not-a-uuid")
    assert bad_comp.status_code == 400
    bad_diff = client.get("/api/v1/comparisons/not-a-uuid/steps/step1/diff")
    assert bad_diff.status_code == 400
