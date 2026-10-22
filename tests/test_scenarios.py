"""Tests for the Four Canonical Demonstration Scenarios.

Conforms to Decision D-04 and SPEC-MOD-01/04.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from data_rewind.core.domain.errors import DataRewindError
from data_rewind.diagnostics.models import DiagnosticRuleID
from data_rewind.scenarios.runner import ScenarioRunner


@pytest.fixture
def scenario_workspace(tmp_path: Path) -> Path:
    ws = tmp_path / "scenario_ws"
    ws.mkdir()
    return ws


def test_available_scenarios_registry() -> None:
    scenarios = ScenarioRunner.get_available_scenarios()
    assert len(scenarios) == 4
    scenario_ids = {s.scenario_id for s in scenarios}
    assert scenario_ids == {"scn01", "scn02", "scn03", "scn04"}


def test_scenario_scn01_upstream_input_drift(scenario_workspace: Path) -> None:
    inv = ScenarioRunner.run_scenario("scn01", scenario_workspace)

    assert inv.eod_result.primary_eod_step == "ingest_orders"
    finding_rule_ids = [f.rule_id for f in inv.eod_result.findings]
    assert DiagnosticRuleID.DR_01_UPSTREAM_INPUT_DATA_DRIFT in finding_rule_ids
    assert inv.blast_radius.blast_radius_ratio == 1.0
    assert "aggregate_revenue" in inv.blast_radius.affected_terminal_sinks


def test_scenario_scn02_arithmetic_mutation(scenario_workspace: Path) -> None:
    inv = ScenarioRunner.run_scenario("scn02", scenario_workspace)

    assert inv.eod_result.primary_eod_step == "compute_fee"
    finding_rule_ids = [f.rule_id for f in inv.eod_result.findings]
    assert DiagnosticRuleID.DR_02_ARITHMETIC_EXPRESSION_MUTATION in finding_rule_ids
    assert "mart_revenue" in inv.blast_radius.affected_terminal_sinks


def test_scenario_scn03_unmatched_join_drop(scenario_workspace: Path) -> None:
    inv = ScenarioRunner.run_scenario("scn03", scenario_workspace)

    assert inv.eod_result.primary_eod_step == "join_orders_customers"
    finding_rule_ids = [f.rule_id for f in inv.eod_result.findings]
    assert DiagnosticRuleID.DR_03_UNMATCHED_JOIN_DROP in finding_rule_ids
    assert "join_orders_customers" in inv.blast_radius.affected_terminal_sinks


def test_scenario_scn04_null_sentinel_surge(scenario_workspace: Path) -> None:
    inv = ScenarioRunner.run_scenario("scn04", scenario_workspace)

    assert inv.eod_result.primary_eod_step == "clean_data"
    finding_rule_ids = [f.rule_id for f in inv.eod_result.findings]
    assert DiagnosticRuleID.DR_05_NULL_SENTINEL_SURGE in finding_rule_ids
    assert "clean_data" in inv.blast_radius.affected_terminal_sinks


def test_unknown_scenario_raises_error(scenario_workspace: Path) -> None:
    with pytest.raises(DataRewindError) as exc_info:
        ScenarioRunner.run_scenario("unknown_scn", scenario_workspace)
    assert exc_info.value.code == "UNKNOWN_SCENARIO"
