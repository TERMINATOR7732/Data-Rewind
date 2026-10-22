"""Data Rewind Lineage and Downstream Taint Tracking models.

Conforms strictly to Section 2 of SPEC-MOD-03 and Section 2.1 of SPEC-MOD-04.
"""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, ConfigDict, Field


class TaintStatus(str, Enum):
    """Categorical downstream taint status conforming to SPEC-MOD-03 §2.1."""

    UNTAINTED = "UNTAINTED"
    """Clean node outside the dataflow blast radius."""

    POTENTIALLY_AFFECTED = "POTENTIALLY_AFFECTED"
    """Topologically descendant of a divergence node (unconfirmed value change)."""

    CONFIRMED_AFFECTED = "CONFIRMED_AFFECTED"
    """Tainted descendant whose output artifact or multiset hash diverged from baseline."""

    MASKED_UNAFFECTED = "MASKED_UNAFFECTED"
    """Topologically connected descendant whose output values remain identical to baseline."""


class LineageNode(BaseModel):
    """Individual node metadata in the lineage graph."""

    model_config = ConfigDict(frozen=True)

    step_id: str
    operation: str
    taint_status: TaintStatus
    is_origin: bool = False
    is_divergent: bool = False
    input_step_ids: list[str] = Field(default_factory=list)
    output_step_ids: list[str] = Field(default_factory=list)
    baseline_output_hash: str | None = None
    target_output_hash: str | None = None
    explanation: str | None = None


class BlastRadiusReport(BaseModel):
    """Forensic report detailing downstream blast radius and taint propagation."""

    model_config = ConfigDict(frozen=True)

    origin_divergent_step_ids: list[str]
    total_nodes_count: int
    tainted_nodes_count: int
    confirmed_affected_count: int
    masked_count: int
    untainted_count: int
    blast_radius_ratio: float = Field(..., ge=0.0, le=1.0)
    confirmed_divergence_ratio: float = Field(..., ge=0.0, le=1.0)
    tainted_step_ids: list[str]
    confirmed_affected_step_ids: list[str]
    masked_step_ids: list[str]
    untainted_step_ids: list[str]
    affected_terminal_sinks: list[str]
    nodes: dict[str, LineageNode]
    upstream_paths: dict[str, list[list[str]]] = Field(default_factory=dict)
