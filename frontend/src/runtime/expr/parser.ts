/**
 * Data Rewind Sandboxed Expression Parser.
 * Enforces operator precedence, whitelist of pure functions, and complexity bounds.
 * Depth <= 10, Nodes <= 50, zero dynamic execution.
 */

import { ERROR_CODES, RuntimeError } from "../contracts/errors";
import {
  AST_CONSTRAINTS,
  ASTNode,
  BinaryOperator,
  CallNode,
  IdentifierNode,
  LiteralNode,
  UnaryOperator,
  WHITELISTED_FUNCTIONS,
} from "./ast";
import { Token, Tokenizer } from "./tokenizer";

export class ExpressionParser {
  private tokens: Token[];
  private current = 0;
  private nodeCount = 0;
  private currentDepth = 0;
  private maxDepth = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  static parse(expression: string): ASTNode {
    const tokenizer = new Tokenizer(expression);
    const tokens = tokenizer.tokenize();
    const parser = new ExpressionParser(tokens);
    const ast = parser.parseExpression();

    if (!parser.isAtEnd()) {
      const leftover = parser.peek();
      throw new RuntimeError(
        ERROR_CODES.EXPRESSION_SYNTAX_ERROR,
        `Unexpected token '${leftover.value}' at position ${leftover.position}.`,
        { position: leftover.position, token: leftover.value }
      );
    }

    return ast;
  }

  private parseExpression(): ASTNode {
    return this.parseLogicalOr();
  }

  // 1. Logical OR ('or')
  private parseLogicalOr(): ASTNode {
    let expr = this.parseLogicalAnd();

    while (this.matchKeyword("or")) {
      const right = this.parseLogicalAnd();
      expr = this.createBinaryNode("or", expr, right);
    }

    return expr;
  }

  // 2. Logical AND ('and')
  private parseLogicalAnd(): ASTNode {
    let expr = this.parseEquality();

    while (this.matchKeyword("and")) {
      const right = this.parseEquality();
      expr = this.createBinaryNode("and", expr, right);
    }

    return expr;
  }

  // 3. Equality ('==', '!=')
  private parseEquality(): ASTNode {
    let expr = this.parseComparison();

    while (this.matchOperator("==", "!=")) {
      const op = this.previous().value as BinaryOperator;
      const right = this.parseComparison();
      expr = this.createBinaryNode(op, expr, right);
    }

    return expr;
  }

  // 4. Relational Comparison ('<', '<=', '>', '>=')
  private parseComparison(): ASTNode {
    let expr = this.parseAdditive();

    while (this.matchOperator("<", "<=", ">", ">=")) {
      const op = this.previous().value as BinaryOperator;
      const right = this.parseAdditive();
      expr = this.createBinaryNode(op, expr, right);
    }

    return expr;
  }

  // 5. Additive ('+', '-')
  private parseAdditive(): ASTNode {
    let expr = this.parseMultiplicative();

    while (this.matchOperator("+", "-")) {
      const op = this.previous().value as BinaryOperator;
      const right = this.parseMultiplicative();
      expr = this.createBinaryNode(op, expr, right);
    }

    return expr;
  }

  // 6. Multiplicative ('*', '/', '%')
  private parseMultiplicative(): ASTNode {
    let expr = this.parseUnary();

    while (this.matchOperator("*", "/", "%")) {
      const op = this.previous().value as BinaryOperator;
      const right = this.parseUnary();
      expr = this.createBinaryNode(op, expr, right);
    }

    return expr;
  }

  // 7. Unary ('not', '+', '-')
  private parseUnary(): ASTNode {
    if (this.matchKeyword("not")) {
      const right = this.parseUnary();
      return this.createUnaryNode("not", right);
    }

    if (this.matchOperator("+", "-")) {
      const op = this.previous().value as UnaryOperator;
      const right = this.parseUnary();
      return this.createUnaryNode(op, right);
    }

    return this.parsePrimary();
  }

