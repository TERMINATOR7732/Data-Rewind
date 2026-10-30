/**
 * Data Rewind Dedicated DuckDB-Wasm Web Worker.
 * Executes database initialization, CSV ingestion, and SQL analytics
 * completely isolated from the UI main thread.
 *
 * Implements the typed communication protocol (SPEC-MOD-07 §3).
 */

import * as duckdb from "@duckdb/duckdb-wasm";
import {
  WorkerRequest,
  WorkerResponse,
  QueryResult,
  ImportCsvPayload,
  ExecuteSqlPayload,
} from "../contracts/protocol";
import { ERROR_CODES, RuntimeError } from "../contracts/errors";
import {
  DatasetMetadata,
  DatasetSchema,
  ColumnSchema,
  DataType,
  EXECUTION_CONTRACT_VERSION,
} from "../contracts/index";
import { CsvParser } from "../csv/parser";

let dbInstance: duckdb.AsyncDuckDB | null = null;
let activeConnection: duckdb.AsyncDuckDBConnection | null = null;
let isInitialized = false;
const activeRequests = new Set<string>();

/**
 * Maps DuckDB type strings to canonical DataType enum.
 */
function mapDuckDBTypeToCanonical(duckdbType: string): DataType {
  const upper = duckdbType.toUpperCase();
  if (
    upper.includes("INT") ||
    upper.includes("BIGINT") ||
    upper.includes("SMALLINT") ||
    upper.includes("TINYINT")
  ) {
    return "INTEGER";
  }
  if (
    upper.includes("FLOAT") ||
    upper.includes("DOUBLE") ||
    upper.includes("DECIMAL") ||
    upper.includes("REAL") ||
    upper.includes("NUMERIC")
  ) {
    return "FLOAT";
  }
  if (upper.includes("BOOL")) {
    return "BOOLEAN";
  }
  if (upper.includes("TIMESTAMP")) {
    return "TIMESTAMP";
  }
  if (upper.includes("DATE")) {
    return "DATE";
  }
  return "STRING";
}

/**
 * Converts an Apache Arrow Table into a typed QueryResult.
 */
function arrowTableToQueryResult(table: any, durationMs: number): QueryResult {
  const fields = table?.schema?.fields || [];
  const columns: string[] = fields.map((f: any) => f.name);
  const columnTypes: string[] = fields.map((f: any) => String(f.type));

  const rows: Record<string, unknown>[] = (table.toArray?.() || []).map(
    (row: any) => (row.toJSON ? row.toJSON() : { ...row })
  );
  const numRows = table?.numRows ?? rows.length;

  return {
    columns,
    columnTypes,
    rows,
    rowCount: numRows,
    durationMs,
  };
}

/**
 * Worker message dispatcher.
 */
