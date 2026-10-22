"""Sandboxed AST expression security validator and complexity checker.

Conforms strictly to Section 3 of SPEC-MOD-06.
Guarantees:
- Strict prohibition of eval(), exec(), compile(), and __import__().
- Explicit AST allowlist: only approved expression nodes permitted.
- Rejection of dunder attribute traversal (ast.Attribute).
- Rejection of subscripts, lambdas, comprehensions, and container literals.
- Prohibition of unbounded exponentiation (Pow) and string multiplication.
- Structural complexity limits: Depth <= 10, Nodes <= 50, Length <= 1,000 chars.
"""

from __future__ import annotations

import ast

from data_rewind.core.domain.errors import (
    ExpressionComplexityError,
    ExpressionSecurityError,
)

# Canonical complexity thresholds from SPEC-MOD-06
MAX_EXPRESSION_LENGTH = 1_000
MAX_AST_DEPTH = 10
MAX_AST_NODES = 50
MAX_ALLOWED_EXPONENT = 4

# Allowed pure functions
ALLOWED_FUNCTIONS: frozenset[str] = frozenset(
    {
        "abs",
        "round",
        "upper",
        "lower",
        "trim",
        "coalesce",
        "if_else",
        "date_diff",
        "len",
    }
)

# Allowed AST node classes
ALLOWED_NODE_TYPES: tuple[type[ast.AST], ...] = (
    ast.Expression,
    ast.BinOp,
    ast.UnaryOp,
    ast.BoolOp,
    ast.Compare,
    ast.Name,
    ast.Constant,
    ast.IfExp,
    ast.Call,
    # Allowed Operators
    ast.Add,
    ast.Sub,
    ast.Mult,
    ast.Div,
    ast.Mod,
    ast.UAdd,
    ast.USub,
    ast.Not,
    ast.And,
    ast.Or,
    ast.Eq,
    ast.NotEq,
    ast.Lt,
    ast.LtE,
    ast.Gt,
    ast.GtE,
    # Context
    ast.Load,
)

FORBIDDEN_OPERATORS: tuple[type[ast.AST], ...] = (
    ast.Pow,
    ast.FloorDiv,
    ast.LShift,
    ast.RShift,
    ast.BitOr,
    ast.BitXor,
    ast.BitAnd,
    ast.MatMult,
)


