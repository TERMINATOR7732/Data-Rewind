"""Adversarial and security tests for sandboxed AST expression engine."""

from __future__ import annotations

import ast
import time

import pytest

from data_rewind.core.domain.errors import (
    DomainValidationError,
    ExpressionComplexityError,
    ExpressionSecurityError,
    ExpressionTimeoutError,
)
from data_rewind.core.expr.ast_sandbox import ASTSecurityValidator
from data_rewind.core.expr.evaluator import ASTEvaluator

# --- Valid Expressions & Pure Functions ---


def test_valid_arithmetic_and_pure_functions() -> None:
    """Test allowed arithmetic, comparisons, conditionals, and pure functions."""
    evaluator = ASTEvaluator.compile_expression("coalesce(tax, 0.0) + round(amount * 1.15, 2)")
    res = evaluator.evaluate({"amount": 100.0, "tax": 5.25})
    assert res == 120.25

    # String operations
    s_eval = ASTEvaluator.compile_expression("upper(trim(status))")
    assert s_eval.evaluate({"status": "  completed  "}) == "COMPLETED"

    # Lowercase & len
    l_eval = ASTEvaluator.compile_expression("len(lower(name))")
    assert l_eval.evaluate({"name": "DataRewind"}) == 10

    # Date diff
    d_eval = ASTEvaluator.compile_expression("date_diff(end_date, start_date)")
    assert d_eval.evaluate({"end_date": "2026-10-22", "start_date": "2026-10-12"}) == 10

    # if_else function and Python ternary IfExp
    ife_eval = ASTEvaluator.compile_expression("if_else(qty > 10, 'BULK', 'RETAIL')")
    assert ife_eval.evaluate({"qty": 15}) == "BULK"
    assert ife_eval.evaluate({"qty": 5}) == "RETAIL"

    tern_eval = ASTEvaluator.compile_expression("'HIGH' if score >= 80 else 'NORMAL'")
    assert tern_eval.evaluate({"score": 85}) == "HIGH"
    assert tern_eval.evaluate({"score": 60}) == "NORMAL"


def test_null_propagation() -> None:
    """Test standard SQL-like null propagation in operators."""
    evaluator = ASTEvaluator.compile_expression("a + b")
    assert evaluator.evaluate({"a": 10, "b": None}) is None
    assert evaluator.evaluate({"a": None, "b": 10}) is None

    # coalesce handles nulls safely
    coalesce_eval = ASTEvaluator.compile_expression("coalesce(a, b, 0)")
    assert coalesce_eval.evaluate({"a": None, "b": None}) == 0
    assert coalesce_eval.evaluate({"a": None, "b": 42}) == 42


def test_division_and_modulo_by_zero() -> None:
    """Test explicit zero-division handling."""
    div_eval = ASTEvaluator.compile_expression("a / b")
    with pytest.raises(DomainValidationError, match="Division by zero"):
        div_eval.evaluate({"a": 10, "b": 0})

    mod_eval = ASTEvaluator.compile_expression("a % b")
    with pytest.raises(DomainValidationError, match="Modulo by zero"):
        mod_eval.evaluate({"a": 10, "b": 0})


# --- Adversarial Security Fuzzing (Rejection Vectors) ---


@pytest.mark.parametrize(
    "hostile_expr",
    [
        "__import__('os').system('dir')",
        "eval('1 + 1')",
        "exec('x = 42')",
        "compile('1+1', '', 'eval')",
        "open('/etc/passwd').read()",
        "getattr(x, '__class__')",
        "x.__class__.__bases__[0]",
        "lambda x: x + 1",
        "[x for x in range(10)]",
        "{'a': 1, 'b': 2}",
        "[1, 2, 3]",
        "(1, 2, 3)",
        "x[0]",
        "x['key']",
        "x.strip()",
        "str.upper('hello')",
        "sys.exit(0)",
        "os.remove('file')",
    ],
)
def test_hostile_syntax_rejected(hostile_expr: str) -> None:
    """Verify malicious payloads and forbidden node types are rejected at AST parse time."""
    with pytest.raises(ExpressionSecurityError):
        ASTSecurityValidator.validate(hostile_expr)


def test_string_multiplication_rejected() -> None:
    """Verify string multiplication attack ('A' * 1000) is rejected during evaluation."""
    evaluator = ASTEvaluator.compile_expression("s * 1000")
    with pytest.raises(
        ExpressionSecurityError, match="String multiplication is strictly prohibited"
    ):
        evaluator.evaluate({"s": "A"})


def test_exponentiation_prohibited() -> None:
    """Verify Pow operator (**) is prohibited in AST validation."""
    with pytest.raises(ExpressionSecurityError, match="Operator 'Pow' is strictly prohibited"):
        ASTSecurityValidator.validate("2 ** 1000000")


