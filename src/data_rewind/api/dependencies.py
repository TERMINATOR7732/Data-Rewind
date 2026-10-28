"""Data Rewind API dependency injection and repository providers.

Conforms to SPEC-MOD-07 §1.1 (Local Storage Hierarchy).
"""

from __future__ import annotations

from pathlib import Path

from data_rewind.core.config.settings import Settings
from data_rewind.investigation.persistence import InvestigationRepository
from data_rewind.verification.persistence import VerificationRepository


class APIDependencies:
    """Manages application-scoped services and repositories."""

    _settings: Settings | None = None
    _investigation_repo: InvestigationRepository | None = None
    _verification_repo: VerificationRepository | None = None

    @classmethod
    def get_settings(cls) -> Settings:
        """Retrieve global application settings."""
        if cls._settings is None:
            cls._settings = Settings.load()
        return cls._settings

    @classmethod
    def set_settings(cls, settings: Settings) -> None:
        """Override settings (useful for test isolation)."""
        cls._settings = settings
        cls._investigation_repo = None
        cls._verification_repo = None

    @classmethod
    def get_workspace_dir(cls) -> Path:
        """Return base workspace directory, ensuring parent exists."""
        settings = cls.get_settings()
        ws_dir = settings.base_data_dir
        ws_dir.mkdir(parents=True, exist_ok=True)
        return ws_dir

    @classmethod
    def get_raw_inputs_dir(cls) -> Path:
        """Return directory for preserved raw CSV uploads."""
        ws = cls.get_workspace_dir()
        raw_dir = ws / "raw_inputs"
        raw_dir.mkdir(parents=True, exist_ok=True)
        return raw_dir

    @classmethod
    def get_investigation_repository(cls) -> InvestigationRepository:
        """Return investigation persistence repository."""
        if cls._investigation_repo is None:
            db_path = cls.get_workspace_dir() / "investigations.db"
            cls._investigation_repo = InvestigationRepository(db_path)
        return cls._investigation_repo

    @classmethod
    def get_verification_repository(cls) -> VerificationRepository:
        """Return verification persistence repository."""
        if cls._verification_repo is None:
            db_path = cls.get_workspace_dir() / "verifications.db"
            cls._verification_repo = VerificationRepository(db_path)
        return cls._verification_repo
