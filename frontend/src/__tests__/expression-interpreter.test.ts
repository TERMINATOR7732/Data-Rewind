import { describe, it, expect } from "vitest";
import {
  ExpressionParser,
  ExpressionEvaluator,
  SqlExpressionCompiler,
} from "../runtime/expr";
import { ERROR_CODES } from "../runtime/contracts/errors";

describe("Restricted Expression Interpreter — Tokenizer & Parser", () => {
  it("parses arithmetic expressions with correct precedence", () => {
    const ast = ExpressionParser.parse("1 + 2 * 3");
    expect(ast.type).toBe("BinaryOp");
    const bin = ast as any;
    expect(bin.operator).toBe("+");
    expect(bin.left.value).toBe(1);
    expect(bin.right.operator).toBe("*");
  });

  it("parses grouped expressions override precedence", () => {
    const ast = ExpressionParser.parse("(1 + 2) * 3");
    const bin = ast as any;
    expect(bin.operator).toBe("*");
    expect(bin.left.operator).toBe("+");
    expect(bin.right.value).toBe(3);
  });

  it("parses boolean comparisons and logical operators", () => {
    const ast = ExpressionParser.parse("amount > 100 and status == 'COMPLETED'");
    const bin = ast as any;
    expect(bin.operator).toBe("and");
    expect(bin.left.operator).toBe(">");
    expect(bin.right.operator).toBe("==");
  });

  it("parses whitelisted pure functions", () => {
    const ast = ExpressionParser.parse("round(abs(amount - 5.5), 2)");
    expect(ast.type).toBe("Call");
    const call = ast as any;
    expect(call.callee).toBe("round");
    expect(call.args).toHaveLength(2);
    expect(call.args[0].callee).toBe("abs");
  });

  it("rejects unwhitelisted functions", () => {
    expect(() => ExpressionParser.parse("eval('1+1')")).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.UNKNOWN_FUNCTION })
    );

    expect(() => ExpressionParser.parse("system('ls')")).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.UNKNOWN_FUNCTION })
    );
  });

  it("strictly rejects dunder, prototype, and constructor identifiers", () => {
    expect(() => ExpressionParser.parse("__class__")).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.EXPRESSION_SECURITY_ERROR })
    );

    expect(() => ExpressionParser.parse("__proto__")).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.EXPRESSION_SECURITY_ERROR })
    );

    expect(() => ExpressionParser.parse("constructor")).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.EXPRESSION_SECURITY_ERROR })
    );

    expect(() => ExpressionParser.parse("prototype")).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.EXPRESSION_SECURITY_ERROR })
    );
  });

  it("rejects expressions exceeding 1,000 characters", () => {
    const hugeExpr = "1 + " + "1 + ".repeat(300) + "1";
    expect(() => ExpressionParser.parse(hugeExpr)).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.EXPRESSION_COMPLEXITY_ERROR })
    );
  });

  it("rejects expressions exceeding AST depth limit of 10", () => {
    const deeplyNested = "(((((((((((42)))))))))))";
    expect(() => ExpressionParser.parse(deeplyNested)).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.EXPRESSION_COMPLEXITY_ERROR })
    );
  });

  it("rejects expressions exceeding AST node count limit of 50", () => {
    // 30 additions creates > 60 nodes
    const manyNodes = Array.from({ length: 30 }, (_, i) => `${i}`).join(" + ");
    expect(() => ExpressionParser.parse(manyNodes)).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.EXPRESSION_COMPLEXITY_ERROR })
    );
  });

  it("rejects syntax errors and unexpected characters", () => {
    expect(() => ExpressionParser.parse("amount + ;")).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.EXPRESSION_SECURITY_ERROR })
    );

    expect(() => ExpressionParser.parse("amount + ")).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.EXPRESSION_SYNTAX_ERROR })
    );
  });
});