def test_structural_complexity_depth_limit() -> None:
    """Verify deeply nested AST tree (depth > 10) is rejected."""
    # Build expression nested 12 levels deep: (1 + (1 + (1 + ...)))
    deep_expr = "1 + " * 12 + "1"
    with pytest.raises(ExpressionComplexityError, match="depth"):
        ASTSecurityValidator.validate(deep_expr)


def test_structural_complexity_node_count_limit() -> None:
    """Verify excessive node count (> 50 nodes) is rejected while keeping depth <= 10."""
    # coalesce with 52 arguments: depth is 2, node count > 50
    args = [f"c{i}" for i in range(52)]
    broad_expr = f"coalesce({', '.join(args)})"
    with pytest.raises(ExpressionComplexityError, match="node count"):
        ASTSecurityValidator.validate(broad_expr)


def test_raw_expression_length_limit() -> None:
    """Verify raw expression length > 1,000 characters is rejected immediately."""
    long_expr = "a" * 1001
    with pytest.raises(ExpressionComplexityError, match="length"):
        ASTSecurityValidator.validate(long_expr)


def test_unknown_variable_reference_rejected() -> None:
    """Verify referencing non-existent column raises DomainValidationError."""
    evaluator = ASTEvaluator.compile_expression("revenue + unknown_col")
    with pytest.raises(DomainValidationError, match="Column or variable 'unknown_col' not found"):
        evaluator.evaluate({"revenue": 100.0})


def test_batch_evaluation_timeout_interruption(monkeypatch: pytest.MonkeyPatch) -> None:
    """Verify batch evaluation enforces 1.0s timeout."""
    evaluator = ASTEvaluator.compile_expression("amount * 2")
    rows = [{"amount": i} for i in range(250)]

    # Mock time.perf_counter so second check exceeds 1.0s
    times = [0.0, 0.0, 2.5, 2.5]
    idx = 0

    def mock_perf_counter() -> float:
        nonlocal idx
        val = times[min(idx, len(times) - 1)]
        idx += 1
        return val

    monkeypatch.setattr(time, "perf_counter", mock_perf_counter)

    with pytest.raises(ExpressionTimeoutError, match="exceeded timeout"):
        evaluator.evaluate_batch(rows, timeout_seconds=1.0)


def test_evaluator_operator_branches_and_errors() -> None:
    """Test all binary and unary operator branches and type errors in evaluator."""
    # Unary plus
    uplus_eval = ASTEvaluator.compile_expression("+val")
    assert uplus_eval.evaluate({"val": 5}) == 5
    with pytest.raises(DomainValidationError, match="Unary '\\+' requires numeric"):
        uplus_eval.evaluate({"val": "non_numeric"})

    # Unary minus error
    uminus_eval = ASTEvaluator.compile_expression("-val")
    with pytest.raises(DomainValidationError, match="Unary '-' requires numeric"):
        uminus_eval.evaluate({"val": "non_numeric"})

    # Not operator
    not_eval = ASTEvaluator.compile_expression("not flag")
    assert not_eval.evaluate({"flag": True}) is False
    assert not_eval.evaluate({"flag": False}) is True

    # Addition: string concatenation and type mismatch
    concat_eval = ASTEvaluator.compile_expression("prefix + suffix")
    assert concat_eval.evaluate({"prefix": "foo", "suffix": "bar"}) == "foobar"

    with pytest.raises(DomainValidationError, match="Cannot add mismatched types"):
        concat_eval.evaluate({"prefix": "foo", "suffix": 42})

    # Subtraction error
    sub_eval = ASTEvaluator.compile_expression("a - b")
    with pytest.raises(DomainValidationError, match="Subtraction requires numeric operands"):
        sub_eval.evaluate({"a": "foo", "b": 10})

    # Division non-numeric error
    div_eval = ASTEvaluator.compile_expression("a / b")
    with pytest.raises(DomainValidationError, match="Division requires numeric operands"):
        div_eval.evaluate({"a": "foo", "b": 10})

    # Modulo non-numeric error
    mod_eval = ASTEvaluator.compile_expression("a % b")
    with pytest.raises(DomainValidationError, match="Modulo requires numeric operands"):
        mod_eval.evaluate({"a": "foo", "b": 10})

    # Boolean operators: And / Or
    and_eval = ASTEvaluator.compile_expression("a and b")
    assert and_eval.evaluate({"a": True, "b": False}) is False
    assert and_eval.evaluate({"a": True, "b": True}) is True

    or_eval = ASTEvaluator.compile_expression("a or b")
    assert or_eval.evaluate({"a": False, "b": True}) is True
    assert or_eval.evaluate({"a": False, "b": False}) is False

    # Comparisons with null
    lt_eval = ASTEvaluator.compile_expression("a < b")
    assert lt_eval.evaluate({"a": None, "b": 10}) is False
    assert lt_eval.evaluate({"a": 10, "b": None}) is False

    lte_eval = ASTEvaluator.compile_expression("a <= b")
    assert lte_eval.evaluate({"a": 10, "b": 10}) is True
    assert lte_eval.evaluate({"a": 11, "b": 10}) is False

    gt_eval = ASTEvaluator.compile_expression("a > b")
    assert gt_eval.evaluate({"a": 10, "b": 5}) is True
    assert gt_eval.evaluate({"a": 5, "b": 10}) is False

    gte_eval = ASTEvaluator.compile_expression("a >= b")
    assert gte_eval.evaluate({"a": 10, "b": 10}) is True
    assert gte_eval.evaluate({"a": 9, "b": 10}) is False

    neq_eval = ASTEvaluator.compile_expression("a != b")
    assert neq_eval.evaluate({"a": 10, "b": 20}) is True
    assert neq_eval.evaluate({"a": 10, "b": 10}) is False


