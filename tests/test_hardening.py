"""Hardening, resource limit, security fuzzing, and failure path regression tests.

Conforms to Milestone 6.0 Workstreams C and D:
- 50 MB CSV size limit
- 500k row limit
- 100 column limit
- 4,096 character cell limit
- 64 KB line length limit
- Path jail and directory traversal containment
- Workspace purge containment
- Malformed and cyclic DAG detection
- AST expression sandboxing & complexity limits
- Formula-injection mitigation in spreadsheet exports
"""

from __future__ import annotations

import io
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from data_rewind.api.dependencies import APIDependencies
from data_rewind.api.main import create_app
from data_rewind.core.config.settings import Settings
from data_rewind.core.dag.validator import DAGValidator
from data_rewind.core.domain.errors import (
    CyclicDependencyError,
    ExpressionComplexityError,
    ExpressionSecurityError,
)
from data_rewind.core.domain.models import OperationType, TransformationStep
from data_rewind.core.expr.ast_sandbox import ASTSecurityValidator
from data_rewind.verification.reports import CSVFormulaEscaper


@pytest.fixture
def harden_client(tmp_path: Path) -> TestClient:
    """Create isolated TestClient with clean workspace for hardening tests."""
    ws = tmp_path / "harden_ws"
    ws.mkdir(parents=True, exist_ok=True)
    test_settings = Settings(
        profile="local",
        base_data_dir=ws,
    )
    APIDependencies.set_settings(test_settings)
    app = create_app()
    return TestClient(app)


# ==============================================================================
# Workstream C: Resource Limits & Ingestion Failure Tests
# ==============================================================================


def test_reject_non_csv_extension(harden_client: TestClient) -> None:
    """Verify non-CSV files are rejected with INVALID_FILE_TYPE."""
    data = io.BytesIO(b"id,val\n1,a")
    res = harden_client.post(
        "/api/v1/datasets/upload",
        files={"file": ("test.json", data, "application/json")},
    )
    assert res.status_code == 400
    err = res.json()["error"]
    assert err["code"] == "INVALID_FILE_TYPE"


def test_reject_empty_csv(harden_client: TestClient) -> None:
    """Verify empty 0-byte CSV is rejected with EMPTY_FILE_ERROR."""
    data = io.BytesIO(b"")
    res = harden_client.post(
        "/api/v1/datasets/upload",
        files={"file": ("empty.csv", data, "text/csv")},
    )
    assert res.status_code == 400
    err = res.json()["error"]
    assert err["code"] == "EMPTY_FILE_ERROR"


def test_reject_column_count_limit_exceeded(harden_client: TestClient) -> None:
    """Verify CSV with > 100 columns is rejected with COLUMN_COUNT_LIMIT_EXCEEDED."""
    header = ",".join(f"col_{i}" for i in range(105))
    row = ",".join(f"val_{i}" for i in range(105))
    csv_bytes = f"{header}\n{row}".encode()

    res = harden_client.post(
        "/api/v1/datasets/upload",
        files={"file": ("wide.csv", io.BytesIO(csv_bytes), "text/csv")},
    )
    assert res.status_code == 400
    err = res.json()["error"]
    assert err["code"] == "COLUMN_COUNT_LIMIT_EXCEEDED"


def test_reject_cell_length_limit_exceeded(harden_client: TestClient) -> None:
    """Verify CSV with a cell > 4,096 chars is rejected with CELL_LENGTH_LIMIT_EXCEEDED."""
    oversized_cell = "X" * 4500
    csv_bytes = f"id,description\n1,{oversized_cell}".encode()

    res = harden_client.post(
        "/api/v1/datasets/upload",
        files={"file": ("oversized_cell.csv", io.BytesIO(csv_bytes), "text/csv")},
    )
    assert res.status_code == 400
    err = res.json()["error"]
    assert err["code"] == "CELL_LENGTH_LIMIT_EXCEEDED"


def test_reject_line_length_limit_exceeded(harden_client: TestClient) -> None:
    """Verify CSV line exceeding 64 KB is rejected with LINE_LENGTH_EXCEEDED."""
    # 65 KB row with many small cells or single cell
    long_line = "A" * (65 * 1024)
    csv_bytes = f"header\n{long_line}".encode()

    res = harden_client.post(
        "/api/v1/datasets/upload",
        files={"file": ("long_line.csv", io.BytesIO(csv_bytes), "text/csv")},
    )
    assert res.status_code == 400
    err = res.json()["error"]
    assert err["code"] == "LINE_LENGTH_EXCEEDED"


