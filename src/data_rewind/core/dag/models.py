"""Data Rewind DAG data structures and validation types.

Conforms to Section 1 of SPEC-MOD-03.
"""

from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from data_rewind.core.domain.models import ValidationIssue


class NodeType(str, Enum):
    """DAG vertex categorization."""

    INPUT = "INPUT"
    STEP = "STEP"
    OUTPUT = "OUTPUT"


class DAGNode(BaseModel):
    """Vertex in the pipeline execution graph."""

    model_config = ConfigDict(frozen=True)

    node_id: str = Field(..., min_length=1)
    node_type: NodeType
    dependencies: list[str] = Field(default_factory=list)
    payload: Any = None


class DAGEdge(BaseModel):
    """Directed edge representing dataflow dependency (source -> target)."""

    model_config = ConfigDict(frozen=True)

    source_id: str
    target_id: str


class DAGValidationResult(BaseModel):
    """Result of DAG structural and topological validation."""

    model_config = ConfigDict(frozen=True)

    is_valid: bool
    topological_order: list[str] = Field(default_factory=list)
    cycle_path: list[str] | None = None
    issues: list[ValidationIssue] = Field(default_factory=list)