def test_evaluator_pure_functions_error_branches() -> None:
    """Test pure functions edge cases and type errors."""
    # abs non-numeric
    abs_eval = ASTEvaluator.compile_expression("abs(x)")
    with pytest.raises(DomainValidationError, match="abs\\(\\) requires numeric"):
        abs_eval.evaluate({"x": "not_number"})
    assert abs_eval.evaluate({"x": None}) is None

    # round non-numeric
    rnd_eval = ASTEvaluator.compile_expression("round(x, 2)")
    with pytest.raises(DomainValidationError, match="round\\(\\) requires numeric"):
        rnd_eval.evaluate({"x": "not_number"})
    assert rnd_eval.evaluate({"x": None}) is None

    # upper / lower / trim with null
    assert ASTEvaluator.compile_expression("upper(x)").evaluate({"x": None}) is None
    assert ASTEvaluator.compile_expression("lower(x)").evaluate({"x": None}) is None
    assert ASTEvaluator.compile_expression("trim(x)").evaluate({"x": None}) is None
    assert ASTEvaluator.compile_expression("len(x)").evaluate({"x": None}) is None

    # date_diff edge cases
    dd_eval = ASTEvaluator.compile_expression("date_diff(d1, d2)")
    assert dd_eval.evaluate({"d1": None, "d2": "2026-10-22"}) is None
    assert dd_eval.evaluate({"d1": "2026-10-22", "d2": None}) is None
    with pytest.raises(DomainValidationError, match="date_diff\\(\\) requires date"):
        dd_eval.evaluate({"d1": 12345, "d2": "2026-10-22"})


def test_ast_sandbox_syntax_and_identifier_errors() -> None:
    """Test empty string, syntax errors, and dunder name rejection."""
    with pytest.raises(ExpressionSecurityError, match="cannot be empty"):
        ASTSecurityValidator.validate("   ")

    with pytest.raises(ExpressionSecurityError, match="Syntax error"):
        ASTSecurityValidator.validate("amount + * 2")

    with pytest.raises(ExpressionSecurityError, match="Dunder identifier"):
        ASTSecurityValidator.validate("__init__ + 1")

    with pytest.raises(ExpressionSecurityError, match="Keyword arguments in function"):
        ASTSecurityValidator.validate("round(3.14, decimals=2)")


def test_evaluator_literals_and_constant_bounds() -> None:
    """Test boolean/null literal keywords and literal string bounds."""
    # Boolean and null keywords
    assert ASTEvaluator.compile_expression("true").evaluate({}) is True
    assert ASTEvaluator.compile_expression("false").evaluate({}) is False
    assert ASTEvaluator.compile_expression("null").evaluate({}) is None
    assert ASTEvaluator.compile_expression("'valid_string'").evaluate({}) == "valid_string"

    # Evaluator constant node with oversized string
    oversized_node = ast.Expression(body=ast.Constant(value="x" * 4097))
    evaluator = ASTEvaluator(oversized_node)
    with pytest.raises(ExpressionSecurityError, match="exceeds maximum permitted length"):
        evaluator.evaluate({})


