"""Tests for Data Rewind domain entities, value objects, and schemas."""

from __future__ import annotations

from pathlib import Path
from uuid import uuid4

import pytest

from data_rewind.core.domain.errors import (
    DataRewindError,
    DomainValidationError,
)
from data_rewind.core.domain.models import (
    Artifact,
    ColumnDefinition,
    ContentHash,
    Dataset,
    DatasetSchema,
    DatasetVersion,
    DataType,
    OperationType,
    PipelineInputBinding,
    PipelineOutputBinding,
    PipelineRun,
    PipelineVersion,
    RunLifecycle,
    RunType,
    StepExecution,
    StepStatus,
    TransformationStep,
    ValidationIssue,
    ValidationSeverity,
)


def test_content_hash_validation() -> None:
    """Test valid and invalid SHA-256 ContentHash values."""
    valid_hex = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    h = ContentHash(hex_digest=valid_hex)
    assert str(h) == valid_hex
    assert h.hex_digest == valid_hex

    # Test uppercase normalized to lowercase
    h_upper = ContentHash(hex_digest=valid_hex.upper())
    assert h_upper.hex_digest == valid_hex

    # Test invalid length
    with pytest.raises(DomainValidationError, match="must be exactly 64 characters"):
        ContentHash(hex_digest="abc123short")

    # Test non-hex characters
    with pytest.raises(DomainValidationError, match="Invalid hex character"):
        ContentHash(hex_digest="z" * 64)


def test_column_definition_validation() -> None:
    """Test ColumnDefinition validation and sanitization."""
    col = ColumnDefinition(name=" user_id ", data_type=DataType.INTEGER, ordinal_position=0)
    assert col.name == "user_id"
    assert col.data_type == DataType.INTEGER
    assert col.is_nullable is True

    # Empty name
    with pytest.raises(DomainValidationError, match="cannot be blank"):
        ColumnDefinition(name="   ", data_type=DataType.STRING, ordinal_position=0)

    # Null byte in name
    with pytest.raises(DomainValidationError, match="cannot contain null bytes"):
        ColumnDefinition(name="col\x00name", data_type=DataType.STRING, ordinal_position=0)


def test_dataset_schema_validation() -> None:
    """Test DatasetSchema column uniqueness and invariants."""
    c1 = ColumnDefinition(name="id", data_type=DataType.INTEGER, ordinal_position=0)
    c2 = ColumnDefinition(name="name", data_type=DataType.STRING, ordinal_position=1)

    schema = DatasetSchema(
        column_count=2,
        fingerprint_sha256="0" * 64,
        columns=[c1, c2],
    )
    assert schema.column_count == 2
    assert len(schema.columns) == 2

    # Duplicate column rejection (case-insensitive)
    c_dup = ColumnDefinition(name="ID", data_type=DataType.INTEGER, ordinal_position=2)
    with pytest.raises(DomainValidationError, match="Duplicate column name"):
        DatasetSchema(
            column_count=2,
            fingerprint_sha256="0" * 64,
            columns=[c1, c_dup],
        )

    # Empty schema
    with pytest.raises(DomainValidationError, match="at least one column"):
        DatasetSchema(
            column_count=0,
            fingerprint_sha256="0" * 64,
            columns=[],
        )


def test_domain_entity_instantiations() -> None:
    """Test creation and immutability of key domain entities."""
    ws_id = uuid4()
    ds_id = uuid4()
    v_id = uuid4()

    dataset = Dataset(workspace_id=ws_id, name="raw_orders", dataset_id=ds_id)
    assert dataset.name == "raw_orders"

    version = DatasetVersion(
        version_id=v_id,
        dataset_id=ds_id,
        version_number=1,
        storage_path=Path("/tmp/orders.parquet"),
        content_hash="a" * 64,
        multiset_hash="b" * 64,
        row_count=1000,
        byte_size=50000,
        schema_id=uuid4(),
        primary_key_columns=["order_id"],
    )
    assert version.row_count == 1000
    assert version.primary_key_columns == ["order_id"]

    # TransformationStep validation
    step = TransformationStep(
        step_id="step_filter",
        operation_type=OperationType.FILTER_ROWS,
        input_step_ids=["raw_orders"],
        parameters={"predicate": "amount > 0"},
    )
    assert step.step_id == "step_filter"

    with pytest.raises(DomainValidationError, match="step_id cannot be blank"):
        TransformationStep(
            step_id="   ",
            operation_type=OperationType.FILTER_ROWS,
        )

    # PipelineVersion
    pv = PipelineVersion(
        pipeline_id=uuid4(),
        version_number=1,
        definition_hash="c" * 64,
        steps=[step],
        inputs=[PipelineInputBinding(input_id="raw_orders", dataset_id=ds_id)],
        outputs=[
            PipelineOutputBinding(
                output_id="out", step_id="step_filter", target_name="clean_orders"
            )
        ],
    )
    assert len(pv.steps) == 1
    assert len(pv.inputs) == 1

    # PipelineRun
    run = PipelineRun(
        pipeline_version_id=pv.pipeline_version_id,
        run_type=RunType.BASELINE,
    )
    assert run.lifecycle_status == RunLifecycle.PENDING
    assert run.started_at is None

    # StepExecution & Artifact
    art = Artifact(
        storage_path=Path("/tmp/art.parquet"),
        row_count=100,
        byte_size=2048,
        schema_id=uuid4(),
        content_hash="d" * 64,
        multiset_hash="e" * 64,
        is_verified=True,
    )
    assert art.is_verified is True

    step_exec = StepExecution(
        run_id=run.run_id,
        step_id="step_filter",
        status=StepStatus.SUCCESS,
        started_at=run.created_at if hasattr(run, "created_at") else None or pv.created_at,
        output_artifact_id=art.artifact_id,
    )
    assert step_exec.status == StepStatus.SUCCESS


def test_structured_error_diagnostics() -> None:
    """Test structured error code and dictionary representation."""
    err = DataRewindError(
        message="Test error occurred",
        code="CUSTOM_TEST_CODE",
        details={"key": "val", "count": 42},
    )
    assert err.code == "CUSTOM_TEST_CODE"
    assert err.message == "Test error occurred"

    diag = err.to_dict()
    assert diag["error_code"] == "CUSTOM_TEST_CODE"
    assert diag["message"] == "Test error occurred"
    assert diag["details"]["count"] == 42


def test_validation_issue_representation() -> None:
    """Test ValidationIssue model."""
    issue = ValidationIssue(
        severity=ValidationSeverity.ERROR,
        code="TEST_ISSUE",
        message="A validation issue occurred",
        location="step_2.predicate",
    )
    assert issue.severity == ValidationSeverity.ERROR
    assert issue.location == "step_2.predicate"
