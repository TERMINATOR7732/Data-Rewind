/**
 * Data Rewind Restricted Expression Engine Module.
 */

import { ASTNode } from "./ast";
import { ExpressionParser } from "./parser";
import { SqlExpressionCompiler } from "./sql-compiler";

export * from "./ast";
export * from "./tokenizer";
export * from "./parser";
export * from "./evaluator";
export * from "./sql-compiler";

export function parseExpression(expression: string): ASTNode {
  return ExpressionParser.parse(expression);
}

export function compileExpressionToSql(expression: string | ASTNode): string {
  const ast = typeof expression === "string" ? parseExpression(expression) : expression;
  return SqlExpressionCompiler.compile(ast);
}
