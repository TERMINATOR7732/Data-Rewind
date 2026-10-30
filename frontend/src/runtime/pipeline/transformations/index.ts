/**
 * Data Rewind 12 Canonical Atomic Transformations.
 * Conforms to SPEC-MOD-01 §5.2, SPEC-MOD-02 & SPEC-MOD-07.
 */

import { ERROR_CODES, RuntimeError } from "../../contracts/errors";
import { AggregationDefinition } from "../../contracts/index";
import { compileExpressionToSql } from "../../expr/index";
import { TransformationContext, TransformationResult } from "./types";

export * from "./types";

/**
 * Escapes a SQL identifier for DuckDB.
 */
function escapeIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Converts generic data types to DuckDB type keywords.
 */
function toDuckDbType(type: string): string {
  const upper = type.toUpperCase().trim();
  if (upper === "INT" || upper === "INTEGER" || upper === "BIGINT" || upper === "INT64") {
    return "BIGINT";
  }
  if (upper === "FLOAT" || upper === "DOUBLE" || upper === "FLOAT64" || upper === "NUMERIC" || upper.startsWith("DECIMAL")) {
    return "DOUBLE";
  }
  if (upper === "STRING" || upper === "VARCHAR" || upper === "TEXT") {
    return "VARCHAR";
  }
  if (upper === "BOOLEAN" || upper === "BOOL") {
    return "BOOLEAN";
  }
  if (upper === "DATE") {
    return "DATE";
  }
  if (upper === "TIMESTAMP") {
    return "TIMESTAMP";
  }
  return upper;
}

/**
 * Dispatches and executes an atomic transformation.
 */
