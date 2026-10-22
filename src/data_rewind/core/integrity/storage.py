"""Data Rewind artifact storage manager, path jail, and atomic publication.

Conforms strictly to Section 4 of SPEC-MOD-06 and Section 3.2 of SPEC-MOD-02.
Guarantees:
- Path jail: strict is_relative_to containment check prevents directory traversal.
- ACID durability: write to private .tmp file, flush, fsync, compute hash, atomic os.replace.
- Automatic cleanup of orphan temporary files on failure.
"""

from __future__ import annotations

import contextlib
import os
from pathlib import Path
from uuid import uuid4

from data_rewind.core.domain.errors import (
    ArtifactNotFoundError,
    PathTraversalError,
)
from data_rewind.core.integrity.hashing import (
    compute_content_hash,
    verify_content_integrity,
)


def validate_safe_path(target_path: Path, workspace_root: Path) -> Path:
    """Ensure target path is strictly contained within workspace_root directory.

    Raises:
        PathTraversalError: If the target path escapes workspace_root.
    """
    resolved_target = target_path.resolve(strict=False)
    # Ensure workspace root exists or resolve it safely
    workspace_root.mkdir(parents=True, exist_ok=True)
    resolved_root = workspace_root.resolve(strict=True)

    try:
        is_safe = resolved_target.is_relative_to(resolved_root)
    except AttributeError:
        # Fallback for Python versions lacking is_relative_to
        try:
            resolved_target.relative_to(resolved_root)
            is_safe = True
        except ValueError:
            is_safe = False

    if not is_safe:
        raise PathTraversalError(
            f"Path traversal attempt blocked: {target_path} escapes workspace {workspace_root}",
            details={"target": str(target_path), "root": str(workspace_root)},
        )

    return resolved_target


class ArtifactStorageVault:
    """Manages content-addressed artifact files with atomic publication and path jailing."""

    def __init__(self, workspace_root: Path) -> None:
        self.workspace_root = workspace_root.resolve()
        self.artifacts_dir = self.workspace_root / "artifacts"
        self.tmp_dir = self.workspace_root / "tmp"
        self.raw_inputs_dir = self.workspace_root / "raw_inputs"

        # Ensure directory structure exists
        self.artifacts_dir.mkdir(parents=True, exist_ok=True)
        self.tmp_dir.mkdir(parents=True, exist_ok=True)
        self.raw_inputs_dir.mkdir(parents=True, exist_ok=True)

    def publish_bytes_atomic(
        self,
        data: bytes,
        prefix: str = "artifact",
        extension: str = ".parquet",
    ) -> tuple[Path, str]:
        """Atomically write data to vault and return (vault_path, sha256_hash).

        Sequence:
        1. Write to temporary file in tmp/.
        2. Flush & fsync to ensure disk durability.
        3. Compute SHA-256 hash.
        4. Atomic os.replace to artifacts/{sha256}{extension}.
        """
        temp_filename = f"{uuid4().hex}_{prefix}.tmp"
        temp_path = self.tmp_dir / temp_filename
        validate_safe_path(temp_path, self.workspace_root)

        try:
            with open(temp_path, "wb") as f:
                f.write(data)
                f.flush()
                os.fsync(f.fileno())

            content_hash = compute_content_hash(temp_path)
            target_filename = f"{content_hash}{extension}"
            target_path = self.artifacts_dir / target_filename
            validate_safe_path(target_path, self.workspace_root)

            # Atomic publish via replace
            os.replace(temp_path, target_path)
            return target_path, content_hash

        finally:
            if temp_path.exists():
                with contextlib.suppress(OSError):
                    temp_path.unlink()

    def read_artifact_verified(self, target_path: Path, expected_hash: str) -> bytes:
        """Read artifact file and verify its SHA-256 checksum before returning bytes."""
        safe_path = validate_safe_path(target_path, self.workspace_root)

        if not safe_path.is_file():
            raise ArtifactNotFoundError(
                f"Artifact file not found on disk: {safe_path.name}",
                details={"path": str(safe_path)},
            )

        verify_content_integrity(safe_path, expected_hash)
        return safe_path.read_bytes()