# ==============================================================================
# Workstream C: Path Jail & Confinement Tests
# ==============================================================================


def test_dataset_preview_path_traversal_confinement(harden_client: TestClient) -> None:
    """Verify path traversal in dataset preview endpoint fails safely."""
    # Attempt directory traversal vectors
    for bad_id in [
        "../../etc/passwd",
        r"..\..\windows\win.ini",
        "%2e%2e%2f%2e%2e%2fetc%2fpasswd",
        "....//....//....//etc/shadow",
    ]:
        res = harden_client.get(f"/api/v1/datasets/{bad_id}/preview")
        assert res.status_code == 404, f"Traversal vector '{bad_id}' was not rejected with 404"


def test_workspace_purge_confinement(harden_client: TestClient, tmp_path: Path) -> None:
    """Verify workspace purge cannot escape the designated base directory."""
    outside_file = tmp_path / "outside_safe_file.txt"
    outside_file.write_text("critical external data")

    # Perform workspace purge
    res = harden_client.delete("/api/v1/workspaces/purge")
    assert res.status_code == 200
    data = res.json()
    assert data["vacuum_completed"] is True

    # Confirm external file outside workspace remains completely intact
    assert outside_file.exists()
    assert outside_file.read_text() == "critical external data"


# ==============================================================================
# Workstream C: DAG Topology & Cycle Prevention Tests
# ==============================================================================


def test_dag_self_cycle_rejection() -> None:
    """Verify self-referencing step cycle is rejected."""
    steps = [
        TransformationStep(
            step_id="step_a",
            operation_type=OperationType.FILTER_ROWS,
            input_step_ids=["step_a"],
            parameters={"predicate": "1 == 1"},
        )
    ]
    with pytest.raises(CyclicDependencyError) as exc_info:
        DAGValidator.validate_and_order(steps, ["raw_input"])
    assert "step_a" in str(exc_info.value)


def test_dag_mutual_cycle_rejection() -> None:
    """Verify mutual cycle between two steps is rejected with cycle path."""
    steps = [
        TransformationStep(
            step_id="step_a",
            operation_type=OperationType.FILTER_ROWS,
            input_step_ids=["step_b"],
            parameters={"predicate": "1 == 1"},
        ),
        TransformationStep(
            step_id="step_b",
            operation_type=OperationType.FILTER_ROWS,
            input_step_ids=["step_a"],
            parameters={"predicate": "1 == 1"},
        ),
    ]
    with pytest.raises(CyclicDependencyError) as exc_info:
        DAGValidator.validate_and_order(steps, [])
    assert "Cyclic dependency detected" in str(exc_info.value)


def test_dag_3_step_cycle_rejection() -> None:
    """Verify 3-step cycle (A -> B -> C -> A) is detected and rejected."""
    steps = [
        TransformationStep(
            step_id="step_a",
            operation_type=OperationType.FILTER_ROWS,
            input_step_ids=["step_c"],
            parameters={"predicate": "1 == 1"},
        ),
        TransformationStep(
            step_id="step_b",
            operation_type=OperationType.FILTER_ROWS,
            input_step_ids=["step_a"],
            parameters={"predicate": "1 == 1"},
        ),
        TransformationStep(
            step_id="step_c",
            operation_type=OperationType.FILTER_ROWS,
            input_step_ids=["step_b"],
            parameters={"predicate": "1 == 1"},
        ),
    ]
    with pytest.raises(CyclicDependencyError) as exc_info:
        DAGValidator.validate_and_order(steps, [])
    assert "Cyclic dependency detected" in str(exc_info.value)


# ==============================================================================
# Workstream D: AST Security Sandboxing & Complexity Fuzzing
# ==============================================================================


@pytest.mark.parametrize(
    "forbidden_expr",
    [
        "__import__('os').system('dir')",
        "__builtins__.__import__('subprocess')",
        "().__class__.__bases__[0].__subclasses__()",
        "eval('1 + 1')",
        "exec('import sys')",
        "open('/etc/passwd').read()",
        "compile('x = 1', '', 'exec')",
        "x ** 100",  # Unbounded exponentiation (Pow)
        "x // 2",  # Forbidden FloorDiv operator
        "x << 4",  # Forbidden BitShift operator
        "[x for x in items]",  # Comprehensions forbidden
        "lambda x: x + 1",  # Lambdas forbidden
        "{'a': 1}",  # Dict literals forbidden
        "[1, 2, 3]",  # List literals forbidden
    ],
)
def test_ast_sandbox_security_rejections(forbidden_expr: str) -> None:
    """Verify malicious or unapproved Python syntax is strictly rejected."""
    with pytest.raises(ExpressionSecurityError):
        ASTSecurityValidator.validate(forbidden_expr)


