"""Pure AST expression evaluator without eval(), exec(), or compile().

Conforms strictly to SPEC-MOD-06.
Guarantees:
- Pure recursive evaluation of validated AST nodes.
- Explicit protection against string multiplication ('A' * 1000).
- Explicit division by zero error handling.
- Null-safe propagation for pure functions and operators.
- Vectorized/batch evaluation with 1.0s timeout per batch.
"""

from __future__ import annotations

import ast
import math
import time
from datetime import date, datetime
from typing import Any

from data_rewind.core.domain.errors import (
    DomainValidationError,
    ExpressionSecurityError,
    ExpressionTimeoutError,
)
from data_rewind.core.expr.ast_sandbox import ASTSecurityValidator

DEFAULT_BATCH_TIMEOUT_SECONDS = 1.0
MAX_RESULT_STRING_LENGTH = 4_096


# --- Pure Helper Functions ---


def _fn_abs(val: Any) -> Any:
    if val is None:
        return None
    if not isinstance(val, (int, float)):
        raise DomainValidationError(f"abs() requires numeric argument, got {type(val).__name__}")
    return abs(val)


def _fn_round(val: Any, decimals: Any = 0) -> Any:
    if val is None:
        return None
    if not isinstance(val, (int, float)):
        raise DomainValidationError(f"round() requires numeric argument, got {type(val).__name__}")
    dec = int(decimals) if isinstance(decimals, (int, float)) else 0
    return round(val, dec)


def _fn_upper(val: Any) -> Any:
    if val is None:
        return None
    return str(val).upper()


def _fn_lower(val: Any) -> Any:
    if val is None:
        return None
    return str(val).lower()


def _fn_trim(val: Any) -> Any:
    if val is None:
        return None
    return str(val).strip()


def _fn_coalesce(*args: Any) -> Any:
    for a in args:
        if a is not None:
            return a
    return None


def _fn_if_else(cond: Any, true_val: Any, false_val: Any) -> Any:
    return true_val if bool(cond) else false_val


def _fn_len(val: Any) -> Any:
    if val is None:
        return None
    return len(str(val))


def _fn_date_diff(d1: Any, d2: Any) -> Any:
    """Return difference in days between two ISO date strings or date objects."""
    if d1 is None or d2 is None:
        return None

    def _parse(v: Any) -> date:
        if isinstance(v, datetime):
            return v.date()
        if isinstance(v, date):
            return v
        if isinstance(v, str):
            clean = v.strip().split("T")[0]
            return date.fromisoformat(clean)
        raise DomainValidationError(
            f"date_diff() requires date or ISO string, got {type(v).__name__}"
        )

    dt1 = _parse(d1)
    dt2 = _parse(d2)
    return (dt1 - dt2).days


PURE_FUNCTIONS = {
    "abs": _fn_abs,
    "round": _fn_round,
    "upper": _fn_upper,
    "lower": _fn_lower,
    "trim": _fn_trim,
    "coalesce": _fn_coalesce,
    "if_else": _fn_if_else,
    "len": _fn_len,
    "date_diff": _fn_date_diff,
}


