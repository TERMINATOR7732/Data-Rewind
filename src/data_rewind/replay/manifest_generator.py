"""Data Rewind Replay Manifest generator.

Conforms strictly to Section 3.3 of SPEC-MOD-03.
"""

from __future__ import annotations

from collections.abc import Sequence
from uuid import UUID

from data_rewind.core.domain.models import TransformationStep
from data_rewind.core.integrity.hashing import compute_pipeline_definition_hash
from data_rewind.core.integrity.manifest import (
    ManifestInput,
    ManifestStepSnapshot,
    ReplayManifest,
)


def generate_replay_manifest(
    run_id: UUID,
    pipeline_version_id: UUID,
    pipeline_definition_hash: str | None = None,
    inputs: Sequence[ManifestInput] = (),
    steps: Sequence[TransformationStep] = (),
    step_output_hashes: dict[str, str] | None = None,
) -> ReplayManifest:
    """Generate canonical replay manifest for an executed run."""
    hashes = step_output_hashes or {}
    step_snapshots = [
        ManifestStepSnapshot(
            step_id=s.step_id,
            operation=(
                s.operation_type.value
                if hasattr(s.operation_type, "value")
                else str(s.operation_type)
            ),
            parameters=dict(s.parameters),
            input_step_ids=list(s.input_step_ids),
            output_multiset_hash=hashes.get(s.step_id),
        )
        for s in steps
    ]

    effective_definition_hash = pipeline_definition_hash
    if not effective_definition_hash or effective_definition_hash == "0" * 64:
        effective_definition_hash = compute_pipeline_definition_hash(steps)

    return ReplayManifest.create(
        run_id=run_id,
        pipeline_version_id=pipeline_version_id,
        pipeline_definition_hash=effective_definition_hash,
        inputs=list(inputs),
        steps_snapshot=step_snapshots,
    )