export async function executeTransformation(
  context: TransformationContext
): Promise<TransformationResult> {
  const { node, inputTables, outputTable, executor } = context;
  const op = node.operationType;
  const p = node.parameters || {};

  // Verify single input unless join
  if (op !== "join_datasets" && inputTables.length === 0) {
    throw new RuntimeError(
      ERROR_CODES.INPUT_NOT_FOUND,
      `Step '${node.nodeId}' has no input table.`
    );
  }

  const primaryInput = inputTables[0];
  let warnings: string[] | undefined;

  switch (op) {
    // 1. SELECT COLUMNS
    case "select_columns": {
      const columns: string[] = p.columns;
      const schema = await executor.getSchema(primaryInput);
      const existingColNames = new Set(schema.columns.map((c) => c.name));

      for (const col of columns) {
        if (!existingColNames.has(col)) {
          throw new RuntimeError(
            ERROR_CODES.MISSING_COLUMN,
            `Column '${col}' does not exist in input dataset for step '${node.nodeId}'.`
          );
        }
      }

      const sql = `CREATE OR REPLACE TABLE ${escapeIdent(outputTable)} AS SELECT ${columns
        .map(escapeIdent)
        .join(", ")} FROM ${escapeIdent(primaryInput)};`;
      await executor.query(sql);
      break;
    }

    // 2. RENAME COLUMNS
    case "rename_columns": {
      const mapping: Record<string, string> = p.mapping;
      const schema = await executor.getSchema(primaryInput);
      const existingColNames = new Set(schema.columns.map((c) => c.name));

      for (const oldCol of Object.keys(mapping)) {
        if (!existingColNames.has(oldCol)) {
          throw new RuntimeError(
            ERROR_CODES.MISSING_COLUMN,
            `Source column '${oldCol}' to rename does not exist in step '${node.nodeId}'.`
          );
        }
      }

      const selectItems = schema.columns.map((col) => {
        if (mapping[col.name]) {
          return `${escapeIdent(col.name)} AS ${escapeIdent(mapping[col.name])}`;
        }
        return escapeIdent(col.name);
      });

      const sql = `CREATE OR REPLACE TABLE ${escapeIdent(outputTable)} AS SELECT ${selectItems.join(
        ", "
      )} FROM ${escapeIdent(primaryInput)};`;
      await executor.query(sql);
      break;
    }

    // 3. DROP COLUMNS
    case "drop_columns": {
      const columnsToDrop: string[] = p.columns;
      const sql = `CREATE OR REPLACE TABLE ${escapeIdent(outputTable)} AS SELECT * EXCLUDE (${columnsToDrop
        .map(escapeIdent)
        .join(", ")}) FROM ${escapeIdent(primaryInput)};`;
      await executor.query(sql);
      break;
    }

    // 4. FILTER ROWS
    case "filter_rows": {
      const predicate: string = p.predicate ?? p.condition;
      const compiledPredicate = compileExpressionToSql(predicate);
      const sql = `CREATE OR REPLACE TABLE ${escapeIdent(outputTable)} AS SELECT * FROM ${escapeIdent(
        primaryInput
      )} WHERE ${compiledPredicate};`;
      await executor.query(sql);
      break;
    }

    // 5. DEDUPLICATE ROWS
    case "deduplicate_rows": {
      const subset: string[] | undefined = p.subset ?? p.subset_columns;
      const keep: string = p.keep ?? "first";

      let sql = "";
      if (subset && subset.length > 0) {
        if (keep === "last") {
          // Keep last occurrence
          sql = `CREATE OR REPLACE TABLE ${escapeIdent(outputTable)} AS
            SELECT * FROM (
              SELECT *, ROW_NUMBER() OVER (PARTITION BY ${subset
                .map(escapeIdent)
                .join(", ")} ORDER BY 1 DESC) as _dedup_rn
              FROM ${escapeIdent(primaryInput)}
            ) WHERE _dedup_rn = 1;
            ALTER TABLE ${escapeIdent(outputTable)} DROP COLUMN _dedup_rn;`;
        } else {
          // Default: keep first
          sql = `CREATE OR REPLACE TABLE ${escapeIdent(outputTable)} AS
            SELECT DISTINCT ON (${subset.map(escapeIdent).join(", ")}) *
            FROM ${escapeIdent(primaryInput)};`;
        }
      } else {
        sql = `CREATE OR REPLACE TABLE ${escapeIdent(outputTable)} AS
          SELECT DISTINCT * FROM ${escapeIdent(primaryInput)};`;
      }

      await executor.query(sql);
      break;
    }

    // 6. HANDLE MISSING
    case "handle_missing": {
      const columns: string[] = p.columns;
      const strategy: string = p.strategy;

      if (strategy === "drop") {
        const conditions = columns.map((c) => `${escapeIdent(c)} IS NOT NULL`).join(" AND ");
        const sql = `CREATE OR REPLACE TABLE ${escapeIdent(outputTable)} AS
          SELECT * FROM ${escapeIdent(primaryInput)} WHERE ${conditions};`;
        await executor.query(sql);
      } else if (strategy === "fill_literal") {
        const val = p.value;
        const literalSql =
          val === null || val === undefined
            ? "NULL"
            : typeof val === "number" || typeof val === "boolean"
            ? String(val)
            : `'${String(val).replace(/'/g, "''")}'`;

        const replaceClauses = columns.map(
          (c) => `COALESCE(${escapeIdent(c)}, ${literalSql}) AS ${escapeIdent(c)}`
        );
        const sql = `CREATE OR REPLACE TABLE ${escapeIdent(outputTable)} AS
          SELECT * REPLACE (${replaceClauses.join(", ")}) FROM ${escapeIdent(primaryInput)};`;
        await executor.query(sql);
      } else if (strategy === "fill_mean") {
        const replaceClauses: string[] = [];
        for (const col of columns) {
          const avgRes = await executor.query<{ avg_val: number }>(
            `SELECT AVG(${escapeIdent(col)})::DOUBLE AS avg_val FROM ${escapeIdent(
              primaryInput
            )} WHERE ${escapeIdent(col)} IS NOT NULL;`
          );
          const meanVal = avgRes.rows[0]?.avg_val ?? 0;
          replaceClauses.push(
            `COALESCE(${escapeIdent(col)}, ${meanVal}) AS ${escapeIdent(col)}`
          );
        }
        const sql = `CREATE OR REPLACE TABLE ${escapeIdent(outputTable)} AS
          SELECT * REPLACE (${replaceClauses.join(", ")}) FROM ${escapeIdent(primaryInput)};`;
        await executor.query(sql);
      } else if (strategy === "fill_mode") {
        const replaceClauses: string[] = [];
        for (const col of columns) {
          const modeRes = await executor.query<{ mode_val: any }>(
            `SELECT ${escapeIdent(col)} AS mode_val FROM ${escapeIdent(
              primaryInput
            )} WHERE ${escapeIdent(col)} IS NOT NULL
             GROUP BY 1 ORDER BY COUNT(*) DESC, 1 ASC LIMIT 1;`
          );
          const modeVal = modeRes.rows[0]?.mode_val;
          const literalSql =
            modeVal === null || modeVal === undefined
              ? "NULL"
              : typeof modeVal === "number" || typeof modeVal === "boolean"
              ? String(modeVal)
              : `'${String(modeVal).replace(/'/g, "''")}'`;

          replaceClauses.push(
            `COALESCE(${escapeIdent(col)}, ${literalSql}) AS ${escapeIdent(col)}`
          );
        }
        const sql = `CREATE OR REPLACE TABLE ${escapeIdent(outputTable)} AS
          SELECT * REPLACE (${replaceClauses.join(", ")}) FROM ${escapeIdent(primaryInput)};`;
        await executor.query(sql);
      }
      break;
    }

    // 7. CAST TYPES / CAST COLUMNS
    case "cast_types":
    case "cast_columns": {
      const casts: Record<string, string> = p.casts ?? p.target_types ?? {};
      const replaceClauses = Object.entries(casts).map(([col, targetType]) => {
        const dType = toDuckDbType(targetType);
        return `TRY_CAST(${escapeIdent(col)} AS ${dType}) AS ${escapeIdent(col)}`;
      });

      const sql = `CREATE OR REPLACE TABLE ${escapeIdent(outputTable)} AS
        SELECT * REPLACE (${replaceClauses.join(", ")}) FROM ${escapeIdent(primaryInput)};`;
      await executor.query(sql);
      break;
    }

    // 8. JOIN DATASETS
    case "join_datasets": {
      if (inputTables.length < 2) {
        throw new RuntimeError(
          ERROR_CODES.INVALID_JOIN_CARDINALITY,
          `join_datasets on step '${node.nodeId}' requires 2 input tables, but got ${inputTables.length}.`
        );
      }

      const leftTable = inputTables[0];
      const rightTable = inputTables[1];

      // Safety check: Cartesian product prevention
      const maxCartesian = context.maxCartesianProduct ?? 10_000_000;
      const leftCount = await executor.getRowCount(leftTable);
      const rightCount = await executor.getRowCount(rightTable);

      const joinType = (p.join_type ?? p.how ?? "inner").toLowerCase();
      const isCross = joinType === "cross";

      if (isCross && leftCount * rightCount > maxCartesian) {
        throw new RuntimeError(
          ERROR_CODES.CARTESIAN_EXPLOSION_BLOCKED,
          `Cross join rejected: potential row count ${leftCount * rightCount} exceeds safety ceiling ${maxCartesian}.`
        );
      }

      const leftSchema = await executor.getSchema(leftTable);
      const rightSchema = await executor.getSchema(rightTable);
      const leftColNames = new Set(leftSchema.columns.map((c) => c.name));

      // Resolve column collision: for overlapping right cols, suffix with _right
      const rightSelectClauses: string[] = [];
      for (const col of rightSchema.columns) {
        if (leftColNames.has(col.name)) {
          rightSelectClauses.push(`t2.${escapeIdent(col.name)} AS ${escapeIdent(`${col.name}_right`)}`);
        } else {
          rightSelectClauses.push(`t2.${escapeIdent(col.name)}`);
        }
      }

      let joinClause = "";
      if (isCross) {
        joinClause = "CROSS JOIN";
      } else if (joinType === "left") {
        joinClause = "LEFT JOIN";
      } else if (joinType === "right") {
        joinClause = "RIGHT JOIN";
      } else if (joinType === "outer" || joinType === "full") {
        joinClause = "FULL OUTER JOIN";
      } else {
        joinClause = "INNER JOIN";
      }

      let onClause = "";
      if (!isCross) {
        if (p.on) {
          onClause = `ON ${p.on}`;
        } else {
          const leftOn: string[] = p.left_on ?? p.join_keys ?? [];
          const rightOn: string[] = p.right_on ?? p.join_keys ?? [];
          const conditions = leftOn.map(
            (lCol, idx) => `t1.${escapeIdent(lCol)} = t2.${escapeIdent(rightOn[idx])}`
          );
          onClause = `ON ${conditions.join(" AND ")}`;
        }
      }

      const sql = `CREATE OR REPLACE TABLE ${escapeIdent(outputTable)} AS
        SELECT t1.*, ${rightSelectClauses.join(", ")}
        FROM ${escapeIdent(leftTable)} AS t1
        ${joinClause} ${escapeIdent(rightTable)} AS t2
        ${onClause};`;

      await executor.query(sql);
      break;
    }

    // 9. AGGREGATE GROUP BY
    case "aggregate_group_by": {
      const groupKeys: string[] = p.group_keys ?? p.group_by_columns ?? [];
      const aggregations = p.aggregations;

      const aggSelectItems: string[] = [];

      if (Array.isArray(aggregations)) {
        for (const agg of aggregations as AggregationDefinition[]) {
          const fn = agg.func.toLowerCase();
          const colExpr = agg.column === "*" ? "*" : escapeIdent(agg.column);
          const alias = escapeIdent(agg.alias);

          if (fn === "count") {
            aggSelectItems.push(`COUNT(${colExpr}) AS ${alias}`);
          } else if (fn === "count_distinct") {
            aggSelectItems.push(`COUNT(DISTINCT ${colExpr}) AS ${alias}`);
          } else if (fn === "sum") {
            aggSelectItems.push(`SUM(${colExpr}) AS ${alias}`);
          } else if (fn === "avg" || fn === "mean") {
            aggSelectItems.push(`AVG(${colExpr}) AS ${alias}`);
          } else if (fn === "min") {
            aggSelectItems.push(`MIN(${colExpr}) AS ${alias}`);
          } else if (fn === "max") {
            aggSelectItems.push(`MAX(${colExpr}) AS ${alias}`);
          }
        }
      } else if (typeof aggregations === "object") {
        for (const [alias, expr] of Object.entries(aggregations)) {
          aggSelectItems.push(`${expr} AS ${escapeIdent(alias)}`);
        }
      }

      const allSelectItems = [...groupKeys.map(escapeIdent), ...aggSelectItems];
      const groupByClause =
        groupKeys.length > 0 ? `GROUP BY ${groupKeys.map(escapeIdent).join(", ")}` : "";

      const sql = `CREATE OR REPLACE TABLE ${escapeIdent(outputTable)} AS
        SELECT ${allSelectItems.join(", ")}
        FROM ${escapeIdent(primaryInput)}
        ${groupByClause};`;

      await executor.query(sql);
      break;
    }

    // 10. SORT ROWS
    case "sort_rows": {
      const by: any[] = p.by ?? p.sort_columns ?? [];
      const orderItems = by.map((spec) => {
        if (typeof spec === "string") {
          return `${escapeIdent(spec)} ASC`;
        }
        const col = spec.column;
        const asc = spec.order ? spec.order.toLowerCase() === "asc" : spec.ascending ?? true;
        return `${escapeIdent(col)} ${asc ? "ASC" : "DESC"}`;
      });

      const sql = `CREATE OR REPLACE TABLE ${escapeIdent(outputTable)} AS
        SELECT * FROM ${escapeIdent(primaryInput)}
        ORDER BY ${orderItems.join(", ")};`;

      await executor.query(sql);
      break;
    }

    // 11. DERIVE COLUMN
    case "derive_column": {
      const targetCol: string = p.new_column ?? p.target_column;
      const expression: string = p.expression;
      const compiledExpr = compileExpressionToSql(expression);

      const schema = await executor.getSchema(primaryInput);
      const colExists = schema.columns.some((c) => c.name === targetCol);

      let sql = "";
      if (colExists) {
        sql = `CREATE OR REPLACE TABLE ${escapeIdent(outputTable)} AS
          SELECT * REPLACE ((${compiledExpr}) AS ${escapeIdent(targetCol)})
          FROM ${escapeIdent(primaryInput)};`;
      } else {
        sql = `CREATE OR REPLACE TABLE ${escapeIdent(outputTable)} AS
          SELECT *, (${compiledExpr}) AS ${escapeIdent(targetCol)}
          FROM ${escapeIdent(primaryInput)};`;
      }

      await executor.query(sql);
      break;
    }

    // 12. DATA QUALITY RULE
    case "data_quality_rule": {
      const ruleType: string = p.rule_type;
      const column: string = p.column;
      const severity: string = p.severity ?? "warn";

      let violationCheckSql = "";
      if (ruleType === "is_not_null") {
        violationCheckSql = `SELECT COUNT(*)::BIGINT AS violations FROM ${escapeIdent(
          primaryInput
        )} WHERE ${escapeIdent(column)} IS NULL;`;
      } else if (ruleType === "in_range") {
        const min = p.params?.min;
        const max = p.params?.max;
        const conds: string[] = [];
        if (min !== undefined) conds.push(`${escapeIdent(column)} < ${min}`);
        if (max !== undefined) conds.push(`${escapeIdent(column)} > ${max}`);
        violationCheckSql = `SELECT COUNT(*)::BIGINT AS violations FROM ${escapeIdent(
          primaryInput
        )} WHERE ${conds.join(" OR ")};`;
      } else if (ruleType === "matches_regex") {
        const pattern = p.params?.pattern || "";
        violationCheckSql = `SELECT COUNT(*)::BIGINT AS violations FROM ${escapeIdent(
          primaryInput
        )} WHERE NOT regexp_matches(${escapeIdent(column)}, '${pattern.replace(/'/g, "''")}');`;
      }

      const checkRes = await executor.query<{ violations: number }>(violationCheckSql);
      const violations = Number(checkRes.rows[0]?.violations ?? 0);

      if (violations > 0) {
        const msg = `Data quality check '${ruleType}' failed on column '${column}': ${violations} violation(s) found.`;
        if (severity === "fail") {
          throw new RuntimeError(ERROR_CODES.DATA_QUALITY_VIOLATION, msg, {
            ruleType,
            column,
            violations,
          });
        } else {
          warnings = [msg];
        }
      }

      // Pass-through table to output
      const copySql = `CREATE OR REPLACE TABLE ${escapeIdent(outputTable)} AS SELECT * FROM ${escapeIdent(
        primaryInput
      )};`;
      await executor.query(copySql);
      break;
    }

    default: {
      throw new RuntimeError(
        ERROR_CODES.UNSUPPORTED_OPERATION,
        `Unsupported transformation '${op}'.`
      );
    }
  }

  const rowCount = await executor.getRowCount(outputTable);

  return {
    outputTable,
    rowCount,
    warnings,
  };
}
