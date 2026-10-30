/**
 * Data Rewind Structured Runtime Errors.
 */

import { ExecutionError } from "./index";

export const ERROR_CODES = {
  RUNTIME_NOT_INITIALIZED: "RUNTIME_NOT_INITIALIZED",
  RUNTIME_ALREADY_INITIALIZED: "RUNTIME_ALREADY_INITIALIZED",
  WORKER_INIT_FAILED: "WORKER_INIT_FAILED",
  WORKER_TERMINATED: "WORKER_TERMINATED",
  OPERATION_CANCELLED: "OPERATION_CANCELLED",
  SQL_SYNTAX_ERROR: "SQL_SYNTAX_ERROR",
  SQL_EXECUTION_ERROR: "SQL_EXECUTION_ERROR",
  TABLE_NOT_FOUND: "TABLE_NOT_FOUND",
  CSV_FILE_TOO_LARGE: "CSV_FILE_TOO_LARGE",
  CSV_MAX_ROWS_EXCEEDED: "CSV_MAX_ROWS_EXCEEDED",
  CSV_MAX_COLUMNS_EXCEEDED: "CSV_MAX_COLUMNS_EXCEEDED",
  CSV_OVERSIZED_CELL: "CELL_LENGTH_LIMIT_EXCEEDED",
  CELL_LENGTH_LIMIT_EXCEEDED: "CELL_LENGTH_LIMIT_EXCEEDED",
  CSV_DUPLICATE_COLUMNS: "CSV_DUPLICATE_COLUMNS",
  CSV_EMPTY_COLUMN_NAME: "CSV_EMPTY_COLUMN_NAME",
  CSV_MALFORMED: "CSV_MALFORMED",
  CSV_INVALID_FILE_TYPE: "CSV_INVALID_FILE_TYPE",
  STORAGE_QUOTA_EXCEEDED: "STORAGE_QUOTA_EXCEEDED",
  STORAGE_UNAVAILABLE: "STORAGE_UNAVAILABLE",
} as const;

export type RuntimeErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export class RuntimeError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;
  readonly remediation?: string;

  constructor(
    code: string,
    message: string,
    details?: Record<string, unknown>,
    remediation?: string
  ) {
    super(message);
    this.name = "RuntimeError";
    this.code = code;
    this.details = details;
    this.remediation = remediation;
  }

  toExecutionError(stepId?: string): ExecutionError {
    return {
      code: this.code,
      message: this.message,
      stepId,
      details: this.details,
      remediation: this.remediation,
      timestamp: new Date().toISOString(),
    };
  }

  static fromExecutionError(error: ExecutionError): RuntimeError {
    return new RuntimeError(
      error.code,
      error.message,
      error.details,
      error.remediation
    );
  }
}
