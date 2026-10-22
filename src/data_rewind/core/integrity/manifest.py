"""Data Rewind replay manifest schema and validation.

Conforms strictly to Section 3.3 of SPEC-MOD-03.
"""

from __future__ import annotations

import json
import platform
import sys
from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

import duckdb
from pydantic import BaseModel, ConfigDict, Field, field_validator

from data_rewind.core.domain.errors import DomainValidationError
from data_rewind.core.domain.models import utc_now

HEX_DIGITS = frozenset("0123456789abcdefABCDEF")


def validate_sha256_hex(value: str, field_name: str = "hash") -> str:
    """Validate that a string is an exact 64-character hexadecimal SHA-256 digest."""
    if not isinstance(value, str):
        raise DomainValidationError(
            f"{field_name} must be a string, got {type(value).__name__}",
            code="INVALID_HASH_TYPE",
        )
    if len(value) != 64:
        raise DomainValidationError(
            f"{field_name} must be exactly 64 hexadecimal characters, got {len(value)}",
            code="INVALID_HASH_LENGTH",
        )
    if any(c not in HEX_DIGITS for c in value):
        raise DomainValidationError(
            f"{field_name} must contain only hexadecimal characters, got '{value}'",
            code="INVALID_HASH_CHARACTERS",
        )
    return value


class EngineMetadata(BaseModel):
    """Runtime engine environment metadata pinned in replay manifest."""

    model_config = ConfigDict(frozen=True)

    name: str = "DataRewind-Engine"
    version: str = "0.1.0"
    duckdb_version: str
    python_version: str
    os_platform: str


class ManifestInput(BaseModel):
    """Input dataset binding metadata pinned in replay manifest."""

    model_config = ConfigDict(frozen=True)

    input_id: str
    version_id: UUID
    content_hash: str
    multiset_hash: str
    row_count: int = Field(..., ge=0)
    byte_size: int = Field(..., ge=0)

    @field_validator("content_hash", "multiset_hash")
    @classmethod
    def validate_hashes(cls, value: str, info: Any) -> str:
        field_name = info.field_name if hasattr(info, "field_name") else "hash"
        return validate_sha256_hex(value, field_name=field_name)


class ManifestStepSnapshot(BaseModel):
    """Snapshot of a transformation step's configuration at execution time."""

    model_config = ConfigDict(frozen=True)

    step_id: str
    operation: str
    parameters: dict[str, Any] = Field(default_factory=dict)


class ReplayManifest(BaseModel):
    """Complete, self-contained manifest bundle required for historical replay."""

    model_config = ConfigDict(frozen=True)

    manifest_version: str = "1.0"
    manifest_id: UUID = Field(default_factory=uuid4)
    run_id: UUID
    pipeline_version_id: UUID
    pipeline_definition_hash: str
    created_at: datetime = Field(default_factory=utc_now)
    engine: EngineMetadata
    inputs: list[ManifestInput]
    steps_snapshot: list[ManifestStepSnapshot]

    @field_validator("pipeline_definition_hash")
    @classmethod
    def validate_pipeline_hash(cls, value: str) -> str:
        return validate_sha256_hex(value, field_name="pipeline_definition_hash")

    @classmethod
    def create(
        cls,
        run_id: UUID,
        pipeline_version_id: UUID,
        pipeline_definition_hash: str,
        inputs: list[ManifestInput],
        steps_snapshot: list[ManifestStepSnapshot],
    ) -> ReplayManifest:
        """Create a new ReplayManifest with current engine metadata."""
        engine = EngineMetadata(
            name="DataRewind-Engine",
            version="0.1.0",
            duckdb_version=duckdb.__version__,
            python_version=sys.version.split()[0],
            os_platform=f"{platform.system()}-{platform.release()}",
        )
        # Validate definition hash
        validate_sha256_hex(pipeline_definition_hash, field_name="pipeline_definition_hash")

        return cls(
            run_id=run_id,
            pipeline_version_id=pipeline_version_id,
            pipeline_definition_hash=pipeline_definition_hash,
            engine=engine,
            inputs=inputs,
            steps_snapshot=steps_snapshot,
        )

    def to_canonical_json(self) -> str:
        """Serialize manifest to deterministic canonical JSON."""
        return json.dumps(
            self.model_dump(mode="json"),
            sort_keys=True,
            indent=2,
        )

    @classmethod
    def from_json(cls, json_str: str) -> ReplayManifest:
        """Parse and validate manifest from JSON string."""
        try:
            data = json.loads(json_str)
            return cls.model_validate(data)
        except Exception as exc:
            raise DomainValidationError(
                f"Failed to parse or validate ReplayManifest: {exc}",
                code="MALFORMED_MANIFEST",
            ) from exc
