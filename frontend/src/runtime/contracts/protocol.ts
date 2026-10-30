/**
 * Data Rewind Typed Web Worker Protocol.
 * Conforms to SPEC-MOD-07 browser runtime communication specification.
 */

import { ExecutionError } from "./index";

export type WorkerRequestAction =
  | "INITIALIZE"
  | "IMPORT_CSV"
  | "EXECUTE_SQL"
  | "GET_TABLE_SCHEMA"
  | "GET_ROW_COUNT"
  | "CANCEL"
  | "TERMINATE";

export type WorkerResponseAction =
  | "INITIALIZED"
  | "SUCCESS"
  | "ERROR"
  | "PROGRESS";

export interface BaseWorkerRequest {
  requestId: string;
  action: WorkerRequestAction;
}

export interface InitializePayload {
  wasmUrls?: {
    mvpWasm?: string;
    ehWasm?: string;
  };
}

export interface InitializeRequest extends BaseWorkerRequest {
  action: "INITIALIZE";
  payload?: InitializePayload;
}

export interface ImportCsvPayload {
  tableName: string;
  csvContent: string | Uint8Array;
  options?: {
    header?: boolean;
    delimiter?: string;
    sampleRows?: number;
    nullString?: string;
  };
}

export interface ImportCsvRequest extends BaseWorkerRequest {
  action: "IMPORT_CSV";
  payload: ImportCsvPayload;
}

export interface ExecuteSqlPayload {
  sql: string;
  params?: unknown[];
}

export interface ExecuteSqlRequest extends BaseWorkerRequest {
  action: "EXECUTE_SQL";
  payload: ExecuteSqlPayload;
}

export interface GetTableSchemaRequest extends BaseWorkerRequest {
  action: "GET_TABLE_SCHEMA";
  payload: {
    tableName: string;
  };
}

export interface GetRowCountRequest extends BaseWorkerRequest {
  action: "GET_ROW_COUNT";
  payload: {
    tableName: string;
  };
}

export interface CancelRequest extends BaseWorkerRequest {
  action: "CANCEL";
  payload: {
    targetRequestId: string;
  };
}

export interface TerminateRequest extends BaseWorkerRequest {
  action: "TERMINATE";
}

export type WorkerRequest =
  | InitializeRequest
  | ImportCsvRequest
  | ExecuteSqlRequest
  | GetTableSchemaRequest
  | GetRowCountRequest
  | CancelRequest
  | TerminateRequest;

export interface BaseWorkerResponse {
  requestId: string;
  action: WorkerResponseAction;
}

export interface InitializedPayload {
  version: string;
  environment: "web-worker";
  features: {
    singleThreaded: boolean;
    opfsSupported: boolean;
  };
}

export interface InitializedResponse extends BaseWorkerResponse {
  action: "INITIALIZED";
  payload: InitializedPayload;
}

export interface ProgressPayload {
  stage: string;
  percentComplete: number; // 0 - 100
  details?: string;
}

export interface ProgressResponse extends BaseWorkerResponse {
  action: "PROGRESS";
  payload: ProgressPayload;
}

export interface ErrorResponse extends BaseWorkerResponse {
  action: "ERROR";
  error: ExecutionError;
}

export interface QueryResult<T = Record<string, unknown>> {
  columns: string[];
  columnTypes: string[];
  rows: T[];
  rowCount: number;
  durationMs: number;
}

export interface SuccessResponse<T = unknown> extends BaseWorkerResponse {
  action: "SUCCESS";
  payload: T;
}

export type WorkerResponse =
  | InitializedResponse
  | ProgressResponse
  | ErrorResponse
  | SuccessResponse;
