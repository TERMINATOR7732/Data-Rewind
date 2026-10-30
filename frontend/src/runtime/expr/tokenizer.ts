/**
 * Data Rewind Restricted Expression Tokenizer.
 * Enforces maximum string length (1,000 characters) and safe token extraction.
 */

import { ERROR_CODES, RuntimeError } from "../contracts/errors";
import { AST_CONSTRAINTS } from "./ast";

export type TokenType =
  | "NUMBER"
  | "STRING"
  | "IDENTIFIER"
  | "OPERATOR"
  | "PUNCTUATION"
  | "EOF";

export interface Token {
  type: TokenType;
  value: string;
  position: number;
}

export class Tokenizer {
  private input: string;
  private cursor = 0;

  constructor(input: string) {
    if (input.length > AST_CONSTRAINTS.MAX_EXPRESSION_LENGTH) {
      throw new RuntimeError(
        ERROR_CODES.EXPRESSION_COMPLEXITY_ERROR,
        `Expression length (${input.length}) exceeds the maximum allowed limit of ${AST_CONSTRAINTS.MAX_EXPRESSION_LENGTH} characters.`,
        { length: input.length, maxLength: AST_CONSTRAINTS.MAX_EXPRESSION_LENGTH }
      );
    }
    this.input = input.trim();
    if (this.input.length === 0) {
      throw new RuntimeError(
        ERROR_CODES.EXPRESSION_SYNTAX_ERROR,
        "Expression cannot be empty or whitespace only."
      );
    }
  }

  tokenize(): Token[] {
    const tokens: Token[] = [];

    while (this.cursor < this.input.length) {
      const char = this.input[this.cursor];

      // Whitespace
      if (/\s/.test(char)) {
        this.cursor++;
        continue;
      }

      // Numbers (integers or floating point)
      if (/[0-9]/.test(char) || (char === "." && /[0-9]/.test(this.peek(1)))) {
        tokens.push(this.readNumber());
        continue;
      }

      // String literals (single or double quotes)
      if (char === "'" || char === '"') {
        tokens.push(this.readString(char));
        continue;
      }

      // Multi-character operators
      if (
        this.match("==") ||
        this.match("!=") ||
        this.match("<=") ||
        this.match(">=")
      ) {
        tokens.push({
          type: "OPERATOR",
          value: this.input.slice(this.cursor - 2, this.cursor),
          position: this.cursor - 2,
        });
        continue;
      }

      // Single-character comparison & arithmetic operators
      if ("+-*/%<>".includes(char)) {
        tokens.push({
          type: "OPERATOR",
          value: char,
          position: this.cursor++,
        });
        continue;
      }

      // Single `=` in filter predicate can mean `==`
      if (char === "=") {
        this.cursor++;
        tokens.push({
          type: "OPERATOR",
          value: "==",
          position: this.cursor - 1,
        });
        continue;
      }

      // Punctuation: parentheses, comma
      if ("(),".includes(char)) {
        tokens.push({
          type: "PUNCTUATION",
          value: char,
          position: this.cursor++,
        });
        continue;
      }

      // Identifiers & Keywords
      if (/[a-zA-Z_]/.test(char)) {
        tokens.push(this.readIdentifier());
        continue;
      }

      // Forbidden characters
      throw new RuntimeError(
        ERROR_CODES.EXPRESSION_SECURITY_ERROR,
        `Unexpected or disallowed character '${char}' at index ${this.cursor}.`,
        { char, position: this.cursor }
      );
    }

    tokens.push({
      type: "EOF",
      value: "",
      position: this.cursor,
    });

    return tokens;
  }

  private peek(offset = 0): string {
    return this.input[this.cursor + offset] || "";
  }

  private match(expected: string): boolean {
    if (this.input.startsWith(expected, this.cursor)) {
      this.cursor += expected.length;
      return true;
    }
    return false;
  }

  private readNumber(): Token {
    const start = this.cursor;
    let hasDot = false;

    while (this.cursor < this.input.length) {
      const c = this.input[this.cursor];
      if (/[0-9]/.test(c)) {
        this.cursor++;
      } else if (c === "." && !hasDot && /[0-9]/.test(this.peek(1))) {
        hasDot = true;
        this.cursor++;
      } else {
        break;
      }
    }

    return {
      type: "NUMBER",
      value: this.input.slice(start, this.cursor),
      position: start,
    };
  }

  private readString(quote: string): Token {
    const start = this.cursor;
    this.cursor++; // Skip opening quote
    let value = "";
    let closed = false;

    while (this.cursor < this.input.length) {
      const c = this.input[this.cursor];
      if (c === "\\") {
        this.cursor++;
        if (this.cursor < this.input.length) {
          const esc = this.input[this.cursor++];
          if (esc === "n") value += "\n";
          else if (esc === "t") value += "\t";
          else if (esc === "r") value += "\r";
          else value += esc;
        }
      } else if (c === quote) {
        this.cursor++;
        closed = true;
        break;
      } else {
        value += c;
        this.cursor++;
      }
    }

    if (!closed) {
      throw new RuntimeError(
        ERROR_CODES.EXPRESSION_SYNTAX_ERROR,
        `Unterminated string literal starting at position ${start}.`,
        { position: start }
      );
    }

    return {
      type: "STRING",
      value,
      position: start,
    };
  }

  private readIdentifier(): Token {
    const start = this.cursor;
    while (this.cursor < this.input.length && /[a-zA-Z0-9_]/.test(this.input[this.cursor])) {
      this.cursor++;
    }

    const value = this.input.slice(start, this.cursor);
    return {
      type: "IDENTIFIER",
      value,
      position: start,
    };
  }
}