self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (!request || !request.requestId || !request.action) {
    return;
  }

  const { requestId, action } = request;
  activeRequests.add(requestId);

  const sendResponse = (response: WorkerResponse) => {
    self.postMessage(response);
    if (response.action !== "PROGRESS") {
      activeRequests.delete(requestId);
    }
  };

  const sendProgress = (
    stage: string,
    percentComplete: number,
    details?: string
  ) => {
    sendResponse({
      requestId,
      action: "PROGRESS",
      payload: { stage, percentComplete, details },
    });
  };

  try {
    switch (action) {
      case "INITIALIZE": {
        if (isInitialized && dbInstance) {
          sendResponse({
            requestId,
            action: "INITIALIZED",
            payload: {
              version: "1.29.0",
              environment: "web-worker",
              features: {
                singleThreaded: true,
                opfsSupported:
                  typeof navigator !== "undefined" && !!navigator.storage,
              },
            },
          });
          return;
        }

        sendProgress("Resolving WASM bundles", 20);

        const mvpWasm =
          request.payload?.wasmUrls?.mvpWasm || "/duckdb/duckdb-mvp.wasm";
        const workerUrl = "/duckdb/duckdb-browser-mvp.worker.js";

        sendProgress("Instantiating WebAssembly Worker", 50);

        const logger = new duckdb.VoidLogger();
        const innerWorker = new Worker(workerUrl);
        dbInstance = new duckdb.AsyncDuckDB(logger, innerWorker);
        await dbInstance.instantiate(mvpWasm);

        activeConnection = await dbInstance.connect();
        isInitialized = true;

        sendProgress("Database ready", 100);

        sendResponse({
          requestId,
          action: "INITIALIZED",
          payload: {
            version: "1.29.0",
            environment: "web-worker",
            features: {
              singleThreaded: true,
              opfsSupported:
                typeof navigator !== "undefined" && !!navigator.storage,
            },
          },
        });
        break;
      }

      case "IMPORT_CSV": {
        if (!isInitialized || !activeConnection || !dbInstance) {
          throw new RuntimeError(
            ERROR_CODES.RUNTIME_NOT_INITIALIZED,
            "Cannot import CSV: DuckDB-Wasm is not initialized."
          );
        }

        const { tableName, csvContent, options } =
          request.payload as ImportCsvPayload;

        sendProgress("Validating CSV structure", 10);

        // Pre-validate CSV content & guardrails
        const summary = await CsvParser.parseAndValidate(csvContent, {
          onProgress: (p) => {
            sendProgress(
              "Validating CSV guardrails",
              Math.round(10 + p.percent * 0.4),
              `${p.rowsScanned.toLocaleString()} rows scanned`
            );
          },
        });

        sendProgress("Registering file buffer in DuckDB", 60);

        const fileName = `${tableName}_input.csv`;
        const buffer =
          typeof csvContent === "string"
            ? new TextEncoder().encode(csvContent)
            : csvContent;

        await dbInstance.registerFileBuffer(fileName, buffer);

        sendProgress("Executing DuckDB CSV ingestion", 75);

        // Drop existing table if exists
        await activeConnection.query(`DROP TABLE IF EXISTS "${tableName}";`);

        // Load into DuckDB using read_csv_auto
        const headerOpt =
          options?.header !== false ? "header = true" : "header = false";
        const delimOpt = options?.delimiter
          ? `, delim = '${options.delimiter}'`
          : "";
        await activeConnection.query(
          `CREATE TABLE "${tableName}" AS SELECT * FROM read_csv_auto('${fileName}', ${headerOpt}${delimOpt});`
        );

        // Clean up registered file buffer to conserve memory
        try {
          await dbInstance.dropFile(fileName);
        } catch {
          // Ignore file drop warnings
        }

        sendProgress("Inspecting inferred schema", 90);

        // Query inferred table schema
        const schemaTable = await activeConnection.query(
          `DESCRIBE "${tableName}";`
        );
        const schemaResult = arrowTableToQueryResult(schemaTable, 0);

        const columns: ColumnSchema[] = schemaResult.rows.map(
          (row: any, idx: number) => ({
            name: String(row.column_name),
            dataType: mapDuckDBTypeToCanonical(String(row.column_type)),
            nullable: String(row.null).toUpperCase() === "YES",
            ordinalPosition: idx + 1,
          })
        );

        // Query exact row count
        const countTable = await activeConnection.query(
          `SELECT COUNT(*)::BIGINT AS count FROM "${tableName}";`
        );
        const countResult = arrowTableToQueryResult(countTable, 0);
        const rowCount = Number(countResult.rows[0]?.count ?? summary.rowCount);

        const schema: DatasetSchema = {
          version: EXECUTION_CONTRACT_VERSION,
          columns,
          primaryKeys: [],
        };

        const metadata: DatasetMetadata = {
          datasetId: tableName,
          name: tableName,
          rowCount,
          columnCount: columns.length,
          byteSize: summary.byteSize,
          sha256Hash: summary.sha256Hash,
          schema,
          createdAt: new Date().toISOString(),
        };

        sendProgress("Ingestion complete", 100);

        sendResponse({
          requestId,
          action: "SUCCESS",
          payload: metadata,
        });
        break;
      }

      case "EXECUTE_SQL": {
        if (!isInitialized || !activeConnection) {
          throw new RuntimeError(
            ERROR_CODES.RUNTIME_NOT_INITIALIZED,
            "Cannot execute SQL: DuckDB-Wasm is not initialized."
          );
        }

        const { sql } = request.payload as ExecuteSqlPayload;
        const startTime = performance.now();

        sendProgress("Executing query", 30);

        const tableResult = await activeConnection.query(sql);
        const durationMs = Math.round(performance.now() - startTime);

        sendProgress("Formatting result set", 80);

        const queryResult = arrowTableToQueryResult(tableResult, durationMs);

        sendResponse({
          requestId,
          action: "SUCCESS",
          payload: queryResult,
        });
        break;
      }

      case "GET_TABLE_SCHEMA": {
        if (!isInitialized || !activeConnection) {
          throw new RuntimeError(
            ERROR_CODES.RUNTIME_NOT_INITIALIZED,
            "Cannot retrieve schema: DuckDB-Wasm is not initialized."
          );
        }

        const { tableName } = request.payload;
        const schemaTable = await activeConnection.query(
          `DESCRIBE "${tableName}";`
        );
        const schemaResult = arrowTableToQueryResult(schemaTable, 0);

        const columns: ColumnSchema[] = schemaResult.rows.map(
          (row: any, idx: number) => ({
            name: String(row.column_name),
            dataType: mapDuckDBTypeToCanonical(String(row.column_type)),
            nullable: String(row.null).toUpperCase() === "YES",
            ordinalPosition: idx + 1,
          })
        );

        const schema: DatasetSchema = {
          version: EXECUTION_CONTRACT_VERSION,
          columns,
          primaryKeys: [],
        };

        sendResponse({
          requestId,
          action: "SUCCESS",
          payload: schema,
        });
        break;
      }

      case "GET_ROW_COUNT": {
        if (!isInitialized || !activeConnection) {
          throw new RuntimeError(
            ERROR_CODES.RUNTIME_NOT_INITIALIZED,
            "Cannot count rows: DuckDB-Wasm is not initialized."
          );
        }

        const { tableName } = request.payload;
        const countTable = await activeConnection.query(
          `SELECT COUNT(*)::BIGINT AS count FROM "${tableName}";`
        );
        const countResult = arrowTableToQueryResult(countTable, 0);
        const rowCount = Number(countResult.rows[0]?.count ?? 0);

        sendResponse({
          requestId,
          action: "SUCCESS",
          payload: { tableName, rowCount },
        });
        break;
      }

      case "CANCEL": {
        const { targetRequestId } = request.payload;
        if (activeRequests.has(targetRequestId)) {
          activeRequests.delete(targetRequestId);
          sendResponse({
            requestId: targetRequestId,
            action: "ERROR",
            error: {
              code: ERROR_CODES.OPERATION_CANCELLED,
              message: `Operation '${targetRequestId}' was cancelled by user.`,
              timestamp: new Date().toISOString(),
            },
          });
        }
        sendResponse({
          requestId,
          action: "SUCCESS",
          payload: { targetRequestId, cancelled: true },
        });
        break;
      }

      case "TERMINATE": {
        if (activeConnection) {
          try {
            await activeConnection.close();
          } catch {
            // Ignore close errors
          }
          activeConnection = null;
        }
        if (dbInstance) {
          try {
            await dbInstance.flushFiles();
            await dbInstance.terminate();
          } catch {
            // Ignore terminate errors
          }
          dbInstance = null;
        }
        isInitialized = false;

        sendResponse({
          requestId,
          action: "SUCCESS",
          payload: { terminated: true },
        });

        // Gracefully close worker
        self.close();
        break;
      }

      default: {
        throw new RuntimeError(
          "INVALID_ACTION",
          `Unknown or unsupported worker action '${(request as any).action}'.`
        );
      }
    }
  } catch (err: any) {
    const error =
      err instanceof RuntimeError
        ? err.toExecutionError()
        : {
            code: ERROR_CODES.SQL_EXECUTION_ERROR,
            message: err?.message || "Internal worker error occurred",
            details: { name: err?.name, stack: err?.stack },
            timestamp: new Date().toISOString(),
          };

    sendResponse({
      requestId,
      action: "ERROR",
      error,
    });
  }
};
