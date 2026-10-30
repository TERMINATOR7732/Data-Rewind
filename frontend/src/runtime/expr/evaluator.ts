/**
 * Data Rewind In-Memory Sandboxed Expression Evaluator.
 * Evaluates restricted ASTs across individual rows with strict type and null semantics.
 * Implements deterministic financial arithmetic and whitelisted functions.
 */

import { ERROR_CODES, RuntimeError } from "../contracts/errors";
import { ASTNode, BinaryOperator, UnaryOperator } from "./ast";

export class ExpressionEvaluator {
  /**
   * Evaluates an AST against a single row record.
   */
  static evaluate(ast: ASTNode, row: Record<string, unknown>): unknown {
    return ExpressionEvaluator.evalNode(ast, row);
  }

  private static evalNode(node: ASTNode, row: Record<string, unknown>): unknown {
    switch (node.type) {
      case "Literal":
        return node.value;

      case "Identifier": {
        const col = node.name;
        if (!(col in row)) {
          throw new RuntimeError(
            ERROR_CODES.UNKNOWN_COLUMN,
            `Column '${col}' was not found in dataset.`,
            { column: col, availableColumns: Object.keys(row) }
          );
        }
        return row[col] === undefined ? null : row[col];
      }

      case "UnaryOp":
        return ExpressionEvaluator.evalUnary(node.operator, node.argument, row);

      case "BinaryOp":
        return ExpressionEvaluator.evalBinary(node.operator, node.left, node.right, row);

      case "Call":
        return ExpressionEvaluator.evalCall(node.callee, node.args, row);

      default:
        throw new RuntimeError(
          ERROR_CODES.EXPRESSION_SECURITY_ERROR,
          `Unsupported AST node type: ${(node as any).type}`
        );
    }
  }

  private static evalUnary(
    op: UnaryOperator,
    argNode: ASTNode,
    row: Record<string, unknown>
  ): unknown {
    const val = ExpressionEvaluator.evalNode(argNode, row);
    if (val === null) return null;

    if (op === "+") {
      const n = Number(val);
      if (isNaN(n)) return null;
      return n;
    }

    if (op === "-") {
      const n = Number(val);
      if (isNaN(n)) return null;
      return -n;
    }

    if (op === "not") {
      return !ExpressionEvaluator.isTruthy(val);
    }

    throw new RuntimeError(ERROR_CODES.EXPRESSION_SECURITY_ERROR, `Unknown unary operator: ${op}`);
  }

  private static evalBinary(
    op: BinaryOperator,
    leftNode: ASTNode,
    rightNode: ASTNode,
    row: Record<string, unknown>
  ): unknown {
    // Short-circuit logical operators
    if (op === "and") {
      const leftVal = ExpressionEvaluator.evalNode(leftNode, row);
      if (!ExpressionEvaluator.isTruthy(leftVal)) return false;
      const rightVal = ExpressionEvaluator.evalNode(rightNode, row);
      return ExpressionEvaluator.isTruthy(rightVal);
    }

    if (op === "or") {
      const leftVal = ExpressionEvaluator.evalNode(leftNode, row);
      if (ExpressionEvaluator.isTruthy(leftVal)) return true;
      const rightVal = ExpressionEvaluator.evalNode(rightNode, row);
      return ExpressionEvaluator.isTruthy(rightVal);
    }

    const left = ExpressionEvaluator.evalNode(leftNode, row);
    const right = ExpressionEvaluator.evalNode(rightNode, row);

    // Null propagation in arithmetic and standard comparisons
    if (left === null || right === null) {
      if (op === "==") return left === right;
      if (op === "!=") return left !== right;
      return null;
    }

    switch (op) {
      case "+":
        if (typeof left === "string" || typeof right === "string") {
          return String(left) + String(right);
        }
        return Number(left) + Number(right);

      case "-":
        return Number(left) - Number(right);

      case "*":
        return Number(left) * Number(right);

      case "/": {
        const divisor = Number(right);
        if (divisor === 0) {
          throw new RuntimeError(
            ERROR_CODES.DIVISION_BY_ZERO,
            "Division by zero detected in expression."
          );
        }
        return Number(left) / divisor;
      }

      case "%": {
        const divisor = Number(right);
        if (divisor === 0) {
          throw new RuntimeError(
            ERROR_CODES.DIVISION_BY_ZERO,
            "Modulo by zero detected in expression."
          );
        }
        return Number(left) % divisor;
      }

      case "==":
        return left === right;

      case "!=":
        return left !== right;

      case "<":
        return (left as any) < (right as any);

      case "<=":
        return (left as any) <= (right as any);

      case ">":
        return (left as any) > (right as any);

      case ">=":
        return (left as any) >= (right as any);

      default:
        throw new RuntimeError(
          ERROR_CODES.EXPRESSION_SECURITY_ERROR,
          `Unknown binary operator: ${op}`
        );
    }
  }