def test_ast_sandbox_depth_limit() -> None:
    """Verify nested expressions exceeding MAX_AST_DEPTH (10) are rejected."""
    # Build expression nested 12 levels deep
    deep_expr = "1"
    for _ in range(12):
        deep_expr = f"({deep_expr} + 1)"
    with pytest.raises(ExpressionComplexityError) as exc_info:
        ASTSecurityValidator.validate(deep_expr)
    assert "depth" in str(exc_info.value).lower()


def test_ast_sandbox_node_count_limit() -> None:
    """Verify expressions exceeding MAX_AST_NODES (50) are rejected."""
    # coalesce call with 55 args: depth is 2, node count is 56 > 50
    args = ", ".join(str(i) for i in range(55))
    big_expr = f"coalesce({args})"
    with pytest.raises(ExpressionComplexityError) as exc_info:
        ASTSecurityValidator.validate(big_expr)
    assert "node" in str(exc_info.value).lower()


def test_ast_sandbox_length_limit() -> None:
    """Verify expressions exceeding MAX_EXPRESSION_LENGTH (1,000) are rejected."""
    long_var = "a" * 1050
    with pytest.raises(ExpressionComplexityError) as exc_info:
        ASTSecurityValidator.validate(long_var)
    assert "length" in str(exc_info.value).lower()


def test_ast_sandbox_valid_expressions() -> None:
    """Verify legitimate arithmetic, string, and logical expressions pass."""
    valid_exprs = [
        "amount > 100.0 and status == 'COMPLETED'",
        "round(amount * 1.05, 2)",
        "upper(trim(region))",
        "if_else(score >= 50, 'PASS', 'FAIL')",
        "coalesce(tax, 0.0) + amount",
        "abs(delta) < 0.01",
    ]
    for expr in valid_exprs:
        ast_obj = ASTSecurityValidator.validate(expr)
        assert ast_obj is not None


# ==============================================================================
# Workstream D: Formula Injection Mitigation Tests
# ==============================================================================


@pytest.mark.parametrize(
    "raw_val,expected_prefix",
    [
        ("=1+1", "'=1+1"),
        ("+cmd|' /C calc'!A0", "'+cmd|' /C calc'!A0"),
        ("-2+3*4", "'-2+3*4"),
        ("@SUM(A1:A10)", "'@SUM(A1:A10)"),
        ("\tDDE('cmd')", "'\tDDE('cmd')"),
        ("\r=1+1", "'\r=1+1"),
    ],
)
def test_formula_injection_escaping_in_safe_mode(raw_val: str, expected_prefix: str) -> None:
    """Verify potentially dangerous spreadsheet formula triggers are escaped with single-quote."""
    sanitized, was_escaped = CSVFormulaEscaper.sanitize_cell(raw_val, export_mode="safe")
    assert sanitized == expected_prefix
    assert was_escaped is True


def test_formula_injection_leaves_benign_values_untouched() -> None:
    """Verify numbers, booleans, and harmless text are not mangled by sanitize_cell."""
    sanitized, was_escaped = CSVFormulaEscaper.sanitize_cell("123.45", export_mode="safe")
    assert sanitized == "123.45"
    assert was_escaped is False

    sanitized, was_escaped = CSVFormulaEscaper.sanitize_cell(100, export_mode="safe")
    assert sanitized == "100"
    assert was_escaped is False

    sanitized, was_escaped = CSVFormulaEscaper.sanitize_cell("Regular text", export_mode="safe")
    assert sanitized == "Regular text"
    assert was_escaped is False

    sanitized, was_escaped = CSVFormulaEscaper.sanitize_cell(None, export_mode="safe")
    assert sanitized == ""
    assert was_escaped is False
    sanitized, was_escaped = CSVFormulaEscaper.sanitize_cell(True, export_mode="safe")
    assert sanitized == "True"
    assert was_escaped is False
