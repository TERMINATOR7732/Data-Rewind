/**
 * Data Rewind Restricted AST Node Definitions.
 * Conforms strictly to SPEC-MOD-06 §3 (Sandboxed AST Expression Engine & Runtime Bounds).
 */

export type ASTNodeType =
  | "Literal"
  | "Identifier"
  | "UnaryOp"
  | "BinaryOp"
  | "Call";

export interface BaseASTNode {
  type: ASTNodeType;
}

export type LiteralValue = string | number | boolean | null;

export interface LiteralNode extends BaseASTNode {
  type: "Literal";
  value: LiteralValue;
  raw: string;
}

export interface IdentifierNode extends BaseASTNode {
  type: "Identifier";
  name: string; // Column name
}

export type UnaryOperator = "+" | "-" | "not";

export interface UnaryOpNode extends BaseASTNode {
  type: "UnaryOp";
  operator: UnaryOperator;
  argument: ASTNode;
}

export type BinaryOperator =
  | "+"
  | "-"
  | "*"
  | "/"
  | "%"
  | "=="
  | "!="
  | "<"
  | "<="
  | ">"
  | ">="
  | "and"
  | "or";

export interface BinaryOpNode extends BaseASTNode {
  type: "BinaryOp";
  operator: BinaryOperator;
  left: ASTNode;
  right: ASTNode;
}

export interface CallNode extends BaseASTNode {
  type: "Call";
  callee: string; // Must be in WHITELISTED_FUNCTIONS
  args: ASTNode[];
}

export type ASTNode =
  | LiteralNode
  | IdentifierNode
  | UnaryOpNode
  | BinaryOpNode
  | CallNode;

export const WHITELISTED_FUNCTIONS = new Set([
  "abs",
  "round",
  "upper",
  "lower",
  "trim",
  "coalesce",
  "if_else",
  "date_diff",
  "len",
]);

export const AST_CONSTRAINTS = {
  MAX_EXPRESSION_LENGTH: 1_000,
  MAX_AST_DEPTH: 10,
  MAX_AST_NODES: 50,
  MAX_ALLOWED_EXPONENT: 4,
} as const;
