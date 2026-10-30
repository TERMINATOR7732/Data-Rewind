import { describe, it, expect } from "vitest";
import { executeTransformation, QueryExecutor } from "../runtime/pipeline/transformations/index";
import { DatasetSchema, EXECUTION_CONTRACT_VERSION } from "../runtime/contracts/index";

function createMockExecutor(schemaCols: string[] = ["id", "amount", "status", "category"]): {
  executor: QueryExecutor;
  queries: string[];
} {
  const queries: string[] = [];
  const schema: DatasetSchema = {
    version: EXECUTION_CONTRACT_VERSION,
    columns: schemaCols.map((c, i) => ({
      name: c,
      dataType: c === "id" ? "INTEGER" : c === "amount" ? "FLOAT" : "STRING",
      nullable: true,
      ordinalPosition: i + 1,
    })),
    primaryKeys: [],
  };

  const executor: QueryExecutor = {
    async query<T = Record<string, unknown>>(sql: string) {
      queries.push(sql.trim());
      if (sql.includes("AVG(")) {
        return { columns: ["avg_val"], columnTypes: ["DOUBLE"], rows: [{ avg_val: 42.5 }] as unknown as T[], rowCount: 1, durationMs: 1 };
      }
      if (sql.includes("violations")) {
        // Return 5 violations if testing failure, else 0
        const isViolationTest = sql.includes("WHERE \"amount\" < 0") || sql.includes("WHERE \"id\" IS NULL");
        return {
          columns: ["violations"],
          columnTypes: ["BIGINT"],
          rows: [{ violations: isViolationTest ? 5 : 0 }] as unknown as T[],
          rowCount: 1,
          durationMs: 1,
        };
      }
      return { columns: [], columnTypes: [], rows: [] as T[], rowCount: 10, durationMs: 1 };
    },
    async getSchema() {
      return schema;
    },
    async getRowCount() {
      return 100;
    },
  };

  return { executor, queries };
}