def test_batch_timeout_one_row_behavior(monkeypatch: pytest.MonkeyPatch) -> None:
    """Test timeout enforcement for a single-row batch (P1-01)."""
    evaluator = ASTEvaluator.compile_expression("x * 2")
    row = [{"x": 21}]

    # 1. Normal single row passes
    res = evaluator.evaluate_batch(row, timeout_seconds=1.0)
    assert res == [42]

    # 2. Exceeded timeout caught by post-loop check
    times = [0.0, 1.5]  # start_time, post-loop check
    idx = 0

    def mock_time() -> float:
        nonlocal idx
        val = times[min(idx, len(times) - 1)]
        idx += 1
        return val

    monkeypatch.setattr(time, "perf_counter", mock_time)
    with pytest.raises(ExpressionTimeoutError) as exc_info:
        evaluator.evaluate_batch(row, timeout_seconds=1.0)
    assert exc_info.value.details["processed_rows"] == 1
    assert exc_info.value.details["total_rows"] == 1


def test_batch_timeout_sub_100_rows(monkeypatch: pytest.MonkeyPatch) -> None:
    """Verify sub-100 row batches enforce timeout within the loop (P1-01)."""
    evaluator = ASTEvaluator.compile_expression("x + 1")
    rows = [{"x": i} for i in range(50)]

    # 50 rows -> check_interval is max(1, min(100, 50 // 10)) = 5
    # Call 0: start_time -> 0.0
    # Call 1: idx=5 check -> 1.5 (> 1.0s)
    times = [0.0, 1.5]
    idx = 0

    def mock_time() -> float:
        nonlocal idx
        val = times[min(idx, len(times) - 1)]
        idx += 1
        return val

    monkeypatch.setattr(time, "perf_counter", mock_time)
    with pytest.raises(ExpressionTimeoutError) as exc_info:
        evaluator.evaluate_batch(rows, timeout_seconds=1.0)
    assert exc_info.value.details["processed_rows"] == 5
    assert exc_info.value.details["total_rows"] == 50


def test_batch_timeout_periodic_boundary_and_normal_completion(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Test boundary checks and successful completion within timeout (P1-01)."""
    evaluator = ASTEvaluator.compile_expression("x + 10")
    rows = [{"x": i} for i in range(30)]

    # 30 rows -> check_interval = 3
    # Boundary checks happen at idx = 3, 6, 9...
    # Test boundary check triggers on row 9
    times = [0.0, 0.2, 0.4, 1.2]  # start, idx=3, idx=6, idx=9 (exceeds 1.0s)
    idx = 0

    def mock_time() -> float:
        nonlocal idx
        val = times[min(idx, len(times) - 1)]
        idx += 1
        return val

    monkeypatch.setattr(time, "perf_counter", mock_time)
    with pytest.raises(ExpressionTimeoutError) as exc_info:
        evaluator.evaluate_batch(rows, timeout_seconds=1.0)
    assert exc_info.value.details["processed_rows"] == 9
    assert exc_info.value.details["total_rows"] == 30


def test_batch_timeout_post_loop_catch(monkeypatch: pytest.MonkeyPatch) -> None:
    """Verify timeout crossing between final periodic check and return is caught (P1-01)."""
    evaluator = ASTEvaluator.compile_expression("x * 3")
    rows = [{"x": i} for i in range(25)]

    # 25 rows -> check_interval = 2
    # In-loop checks at 2, 4, ..., 24 return 0.5s (within 1.0s)
    # Post-loop check returns 1.2s (> 1.0s)
    call_count = 0

    def mock_time() -> float:
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return 0.0  # start_time
        if call_count <= 13:  # 12 in-loop checks (at idx 2,4,...,24)
            return 0.5
        return 1.2  # post-loop check

    monkeypatch.setattr(time, "perf_counter", mock_time)
    with pytest.raises(ExpressionTimeoutError) as exc_info:
        evaluator.evaluate_batch(rows, timeout_seconds=1.0)
    assert exc_info.value.details["processed_rows"] == 25
    assert exc_info.value.details["total_rows"] == 25


def test_batch_timeout_empty_and_normal() -> None:
    """Test empty batch behavior and normal batch completion within timeout (P1-01)."""
    evaluator = ASTEvaluator.compile_expression("x * 1")

    # Normal completion with 75 rows
    rows = [{"x": i} for i in range(75)]
    results = evaluator.evaluate_batch(rows, timeout_seconds=5.0)
    assert len(results) == 75
    assert results[0] == 0
    assert results[-1] == 74

    # Empty batch returns empty list within valid timeout
    assert evaluator.evaluate_batch([], timeout_seconds=1.0) == []

    # Empty batch with already-expired timeout raises ExpressionTimeoutError
    with pytest.raises(ExpressionTimeoutError) as exc_info:
        evaluator.evaluate_batch([], timeout_seconds=-0.1)
    assert exc_info.value.details["processed_rows"] == 0
    assert exc_info.value.details["total_rows"] == 0
