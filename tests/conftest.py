"""Data Rewind shared pytest fixtures and test data generation.

Provides:
- In-memory DuckDB runtime fixture.
- Temporary isolated artifact storage vault fixture.
- Synthetic dataset and schema fixtures.
- Valid and invalid DAG step fixtures.
"""

from __future__ import annotations

import tempfile
from collections.abc import Generator
from pathlib import Path
from uuid import uuid4

import pytest

from data_rewind.core.db.duckdb_runtime import DuckDBConfig, DuckDBRuntime
from data_rewind.core.domain.models import (
    ColumnDefinition,
    DatasetSchema,
    DataType,
    OperationType,
    TransformationStep,
)
from data_rewind.core.integrity.storage import ArtifactStorageVault


@pytest.fixture
def temp_workspace() -> Generator[Path, None, None]:
    """Provide an isolated temporary workspace directory."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        ws = Path(tmp_dir) / "test_workspace"
        ws.mkdir(parents=True, exist_ok=True)
        yield ws


@pytest.fixture
def storage_vault(temp_workspace: Path) -> ArtifactStorageVault:
    """Provide an ArtifactStorageVault initialized in temporary workspace."""
    return ArtifactStorageVault(temp_workspace)


@pytest.fixture
def in_memory_duckdb() -> Generator[DuckDBRuntime, None, None]:
    """Provide an initialized in-memory DuckDB runtime."""
    config = DuckDBConfig(database_path=":memory:", max_memory_mb=128, threads=2)
    with DuckDBRuntime(config) as runtime:
        yield runtime


@pytest.fixture
def sample_schema() -> DatasetSchema:
    """Provide a validated 3-column DatasetSchema."""
    cols = [
        ColumnDefinition(name="id", data_type=DataType.INTEGER, ordinal_position=0),
        ColumnDefinition(name="revenue", data_type=DataType.FLOAT, ordinal_position=1),
        ColumnDefinition(name="customer", data_type=DataType.STRING, ordinal_position=2),
    ]
    return DatasetSchema(
        schema_id=uuid4(),
        column_count=3,
        fingerprint_sha256="abc123schemafingerprint00000000000000000000000000000000000000000000",
        columns=cols,
    )


@pytest.fixture
def diamond_dag_steps() -> list[TransformationStep]:
    r"""Provide a diamond DAG:

         step_source (input: raw)
            /        \
      step_left     step_right
            \        /
            step_join
    """
    return [
        TransformationStep(
            step_id="step_source",
            operation_type=OperationType.FILTER_ROWS,
            input_step_ids=["raw_input"],
            parameters={"predicate": "id > 0"},
        ),
        TransformationStep(
            step_id="step_left",
            operation_type=OperationType.DERIVE_COLUMN,
            input_step_ids=["step_source"],
            parameters={"expression": "revenue * 1.1"},
        ),
        TransformationStep(
            step_id="step_right",
            operation_type=OperationType.DERIVE_COLUMN,
            input_step_ids=["step_source"],
            parameters={"expression": "revenue * 0.9"},
        ),
        TransformationStep(
            step_id="step_join",
            operation_type=OperationType.JOIN_DATASETS,
            input_step_ids=["step_left", "step_right"],
            parameters={"on": "id"},
        ),
    ]