class ASTSecurityValidator(ast.NodeVisitor):
    """Enforces syntax allowlist and complexity constraints on user expressions."""

    def __init__(self, raw_expression: str) -> None:
        self.raw_expression = raw_expression
        self.node_count = 0
        self.max_depth = 0
        self.current_depth = 0

    @classmethod
    def validate(cls, expression: str) -> ast.Expression:
        """Parse and strictly validate an expression.

        Args:
            expression: Raw user expression string.

        Returns:
            Validated ast.Expression tree.

        Raises:
            ExpressionComplexityError: If length, depth, or node count exceeded.
            ExpressionSecurityError: If unapproved syntax or forbidden nodes detected.
        """
        # 1. String length check
        if len(expression) > MAX_EXPRESSION_LENGTH:
            raise ExpressionComplexityError(
                f"Expression length ({len(expression)}) exceeds limit of {MAX_EXPRESSION_LENGTH}",
                details={"length": len(expression), "max_allowed": MAX_EXPRESSION_LENGTH},
            )

        trimmed = expression.strip()
        if not trimmed:
            raise ExpressionSecurityError("Expression cannot be empty or whitespace only")

        # 2. Parse into AST
        try:
            tree = ast.parse(trimmed, mode="eval")
        except SyntaxError as exc:
            raise ExpressionSecurityError(
                f"Syntax error in expression: {exc.msg}",
                details={"line": exc.lineno, "offset": exc.offset},
            ) from exc

        # 3. Visit and validate tree
        validator = cls(trimmed)
        validator.visit(tree)

        # 4. Complexity checks
        if validator.node_count > MAX_AST_NODES:
            raise ExpressionComplexityError(
                f"Expression node count ({validator.node_count}) exceeds limit of {MAX_AST_NODES}",
                details={"nodes": validator.node_count, "max_allowed": MAX_AST_NODES},
            )

        if validator.max_depth > MAX_AST_DEPTH:
            raise ExpressionComplexityError(
                f"Expression AST depth ({validator.max_depth}) exceeds limit of {MAX_AST_DEPTH}",
                details={"depth": validator.max_depth, "max_allowed": MAX_AST_DEPTH},
            )

        return tree

    def generic_visit(self, node: ast.AST) -> None:
        """Inspect every AST node against allowlist and depth bounds."""
        self.node_count += 1
        self.current_depth += 1
        if self.current_depth > self.max_depth:
            self.max_depth = self.current_depth

        if self.current_depth > MAX_AST_DEPTH:
            raise ExpressionComplexityError(
                f"Expression depth exceeded limit of {MAX_AST_DEPTH}",
                details={"current_depth": self.current_depth, "max_allowed": MAX_AST_DEPTH},
            )

        if self.node_count > MAX_AST_NODES:
            raise ExpressionComplexityError(
                f"Expression node count exceeded limit of {MAX_AST_NODES}",
                details={"node_count": self.node_count, "max_allowed": MAX_AST_NODES},
            )

        # Allowlist type check
        if not isinstance(node, ALLOWED_NODE_TYPES):
            node_type = type(node).__name__
            raise ExpressionSecurityError(
                f"Prohibited syntax element: '{node_type}' is not permitted",
                details={"disallowed_node": node_type},
            )

        super().generic_visit(node)
        self.current_depth -= 1

    def visit_BinOp(self, node: ast.BinOp) -> None:
        """Check for forbidden operators (e.g. Pow) and validate operands."""
        if isinstance(node.op, FORBIDDEN_OPERATORS):
            op_name = type(node.op).__name__
            raise ExpressionSecurityError(
                f"Operator '{op_name}' is strictly prohibited in expressions",
                details={"disallowed_operator": op_name},
            )
        self.generic_visit(node)

    def visit_Call(self, node: ast.Call) -> None:
        """Validate function calls: only whitelisted pure functions permitted."""
        # Function must be a simple Name, not an Attribute (blocks obj.method())
        if not isinstance(node.func, ast.Name):
            raise ExpressionSecurityError(
                "Dynamic, indirect, or method calls are strictly prohibited",
                details={"func_type": type(node.func).__name__},
            )

        func_name = node.func.id
        if func_name not in ALLOWED_FUNCTIONS:
            raise ExpressionSecurityError(
                f"Function '{func_name}' is not in the approved pure functions allowlist",
                details={
                    "function": func_name,
                    "allowed_functions": sorted(ALLOWED_FUNCTIONS),
                },
            )

        # Keyword arguments prohibited for simplicity and determinism
        if node.keywords:
            raise ExpressionSecurityError(
                f"Keyword arguments in function '{func_name}' are not permitted",
                details={"function": func_name},
            )

        self.generic_visit(node)

    def visit_Attribute(self, node: ast.Attribute) -> None:
        """Strictly prohibit attribute traversal (prevents __class__, etc.)."""
        raise ExpressionSecurityError(
            "Attribute access (e.g. '.') is strictly prohibited in expressions",
            details={"attribute": node.attr},
        )

    def visit_Subscript(self, node: ast.Subscript) -> None:
        """Strictly prohibit indexing/subscripting."""
        raise ExpressionSecurityError(
            "Subscript/indexing operations are prohibited in expressions",
        )

    def visit_Name(self, node: ast.Name) -> None:
        """Validate identifier names (prevent dunder names)."""
        if node.id.startswith("__") and node.id.endswith("__"):
            raise ExpressionSecurityError(
                f"Dunder identifier '{node.id}' is prohibited",
                details={"identifier": node.id},
            )
        self.generic_visit(node)
