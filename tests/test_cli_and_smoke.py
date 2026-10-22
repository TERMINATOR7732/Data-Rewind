"""Tests for Data Rewind CLI and smoke test execution."""

from __future__ import annotations

import sys

import pytest

from data_rewind.cli import main, print_diagnostics
from data_rewind.smoke_test import run_smoke_test


def test_smoke_test_execution_returns_zero() -> None:
    """Verify that the end-to-end smoke test runner succeeds completely."""
    exit_code = run_smoke_test()
    assert exit_code == 0


def test_cli_diagnostics_output(capsys: pytest.CaptureFixture[str]) -> None:
    """Verify CLI diagnostics prints expected environment information."""
    code = print_diagnostics()
    assert code == 0

    captured = capsys.readouterr()
    assert "DATA REWIND -- LOCAL SYSTEM DIAGNOSTICS" in captured.out
    assert "Engine Version:" in captured.out
    assert "DuckDB Version:" in captured.out
    assert "Process RSS Ceiling:" in captured.out


def test_cli_main_entrypoint(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """Test CLI main() dispatch for diagnostics and smoke-test."""
    # Test diagnostics dispatch
    monkeypatch.setattr(sys, "argv", ["data-rewind", "diagnostics"])
    with pytest.raises(SystemExit) as exc_info:
        main()
    assert exc_info.value.code == 0

    # Test smoke-test dispatch
    monkeypatch.setattr(sys, "argv", ["data-rewind", "smoke-test"])
    with pytest.raises(SystemExit) as exc_info:
        main()
    assert exc_info.value.code == 0

    # Test benchmark dispatch
    monkeypatch.setattr(sys, "argv", ["data-rewind", "benchmark", "--quick"])
    with pytest.raises(SystemExit) as exc_info:
        main()
    assert exc_info.value.code == 0
