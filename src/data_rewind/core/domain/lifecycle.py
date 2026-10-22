"""Data Rewind lifecycle finite state machine and transition validation.

Conforms strictly to Section 3.1 of SPEC-MOD-02.
"""

from __future__ import annotations

from datetime import datetime

from data_rewind.core.domain.errors import InvalidLifecycleTransitionError
from data_rewind.core.domain.models import PipelineRun, RunLifecycle, utc_now

# Explicit valid transitions mapping
VALID_TRANSITIONS: dict[RunLifecycle, set[RunLifecycle]] = {
    RunLifecycle.PENDING: {
        RunLifecycle.RUNNING,
        RunLifecycle.CANCELLED,
    },
    RunLifecycle.RUNNING: {
        RunLifecycle.COMPLETED,
        RunLifecycle.FAILED,
        RunLifecycle.CANCELLED,
        RunLifecycle.INTERRUPTED,
    },
    RunLifecycle.COMPLETED: set(),  # Terminal
    RunLifecycle.FAILED: set(),  # Terminal
    RunLifecycle.CANCELLED: set(),  # Terminal
    RunLifecycle.INTERRUPTED: set(),  # Terminal
}

TERMINAL_STATES: frozenset[RunLifecycle] = frozenset(
    {
        RunLifecycle.COMPLETED,
        RunLifecycle.FAILED,
        RunLifecycle.CANCELLED,
        RunLifecycle.INTERRUPTED,
    }
)


class LifecycleStateMachine:
    """Finite State Machine enforcing legal run lifecycle transitions."""

    @staticmethod
    def is_valid_transition(current: RunLifecycle, target: RunLifecycle) -> bool:
        """Check whether transition from current to target is permitted."""
        return target in VALID_TRANSITIONS.get(current, set())

    @staticmethod
    def validate_transition(current: RunLifecycle, target: RunLifecycle) -> None:
        """Validate transition or raise InvalidLifecycleTransitionError."""
        if not LifecycleStateMachine.is_valid_transition(current, target):
            raise InvalidLifecycleTransitionError(
                f"Illegal run lifecycle transition from {current.value} to {target.value}",
                details={
                    "current_state": current.value,
                    "target_state": target.value,
                    "is_terminal": current in TERMINAL_STATES,
                },
            )

    @staticmethod
    def transition(run: PipelineRun, target: RunLifecycle) -> PipelineRun:
        """Validate and return updated PipelineRun with the new lifecycle state."""
        LifecycleStateMachine.validate_transition(run.lifecycle_status, target)
        now = utc_now()
        updates: dict[str, object] = {"lifecycle_status": target}

        if target == RunLifecycle.RUNNING and run.started_at is None:
            updates["started_at"] = now
            updates["last_heartbeat_at"] = now
        elif target in TERMINAL_STATES and run.completed_at is None:
            updates["completed_at"] = now
            if run.started_at:
                start = run.started_at
                updates["duration_ms"] = int((now - start).total_seconds() * 1000)

        return run.model_copy(update=updates)

    @staticmethod
    def update_heartbeat(run: PipelineRun, timestamp: datetime | None = None) -> PipelineRun:
        """Record an active execution heartbeat."""
        if run.lifecycle_status != RunLifecycle.RUNNING:
            raise InvalidLifecycleTransitionError(
                f"Cannot update heartbeat for run in state {run.lifecycle_status.value}",
                details={"current_state": run.lifecycle_status.value},
            )
        hb = timestamp or utc_now()
        return run.model_copy(update={"last_heartbeat_at": hb})

    @staticmethod
    def is_heartbeat_lost(
        run: PipelineRun,
        now: datetime | None = None,
        timeout_seconds: int = 60,
    ) -> bool:
        """Detect whether an active run has missed heartbeats beyond timeout threshold."""
        if run.lifecycle_status not in (RunLifecycle.RUNNING, RunLifecycle.PENDING):
            return False

        check_time = now or utc_now()
        ref_time = run.last_heartbeat_at or run.started_at
        if ref_time is None:
            return False

        elapsed = (check_time - ref_time).total_seconds()
        return elapsed > timeout_seconds
