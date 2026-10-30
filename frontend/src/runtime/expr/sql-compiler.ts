/**
 * Data Rewind Safe DuckDB SQL Expression Compiler.
 * Translates validated restricted AST nodes into syntactically valid DuckDB SQL expressions.
 * Quotes identifiers strictly, escapes literals safely, and maps scalar functions.
 */

import { ERROR_CODES, RuntimeError } from "../contracts/errors";
import { ASTNode } from "./ast";

export class SqlExpressionCompiler {
  static compile(node: ASTNode): string {
    return SqlExpressionCompiler.compileNode(node);
  }

  private static compileNode(node: ASTNode): string {
    switch (node.type) {
      case "Literal": {
        if (node.value === null) return "NULL";
        if (typeof node.value === "boolean") return node.value ? "TRUE" : "FALSE";
        if (typeof node.value === "number") return String(node.value);
        if (typeof node.value === "string") {
          // Escape single quotes for SQL: ' -> ''
          const escaped = node.value.replace(/'/g, "''");
          return `'${escaped}'`;
        }
        return "NULL";
      }

      case "Identifier": {
        // Strictly quote column identifier
        const escaped = node.name.replace(/"/g, '""');
        return `"${escaped}"`;
      }

      case "UnaryOp": {
        const arg = SqlExpressionCompiler.compileNode(node.argument);
        if (node.operator === "not") {
          return `(NOT (${arg}))`;
        }
        return `(${node.operator}(${arg}))`;
      }

      case "BinaryOp": {
        const left = SqlExpressionCompiler.compileNode(node.left);
        const right = SqlExpressionCompiler.compileNode(node.right);

        let sqlOp: string;
        switch (node.operator) {
          case "==":
            sqlOp = "=";
            break;
          case "!=":
            sqlOp = "!=";
            break;
          case "and":
            sqlOp = "AND";
            break;
          case "or":
            sqlOp = "OR";
            break;
          default:
            sqlOp = node.operator;
        }

        return `(${left} ${sqlOp} ${right})`;
      }

      case "Call": {
        const argsCompiled = node.args.map((a) => SqlExpressionCompiler.compileNode(a));

        switch (node.callee) {
          case "abs":
            return `ABS(${argsCompiled[0]})`;
          case "round":
            return argsCompiled.length > 1
              ? `ROUND(${argsCompiled[0]}, ${argsCompiled[1]})`
              : `ROUND(${argsCompiled[0]})`;
          case "upper":
            return `UPPER(${argsCompiled[0]})`;
          case "lower":
            return `LOWER(${argsCompiled[0]})`;
          case "trim":
            return `TRIM(${argsCompiled[0]})`;
          case "len":
            return `LENGTH(${argsCompiled[0]})`;
          case "coalesce":
            return `COALESCE(${argsCompiled.join(", ")})`;
          case "if_else":
            return `(CASE WHEN ${argsCompiled[0]} THEN ${argsCompiled[1]} ELSE ${argsCompiled[2]} END)`;
          case "date_diff":
            return `DATE_DIFF(${argsCompiled.join(", ")})`;
          default:
            throw new RuntimeError(
              ERROR_CODES.UNKNOWN_FUNCTION,
              `Unsupported function in SQL compiler: '${node.callee}'`
            );
        }
      }

      default:
        throw new RuntimeError(
          ERROR_CODES.EXPRESSION_SECURITY_ERROR,
          `Unknown AST node type: ${(node as any).type}`
        );
    }
  }
}
