"""Data Rewind diagnostic models, evidence tiers, and EOD result contracts.

Conforms strictly to Section 2 of SPEC-MOD-04.
"""

from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from data_rewind.comparator.models import TabularDiffResult


class StepDiagnosticContext(BaseModel):
    """Contextual metadata and comparison outputs for a single pipeline step."""

    model_config = ConfigDict(frozen=True)

    step_id: str
    operation: str
    is_ingestion_node: bool = False
    input_dataset_name: str | None = None
    baseline_input_hashes: list[str] = Field(default_factory=list)
    target_input_hashes: list[str] = Field(default_factory=list)
    baseline_parameters: dict[str, Any] = Field(default_factory=dict)
    target_parameters: dict[str, Any] = Field(default_factory=dict)
    baseline_output_hash: str | None = None
    target_output_hash: str | None = None
    diff_result: TabularDiffResult | None = None
    left_input_rows: int = 0
    right_input_rows: int = 0


class EvidenceTier(str, Enum):
    """Evidence classification tiers separating observed facts from causal hypotheses."""

    PROVEN_OBSERVATION = "PROVEN_OBSERVATION"
    CAUSAL_HYPOTHESIS_DIRECT_CODE_DIFF = "CAUSAL_HYPOTHESIS_DIRECT_CODE_DIFF"
    CAUSAL_HYPOTHESIS_INPUT_DRIFT = "CAUSAL_HYPOTHESIS_INPUT_DRIFT"
    CORRELATION_INFERENCE = "CORRELATION_INFERENCE"
    INDETERMINATE = "INDETERMINATE"


class EODStatus(str, Enum):
    """Categorical status of Earliest Observable Divergence detection."""

    EXACT_EOD = "EXACT_EOD"
    COARSE_GRAINED_EOD = "COARSE_GRAINED_EOD"
    CONCURRENT_DIVERGENCE_POINTS = "CONCURRENT_DIVERGENCE_POINTS"
    UPSTREAM_INPUT_DATA_DRIFT = "UPSTREAM_INPUT_DATA_DRIFT"
    NONDETERMINISTIC_TRANSFORMATION = "NONDETERMINISTIC_TRANSFORMATION"
    NO_DIVERGENCE = "NO_DIVERGENCE"


class DiagnosticRuleID(str, Enum):
    """Standardized identifiers for the six automated forensic diagnostic rules."""

    DR_01_UPSTREAM_INPUT_DATA_DRIFT = "DR_01_UPSTREAM_INPUT_DATA_DRIFT"
    DR_02_ARITHMETIC_EXPRESSION_MUTATION = "DR_02_ARITHMETIC_EXPRESSION_MUTATION"
    DR_03_UNMATCHED_JOIN_DROP = "DR_03_UNMATCHED_JOIN_DROP"
    DR_04_DUPLICATION_CARDINALITY_BURST = "DR_04_DUPLICATION_CARDINALITY_BURST"
    DR_05_NULL_SENTINEL_SURGE = "DR_05_NULL_SENTINEL_SURGE"
    DR_06_NONDETERMINISTIC_TRANSFORMATION = "DR_06_NONDETERMINISTIC_TRANSFORMATION"


class DiagnosticFinding(BaseModel):
    """Evidence-backed forensic diagnostic finding emitted by a rule."""

    model_config = ConfigDict(frozen=True)

    rule_id: DiagnosticRuleID
    rule_name: str
    step_id: str
    evidence_tier: EvidenceTier
    message: str
    details: dict[str, Any] = Field(default_factory=dict)
    affected_columns: list[str] = Field(default_factory=list)
    confidence_explanation: str


class EODResult(BaseModel):
    """Complete Earliest Observable Divergence assessment bundle."""

    model_config = ConfigDict(frozen=True)

    status: EODStatus
    divergent_step_ids: list[str] = Field(default_factory=list)
    primary_eod_step: str | None = None
    is_coarse_grained: bool = False
    findings: list[DiagnosticFinding] = Field(default_factory=list)
    evidence_tier: EvidenceTier
    summary: str