  // 8. Primary (literals, identifiers, function calls, grouping)
  private parsePrimary(): ASTNode {
    this.enterNode();
    try {
      // Grouping: ( expr )
      if (this.matchPunctuation("(")) {
        const expr = this.parseExpression();
        this.consumePunctuation(")", "Expect ')' after grouped expression.");
        return expr;
      }

      // Number literal
      if (this.peek().type === "NUMBER") {
        const token = this.advance();
        const numVal = token.value.includes(".")
          ? parseFloat(token.value)
          : parseInt(token.value, 10);
        return this.createLiteralNode(numVal, token.value);
      }

      // String literal
      if (this.peek().type === "STRING") {
        const token = this.advance();
        return this.createLiteralNode(token.value, `'${token.value}'`);
      }

      // Identifiers, keywords, functions
      if (this.peek().type === "IDENTIFIER") {
        const token = this.advance();
        const lower = token.value.toLowerCase();

        // Boolean literals
        if (lower === "true") {
          return this.createLiteralNode(true, "true");
        }
        if (lower === "false") {
          return this.createLiteralNode(false, "false");
        }

        // Null literals
        if (lower === "null" || token.value === "None") {
          return this.createLiteralNode(null, "null");
        }

        // Rejection of dunder / prototype attack identifiers
        if (
          token.value.startsWith("__") ||
          token.value === "constructor" ||
          token.value === "prototype"
        ) {
          throw new RuntimeError(
            ERROR_CODES.EXPRESSION_SECURITY_ERROR,
            `Dunder or prototype identifier '${token.value}' is strictly prohibited.`,
            { identifier: token.value }
          );
        }

        // Function call: callee(...)
        if (this.matchPunctuation("(")) {
          const callee = lower;
          if (!WHITELISTED_FUNCTIONS.has(callee)) {
            throw new RuntimeError(
              ERROR_CODES.UNKNOWN_FUNCTION,
              `Function '${token.value}' is not in the approved pure functions allowlist.`,
              {
                function: token.value,
                allowedFunctions: Array.from(WHITELISTED_FUNCTIONS).sort(),
              }
            );
          }

          const args: ASTNode[] = [];
          if (!this.checkPunctuation(")")) {
            do {
              args.push(this.parseExpression());
            } while (this.matchPunctuation(","));
          }
          this.consumePunctuation(")", `Expect ')' after arguments for '${token.value}'.`);

          const callNode: CallNode = {
            type: "Call",
            callee,
            args,
          };
          this.trackNode();
          return callNode;
        }

        // Standard column identifier
        const idNode: IdentifierNode = {
          type: "Identifier",
          name: token.value,
        };
        this.trackNode();
        return idNode;
      }

      throw new RuntimeError(
        ERROR_CODES.EXPRESSION_SYNTAX_ERROR,
        `Unexpected token '${this.peek().value}' at position ${this.peek().position}.`,
        { token: this.peek() }
      );
    } finally {
      this.exitNode();
    }
  }

  // --- Helpers & Guards ---

  private enterNode(): void {
    this.currentDepth++;
    if (this.currentDepth > this.maxDepth) {
      this.maxDepth = this.currentDepth;
    }
    if (this.currentDepth > AST_CONSTRAINTS.MAX_AST_DEPTH) {
      throw new RuntimeError(
        ERROR_CODES.EXPRESSION_COMPLEXITY_ERROR,
        `Expression AST depth (${this.currentDepth}) exceeds the maximum allowed limit of ${AST_CONSTRAINTS.MAX_AST_DEPTH}.`,
        { depth: this.currentDepth, maxDepth: AST_CONSTRAINTS.MAX_AST_DEPTH }
      );
    }
  }

  private exitNode(): void {
    this.currentDepth--;
  }

  private trackNode(): void {
    this.nodeCount++;
    if (this.nodeCount > AST_CONSTRAINTS.MAX_AST_NODES) {
      throw new RuntimeError(
        ERROR_CODES.EXPRESSION_COMPLEXITY_ERROR,
        `Expression AST node count (${this.nodeCount}) exceeds the maximum allowed limit of ${AST_CONSTRAINTS.MAX_AST_NODES}.`,
        { nodeCount: this.nodeCount, maxNodes: AST_CONSTRAINTS.MAX_AST_NODES }
      );
    }
  }

  private createBinaryNode(operator: BinaryOperator, left: ASTNode, right: ASTNode): ASTNode {
    this.trackNode();
    return {
      type: "BinaryOp",
      operator,
      left,
      right,
    };
  }

  private createUnaryNode(operator: UnaryOperator, argument: ASTNode): ASTNode {
    this.trackNode();
    return {
      type: "UnaryOp",
      operator,
      argument,
    };
  }

  private createLiteralNode(value: any, raw: string): LiteralNode {
    this.trackNode();
    return {
      type: "Literal",
      value,
      raw,
    };
  }

  private matchOperator(...ops: string[]): boolean {
    if (this.isAtEnd()) return false;
    const token = this.peek();
    if (token.type === "OPERATOR" && ops.includes(token.value)) {
      this.advance();
      return true;
    }
    return false;
  }

  private matchKeyword(...keywords: string[]): boolean {
    if (this.isAtEnd()) return false;
    const token = this.peek();
    if (token.type === "IDENTIFIER") {
      const lower = token.value.toLowerCase();
      if (keywords.includes(lower)) {
        this.advance();
        return true;
      }
    }
    return false;
  }

  private matchPunctuation(...chars: string[]): boolean {
    if (this.isAtEnd()) return false;
    const token = this.peek();
    if (token.type === "PUNCTUATION" && chars.includes(token.value)) {
      this.advance();
      return true;
    }
    return false;
  }

  private checkPunctuation(char: string): boolean {
    if (this.isAtEnd()) return false;
    const token = this.peek();
    return token.type === "PUNCTUATION" && token.value === char;
  }

  private consumePunctuation(char: string, errorMsg: string): Token {
    if (this.checkPunctuation(char)) {
      return this.advance();
    }
    throw new RuntimeError(
      ERROR_CODES.EXPRESSION_SYNTAX_ERROR,
      errorMsg,
      { expected: char, observed: this.peek().value, position: this.peek().position }
    );
  }

  private peek(): Token {
    return this.tokens[this.current] || { type: "EOF", value: "", position: -1 };
  }

  private previous(): Token {
    return this.tokens[this.current - 1];
  }

  private isAtEnd(): boolean {
    return this.peek().type === "EOF";
  }

  private advance(): Token {
    if (!this.isAtEnd()) this.current++;
    return this.previous();
  }
}