describe("Restricted Expression Interpreter — Evaluator & Financial Arithmetic", () => {
  it("evaluates net revenue formula with deterministic financial rounding", () => {
    const formula =
      "round(quantity * unit_price * (1 - discount_pct / 100) + shipping_fee - refund_amount, 2)";
    const ast = ExpressionParser.parse(formula);

    const row = {
      quantity: 3,
      unit_price: 19.99,
      discount_pct: 15.0,
      shipping_fee: 5.0,
      refund_amount: 0.0,
    };

    // 3 * 19.99 * 0.85 = 50.9745; 50.9745 + 5 - 0 = 55.9745 -> rounded = 55.97
    const result = ExpressionEvaluator.evaluate(ast, row);
    expect(result).toBe(55.97);
  });

  it("evaluates boolean filter predicates", () => {
    const ast = ExpressionParser.parse("amount > 100 and status == 'COMPLETED'");

    expect(
      ExpressionEvaluator.evaluate(ast, { amount: 150, status: "COMPLETED" })
    ).toBe(true);
    expect(
      ExpressionEvaluator.evaluate(ast, { amount: 50, status: "COMPLETED" })
    ).toBe(false);
    expect(
      ExpressionEvaluator.evaluate(ast, { amount: 150, status: "PENDING" })
    ).toBe(false);
  });

  it("handles null propagation cleanly", () => {
    const ast = ExpressionParser.parse("amount + fee");

    expect(ExpressionEvaluator.evaluate(ast, { amount: 100, fee: null })).toBe(null);
    expect(ExpressionEvaluator.evaluate(ast, { amount: null, fee: 20 })).toBe(null);
    expect(ExpressionEvaluator.evaluate(ast, { amount: 100, fee: 20 })).toBe(120);
  });

  it("evaluates whitelisted pure functions accurately", () => {
    expect(
      ExpressionEvaluator.evaluate(ExpressionParser.parse("abs(-50)"), {})
    ).toBe(50);

    expect(
      ExpressionEvaluator.evaluate(ExpressionParser.parse("upper('alpha')"), {})
    ).toBe("ALPHA");

    expect(
      ExpressionEvaluator.evaluate(ExpressionParser.parse("lower('BETA')"), {})
    ).toBe("beta");

    expect(
      ExpressionEvaluator.evaluate(ExpressionParser.parse("trim('  spaced  ')"), {})
    ).toBe("spaced");

    expect(
      ExpressionEvaluator.evaluate(ExpressionParser.parse("len('abcdef')"), {})
    ).toBe(6);

    expect(
      ExpressionEvaluator.evaluate(
        ExpressionParser.parse("coalesce(discount, promo, 0)"),
        { discount: null, promo: 15 }
      )
    ).toBe(15);

    expect(
      ExpressionEvaluator.evaluate(
        ExpressionParser.parse("if_else(qty > 5, 'BULK', 'STANDARD')"),
        { qty: 10 }
      )
    ).toBe("BULK");

    expect(
      ExpressionEvaluator.evaluate(
        ExpressionParser.parse("date_diff('day', '2026-10-01', '2026-10-15')"),
        {}
      )
    ).toBe(14);
  });

  it("throws DIVISION_BY_ZERO error upon dividing by zero", () => {
    const ast = ExpressionParser.parse("100 / divisor");
    expect(() => ExpressionEvaluator.evaluate(ast, { divisor: 0 })).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.DIVISION_BY_ZERO })
    );
  });

  it("throws UNKNOWN_COLUMN when referenced column does not exist", () => {
    const ast = ExpressionParser.parse("missing_col + 1");
    expect(() => ExpressionEvaluator.evaluate(ast, { valid_col: 10 })).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.UNKNOWN_COLUMN })
    );
  });
});

describe("Restricted Expression Interpreter — DuckDB SQL Compiler", () => {
  it("compiles expression to safe quoted DuckDB SQL", () => {
    const ast = ExpressionParser.parse("amount > 100 and status == 'COMPLETED'");
    const sql = SqlExpressionCompiler.compile(ast);
    expect(sql).toBe('(("amount" > 100) AND ("status" = \'COMPLETED\'))');
  });

  it("compiles nested functions and financial formula to DuckDB SQL", () => {
    const formula =
      "round(quantity * unit_price * (1 - discount_pct / 100) + shipping_fee - refund_amount, 2)";
    const ast = ExpressionParser.parse(formula);
    const sql = SqlExpressionCompiler.compile(ast);

    expect(sql).toContain('ROUND(');
    expect(sql).toContain('"quantity"');
    expect(sql).toContain('"unit_price"');
    expect(sql).toContain('"discount_pct"');
    expect(sql).toContain(', 2)');
  });

  it("compiles if_else to CASE WHEN SQL expression", () => {
    const ast = ExpressionParser.parse("if_else(score >= 80, 'PASS', 'FAIL')");
    const sql = SqlExpressionCompiler.compile(ast);
    expect(sql).toBe("(CASE WHEN (\"score\" >= 80) THEN 'PASS' ELSE 'FAIL' END)");
  });

  it("compiles coalesce and string functions to SQL equivalents", () => {
    const ast = ExpressionParser.parse("coalesce(upper(trim(code)), 'NONE')");
    const sql = SqlExpressionCompiler.compile(ast);
    expect(sql).toBe("COALESCE(UPPER(TRIM(\"code\")), 'NONE')");
  });
});