describe("12 Canonical Atomic Transformations", () => {
  it("1. select_columns: generates valid SELECT projection and checks column existence", async () => {
    const { executor, queries } = createMockExecutor(["id", "amount"]);
    const res = await executeTransformation({
      node: {
        nodeId: "step_sel",
        operationType: "select_columns",
        parameters: { columns: ["id", "amount"] },
        inputNodeIds: [],
      },
      inputTables: ["table_in"],
      outputTable: "table_out",
      executor,
    });

    expect(res.outputTable).toBe("table_out");
    expect(queries[0]).toContain('SELECT "id", "amount" FROM "table_in"');
  });

  it("1. select_columns: throws on missing column", async () => {
    const { executor } = createMockExecutor(["id"]);
    await expect(
      executeTransformation({
        node: {
          nodeId: "step_sel",
          operationType: "select_columns",
          parameters: { columns: ["nonexistent_col"] },
          inputNodeIds: [],
        },
        inputTables: ["table_in"],
        outputTable: "table_out",
        executor,
      })
    ).rejects.toThrow();
  });

  it("2. rename_columns: renames specific columns and preserves remaining columns", async () => {
    const { executor, queries } = createMockExecutor(["id", "amount"]);
    await executeTransformation({
      node: {
        nodeId: "step_rename",
        operationType: "rename_columns",
        parameters: { mapping: { amount: "total_revenue" } },
        inputNodeIds: [],
      },
      inputTables: ["table_in"],
      outputTable: "table_out",
      executor,
    });

    expect(queries[0]).toContain('"id"');
    expect(queries[0]).toContain('"amount" AS "total_revenue"');
  });

  it("3. drop_columns: excludes specified columns using EXCLUDE", async () => {
    const { executor, queries } = createMockExecutor(["id", "status"]);
    await executeTransformation({
      node: {
        nodeId: "step_drop",
        operationType: "drop_columns",
        parameters: { columns: ["status"] },
        inputNodeIds: [],
      },
      inputTables: ["table_in"],
      outputTable: "table_out",
      executor,
    });

    expect(queries[0]).toContain('EXCLUDE ("status")');
  });

  it("4. filter_rows: compiles safe predicate to SQL", async () => {
    const { executor, queries } = createMockExecutor(["id", "amount"]);
    await executeTransformation({
      node: {
        nodeId: "step_filter",
        operationType: "filter_rows",
        parameters: { predicate: "amount > 100 and id == 1" },
        inputNodeIds: [],
      },
      inputTables: ["table_in"],
      outputTable: "table_out",
      executor,
    });

    expect(queries[0]).toContain('("amount" > 100)');
    expect(queries[0]).toContain('("id" = 1)');
  });

  it("5. deduplicate_rows: generates DISTINCT ON for subsets", async () => {
    const { executor, queries } = createMockExecutor(["id", "status"]);
    await executeTransformation({
      node: {
        nodeId: "step_dedup",
        operationType: "deduplicate_rows",
        parameters: { subset: ["id"], keep: "first" },
        inputNodeIds: [],
      },
      inputTables: ["table_in"],
      outputTable: "table_out",
      executor,
    });

    expect(queries[0]).toContain('SELECT DISTINCT ON ("id")');
  });

  it("6. handle_missing: handles fill_mean with pre-computed aggregate", async () => {
    const { executor, queries } = createMockExecutor(["id", "amount"]);
    await executeTransformation({
      node: {
        nodeId: "step_missing",
        operationType: "handle_missing",
        parameters: { columns: ["amount"], strategy: "fill_mean" },
        inputNodeIds: [],
      },
      inputTables: ["table_in"],
      outputTable: "table_out",
      executor,
    });

    expect(queries.some((q) => q.includes("AVG"))).toBe(true);
    expect(queries.some((q) => q.includes('COALESCE("amount", 42.5)'))).toBe(true);
  });

  it("7. cast_types: generates TRY_CAST with canonical DuckDB types", async () => {
    const { executor, queries } = createMockExecutor(["id", "amount"]);
    await executeTransformation({
      node: {
        nodeId: "step_cast",
        operationType: "cast_types",
        parameters: { casts: { amount: "DOUBLE", id: "BIGINT" } },
        inputNodeIds: [],
      },
      inputTables: ["table_in"],
      outputTable: "table_out",
      executor,
    });

    expect(queries[0]).toContain('TRY_CAST("amount" AS DOUBLE)');
    expect(queries[0]).toContain('TRY_CAST("id" AS BIGINT)');
  });

  it("8. join_datasets: disambiguates overlapping right columns and blocks Cartesian explosion", async () => {
    const { executor, queries } = createMockExecutor(["customer_id", "name"]);
    await executeTransformation({
      node: {
        nodeId: "step_join",
        operationType: "join_datasets",
        parameters: { join_type: "inner", left_on: ["customer_id"], right_on: ["customer_id"] },
        inputNodeIds: [],
      },
      inputTables: ["orders_tbl", "customers_tbl"],
      outputTable: "joined_out",
      executor,
    });

    expect(queries[0]).toContain('INNER JOIN "customers_tbl" AS t2');
    expect(queries[0]).toContain('t1."customer_id" = t2."customer_id"');
  });

  it("8. join_datasets: blocks cross joins exceeding safety limit", async () => {
    const { executor } = createMockExecutor(["id"]);
    // Mock row counts that multiply to > limit
    executor.getRowCount = async () => 5000;

    await expect(
      executeTransformation({
        node: {
          nodeId: "step_cross",
          operationType: "join_datasets",
          parameters: { join_type: "cross" },
          inputNodeIds: [],
        },
        inputTables: ["tbl1", "tbl2"],
        outputTable: "out_tbl",
        executor,
        maxCartesianProduct: 10_000, // 5000 * 5000 = 25,000,000 > 10,000
      })
    ).rejects.toThrow();
  });

  it("9. aggregate_group_by: builds aggregations with GROUP BY", async () => {
    const { executor, queries } = createMockExecutor(["category", "amount"]);
    await executeTransformation({
      node: {
        nodeId: "step_agg",
        operationType: "aggregate_group_by",
        parameters: {
          group_keys: ["category"],
          aggregations: [
            { column: "amount", func: "sum", alias: "total_sum" },
            { column: "*", func: "count", alias: "row_cnt" },
          ],
        },
        inputNodeIds: [],
      },
      inputTables: ["table_in"],
      outputTable: "table_out",
      executor,
    });

    expect(queries[0]).toContain('SUM("amount") AS "total_sum"');
    expect(queries[0]).toContain('COUNT(*) AS "row_cnt"');
    expect(queries[0]).toContain('GROUP BY "category"');
  });

  it("10. sort_rows: generates ORDER BY clause", async () => {
    const { executor, queries } = createMockExecutor(["id", "amount"]);
    await executeTransformation({
      node: {
        nodeId: "step_sort",
        operationType: "sort_rows",
        parameters: { by: [{ column: "amount", order: "desc" }] },
        inputNodeIds: [],
      },
      inputTables: ["table_in"],
      outputTable: "table_out",
      executor,
    });

    expect(queries[0]).toContain('ORDER BY "amount" DESC');
  });

  it("11. derive_column: calculates new column from restricted expression", async () => {
    const { executor, queries } = createMockExecutor(["amount"]);
    await executeTransformation({
      node: {
        nodeId: "step_derive",
        operationType: "derive_column",
        parameters: {
          target_column: "net_amount",
          expression: "round(amount * 0.82, 2)",
        },
        inputNodeIds: [],
      },
      inputTables: ["table_in"],
      outputTable: "table_out",
      executor,
    });

    expect(queries[0]).toContain('(ROUND(("amount" * 0.82), 2)) AS "net_amount"');
  });

  it("12. data_quality_rule: throws on failure when severity is fail", async () => {
    const { executor } = createMockExecutor(["amount"]);
    await expect(
      executeTransformation({
        node: {
          nodeId: "step_dq",
          operationType: "data_quality_rule",
          parameters: {
            column: "amount",
            rule_type: "in_range",
            params: { min: 0 },
            severity: "fail",
          },
          inputNodeIds: [],
        },
        inputTables: ["table_in"],
        outputTable: "table_out",
        executor,
      })
    ).rejects.toThrow();
  });

  it("12. data_quality_rule: returns warning and continues when severity is warn", async () => {
    const { executor } = createMockExecutor(["amount"]);
    const res = await executeTransformation({
      node: {
        nodeId: "step_dq_warn",
        operationType: "data_quality_rule",
        parameters: {
          column: "amount",
          rule_type: "in_range",
          params: { min: 0 },
          severity: "warn",
        },
        inputNodeIds: [],
      },
      inputTables: ["table_in"],
      outputTable: "table_out",
      executor,
    });

    expect(res.warnings).toBeDefined();
    expect(res.warnings?.[0]).toContain("Data quality check");
  });
});
