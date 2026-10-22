"""Tests for Data Rewind run lifecycle state machine and heartbeats."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest

from data_rewind.core.domain.errors import InvalidLifecycleTransitionError
from data_rewind.core.domain.lifecycle import (
    TERMINAL_STATES,
    LifecycleStateMachine,
)
from data_rewind.core.domain.models import (
    PipelineRun,
    RunLifecycle,
    RunType,
)


@pytest.fixture
def sample_run() -> PipelineRun:
    """Create a new pending PipelineRun."""
    return PipelineRun(
        run_id=uuid4(),
        pipeline_version_id=uuid4(),
        run_type=RunType.BASELINE,
        lifecycle_status=RunLifecycle.PENDING,
    )


def test_valid_lifecycle_transitions(sample_run: PipelineRun) -> None:
    """Test standard normal path transitions."""
    # PENDING -> RUNNING
    running = LifecycleStateMachine.transition(sample_run, RunLifecycle.RUNNING)
    assert running.lifecycle_status == RunLifecycle.RUNNING
    assert running.started_at is not None
    assert running.last_heartbeat_at is not None

    # RUNNING -> COMPLETED
    completed = LifecycleStateMachine.transition(running, RunLifecycle.COMPLETED)
    assert completed.lifecycle_status == RunLifecycle.COMPLETED
    assert completed.completed_at is not None
    assert completed.duration_ms is not None
    assert completed.duration_ms >= 0


def test_cancellation_paths(sample_run: PipelineRun) -> None:
    """Test cancellation from PENDING and from RUNNING."""
    # Direct cancel from PENDING
    cancelled_early = LifecycleStateMachine.transition(sample_run, RunLifecycle.CANCELLED)
    assert cancelled_early.lifecycle_status == RunLifecycle.CANCELLED

    # Cancel while RUNNING
    running = LifecycleStateMachine.transition(sample_run, RunLifecycle.RUNNING)
    cancelled_active = LifecycleStateMachine.transition(running, RunLifecycle.CANCELLED)
    assert cancelled_active.lifecycle_status == RunLifecycle.CANCELLED


def test_failure_and_interruption_paths(sample_run: PipelineRun) -> None:
    """Test transition to FAILED and INTERRUPTED."""
    running = LifecycleStateMachine.transition(sample_run, RunLifecycle.RUNNING)

    failed = LifecycleStateMachine.transition(running, RunLifecycle.FAILED)
    assert failed.lifecycle_status == RunLifecycle.FAILED

    running2 = LifecycleStateMachine.transition(sample_run, RunLifecycle.RUNNING)
    interrupted = LifecycleStateMachine.transition(running2, RunLifecycle.INTERRUPTED)
    assert interrupted.lifecycle_status == RunLifecycle.INTERRUPTED


def test_invalid_transitions_rejected(sample_run: PipelineRun) -> None:
    """Test illegal transitions raise InvalidLifecycleTransitionError."""
    # PENDING -> COMPLETED (cannot finish without running)
    with pytest.raises(InvalidLifecycleTransitionError) as exc_info:
        LifecycleStateMachine.transition(sample_run, RunLifecycle.COMPLETED)
    assert exc_info.value.code == "INVALID_LIFECYCLE_TRANSITION"

    # Terminal states cannot transition to anything
    running = LifecycleStateMachine.transition(sample_run, RunLifecycle.RUNNING)
    for terminal in TERMINAL_STATES:
        term_run = LifecycleStateMachine.transition(running, terminal)
        # Attempting to re-run
        with pytest.raises(InvalidLifecycleTransitionError):
            LifecycleStateMachine.transition(term_run, RunLifecycle.RUNNING)
        # Attempting to switch terminal states
        with pytest.raises(InvalidLifecycleTransitionError):
            LifecycleStateMachine.transition(term_run, RunLifecycle.COMPLETED)


def test_heartbeat_updates_and_timeout(sample_run: PipelineRun) -> None:
    """Test heartbeat recording and timeout detection."""
    # Cannot update heartbeat in PENDING
    with pytest.raises(InvalidLifecycleTransitionError):
        LifecycleStateMachine.update_heartbeat(sample_run)

    running = LifecycleStateMachine.transition(sample_run, RunLifecycle.RUNNING)
    now = datetime.now(UTC)

    # Fresh heartbeat
    running = LifecycleStateMachine.update_heartbeat(running, now)
    assert not LifecycleStateMachine.is_heartbeat_lost(running, now=now, timeout_seconds=60)

    # Simulated elapsed time past timeout (75 seconds later)
    future_now = now + timedelta(seconds=75)
    assert LifecycleStateMachine.is_heartbeat_lost(running, now=future_now, timeout_seconds=60)

    # Completed runs do not trigger heartbeat lost
    completed = LifecycleStateMachine.transition(running, RunLifecycle.COMPLETED)
    assert not LifecycleStateMachine.is_heartbeat_lost(
        completed, now=future_now, timeout_seconds=60
    )