class ASTEvaluator:
    """Evaluates validated AST expressions directly without using Python eval/exec."""

    def __init__(self, tree: ast.Expression) -> None:
        self.tree = tree

    @classmethod
    def compile_expression(cls, expression: str) -> ASTEvaluator:
        """Validate expression security bounds and return an ASTEvaluator instance."""
        validated_tree = ASTSecurityValidator.validate(expression)
        return cls(validated_tree)

    def evaluate(self, env: dict[str, Any]) -> Any:
        """Evaluate the expression against a single row dictionary environment."""
        return self._eval_node(self.tree.body, env)

    def evaluate_batch(
        self,
        rows: list[dict[str, Any]],
        timeout_seconds: float = DEFAULT_BATCH_TIMEOUT_SECONDS,
    ) -> list[Any]:
        """Evaluate expression over a collection of row records with timeout enforcement."""
        results: list[Any] = []
        start_time = time.perf_counter()
        check_interval = max(1, min(100, len(rows) // 10))

        for idx, row in enumerate(rows):
            if idx > 0 and idx % check_interval == 0:
                elapsed = time.perf_counter() - start_time
                if elapsed > timeout_seconds:
                    raise ExpressionTimeoutError(
                        f"Expression evaluation exceeded timeout of {timeout_seconds}s "
                        f"at row {idx}/{len(rows)}",
                        details={
                            "processed_rows": idx,
                            "total_rows": len(rows),
                            "elapsed_s": elapsed,
                        },
                    )

            val = self.evaluate(row)
            results.append(val)

        total_elapsed = time.perf_counter() - start_time
        if total_elapsed > timeout_seconds:
            raise ExpressionTimeoutError(
                f"Expression evaluation exceeded timeout of {timeout_seconds}s "
                f"at row {len(rows)}/{len(rows)}",
                details={
                    "processed_rows": len(rows),
                    "total_rows": len(rows),
                    "elapsed_s": total_elapsed,
                },
            )

        return results

    def _eval_node(self, node: ast.AST, env: dict[str, Any]) -> Any:
        """Recursive node evaluator with strict type and security bounds."""
        if isinstance(node, ast.Constant):
            val = node.value
            if isinstance(val, str) and len(val) > MAX_RESULT_STRING_LENGTH:
                raise ExpressionSecurityError(
                    f"Literal string exceeds maximum permitted length ({MAX_RESULT_STRING_LENGTH})"
                )
            return val

        if isinstance(node, ast.Name):
            var_name = node.id
            if var_name in env:
                return env[var_name]
            # Check for boolean or null literals
            if var_name == "null" or var_name == "NULL":
                return None
            if var_name == "true" or var_name == "TRUE":
                return True
            if var_name == "false" or var_name == "FALSE":
                return False
            raise DomainValidationError(
                f"Column or variable '{var_name}' not found in record",
                code="UNKNOWN_COLUMN",
                details={"variable": var_name, "available_columns": sorted(env.keys())},
            )

        if isinstance(node, ast.UnaryOp):
            operand = self._eval_node(node.operand, env)
            if isinstance(node.op, ast.Not):
                return not bool(operand)
            if operand is None:
                return None
            if isinstance(node.op, ast.USub):
                if not isinstance(operand, (int, float)):
                    raise DomainValidationError(
                        f"Unary '-' requires numeric operand, got {type(operand).__name__}"
                    )
                return -operand
            if isinstance(node.op, ast.UAdd):
                if not isinstance(operand, (int, float)):
                    raise DomainValidationError(
                        f"Unary '+' requires numeric operand, got {type(operand).__name__}"
                    )
                return +operand

        if isinstance(node, ast.BinOp):
            return self._eval_binop(node, env)

        if isinstance(node, ast.BoolOp):
            if isinstance(node.op, ast.And):
                for val_node in node.values:
                    res = self._eval_node(val_node, env)
                    if not res:
                        return res
                return res
            if isinstance(node.op, ast.Or):
                for val_node in node.values:
                    res = self._eval_node(val_node, env)
                    if res:
                        return res
                return res

        if isinstance(node, ast.Compare):
            left = self._eval_node(node.left, env)
            for op, comparator in zip(node.ops, node.comparators, strict=True):
                right = self._eval_node(comparator, env)
                if not self._eval_comparison(op, left, right):
                    return False
                left = right
            return True

        if isinstance(node, ast.IfExp):
            test = self._eval_node(node.test, env)
            if test:
                return self._eval_node(node.body, env)
            return self._eval_node(node.orelse, env)

        if isinstance(node, ast.Call):
            if not isinstance(node.func, ast.Name):
                raise ExpressionSecurityError("Dynamic function invocation is prohibited")
            func_name = node.func.id
            fn = PURE_FUNCTIONS.get(func_name)
            if fn is None:
                raise ExpressionSecurityError(f"Function '{func_name}' is not permitted")
            args = [self._eval_node(arg, env) for arg in node.args]
            return fn(*args)

        raise ExpressionSecurityError(f"Unsupported AST node evaluation: {type(node).__name__}")

    def _eval_binop(self, node: ast.BinOp, env: dict[str, Any]) -> Any:
        """Evaluate binary operations with explicit operator guards."""
        left = self._eval_node(node.left, env)
        right = self._eval_node(node.right, env)

        # Null propagation
        if left is None or right is None:
            return None

        # Prohibit string multiplication ('A' * 1000)
        if isinstance(node.op, ast.Mult):
            if isinstance(left, str) or isinstance(right, str):
                raise ExpressionSecurityError(
                    "String multiplication is strictly prohibited to prevent memory exhaustion",
                    code="STRING_MULTIPLICATION_BLOCKED",
                )
            if not isinstance(left, (int, float)) or not isinstance(right, (int, float)):
                raise DomainValidationError("Multiplication requires numeric operands")
            product = left * right
            if math.isinf(product) or abs(product) > 1e100:
                raise DomainValidationError(
                    "Numeric multiplication exceeded maximum supported magnitude"
                )
            return product

        if isinstance(node.op, ast.Add):
            if isinstance(left, str) and isinstance(right, str):
                res_str = left + right
                if len(res_str) > MAX_RESULT_STRING_LENGTH:
                    raise DomainValidationError(
                        f"Concatenated string exceeds {MAX_RESULT_STRING_LENGTH} chars"
                    )
                return res_str
            if isinstance(left, (int, float)) and isinstance(right, (int, float)):
                return left + right
            raise DomainValidationError(
                f"Cannot add mismatched types {type(left).__name__} and {type(right).__name__}"
            )

        if isinstance(node.op, ast.Sub):
            if isinstance(left, (int, float)) and isinstance(right, (int, float)):
                return left - right
            raise DomainValidationError("Subtraction requires numeric operands")

        if isinstance(node.op, ast.Div):
            if not isinstance(left, (int, float)) or not isinstance(right, (int, float)):
                raise DomainValidationError("Division requires numeric operands")
            if right == 0:
                raise DomainValidationError(
                    "Division by zero in expression evaluation",
                    code="DIVISION_BY_ZERO",
                )
            return left / right

        if isinstance(node.op, ast.Mod):
            if not isinstance(left, (int, float)) or not isinstance(right, (int, float)):
                raise DomainValidationError("Modulo requires numeric operands")
            if right == 0:
                raise DomainValidationError(
                    "Modulo by zero in expression evaluation",
                    code="DIVISION_BY_ZERO",
                )
            return left % right

        raise ExpressionSecurityError(f"Unsupported binary operator: {type(node.op).__name__}")

    def _eval_comparison(self, op: ast.cmpop, left: Any, right: Any) -> bool:
        """Evaluate comparison operation between two values."""
        if isinstance(op, ast.Eq):
            return bool(left == right)
        if isinstance(op, ast.NotEq):
            return bool(left != right)

        # Inequalities with None return False
        if left is None or right is None:
            return False

        if isinstance(op, ast.Lt):
            return bool(left < right)
        if isinstance(op, ast.LtE):
            return bool(left <= right)
        if isinstance(op, ast.Gt):
            return bool(left > right)
        if isinstance(op, ast.GtE):
            return bool(left >= right)

        raise ExpressionSecurityError(f"Unsupported comparison operator: {type(op).__name__}")