  private static evalCall(
    callee: string,
    args: ASTNode[],
    row: Record<string, unknown>
  ): unknown {
    const evaluatedArgs = args.map((a) => ExpressionEvaluator.evalNode(a, row));

    switch (callee) {
      case "abs": {
        const v = evaluatedArgs[0];
        if (v === null) return null;
        return Math.abs(Number(v));
      }

      case "round": {
        const val = evaluatedArgs[0];
        if (val === null) return null;
        const decimals = evaluatedArgs[1] !== undefined && evaluatedArgs[1] !== null ? Number(evaluatedArgs[1]) : 0;
        return ExpressionEvaluator.roundHalfUp(Number(val), decimals);
      }

      case "upper": {
        const v = evaluatedArgs[0];
        if (v === null) return null;
        return String(v).toUpperCase();
      }

      case "lower": {
        const v = evaluatedArgs[0];
        if (v === null) return null;
        return String(v).toLowerCase();
      }

      case "trim": {
        const v = evaluatedArgs[0];
        if (v === null) return null;
        return String(v).trim();
      }

      case "len": {
        const v = evaluatedArgs[0];
        if (v === null) return null;
        return String(v).length;
      }

      case "coalesce": {
        for (const arg of evaluatedArgs) {
          if (arg !== null && arg !== undefined) {
            return arg;
          }
        }
        return null;
      }

      case "if_else": {
        const condition = evaluatedArgs[0];
        return ExpressionEvaluator.isTruthy(condition) ? evaluatedArgs[1] : evaluatedArgs[2];
      }

      case "date_diff": {
        // date_diff('day', start_date, end_date)
        const unit = String(evaluatedArgs[0] || "day").toLowerCase();
        const d1 = new Date(String(evaluatedArgs[1]));
        const d2 = new Date(String(evaluatedArgs[2]));
        if (isNaN(d1.getTime()) || isNaN(d2.getTime())) return null;

        const diffMs = d2.getTime() - d1.getTime();
        if (unit === "day" || unit === "days") {
          return Math.floor(diffMs / (1000 * 60 * 60 * 24));
        }
        if (unit === "month" || unit === "months") {
          return (d2.getFullYear() - d1.getFullYear()) * 12 + (d2.getMonth() - d1.getMonth());
        }
        if (unit === "year" || unit === "years") {
          return d2.getFullYear() - d1.getFullYear();
        }
        return Math.floor(diffMs / 1000);
      }

      default:
        throw new RuntimeError(
          ERROR_CODES.UNKNOWN_FUNCTION,
          `Function '${callee}' is not implemented.`
        );
    }
  }

  /**
   * Deterministic round half up to decimal places.
   * Prevents floating-point artifacts (e.g. 1.005 rounding to 1.00 in standard JS).
   */
  static roundHalfUp(num: number, decimals: number): number {
    if (isNaN(num) || !isFinite(num)) return num;
    const factor = Math.pow(10, decimals);
    return Math.round((num + Number.EPSILON) * factor) / factor;
  }

  private static isTruthy(val: unknown): boolean {
    if (val === null || val === undefined) return false;
    if (typeof val === "boolean") return val;
    if (typeof val === "number") return val !== 0 && !isNaN(val);
    if (typeof val === "string") return val.length > 0 && val !== "0" && val.toLowerCase() !== "false";
    return Boolean(val);
  }
}
