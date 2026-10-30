/**
 * Transformation execution types and interfaces.
 */

import { DatasetSchema, PipelineNode } from "../../contracts/index";
import { QueryResult } from "../../contracts/protocol";

export interface QueryExecutor {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  getSchema(tableName: string): Promise<DatasetSchema>;
  getRowCount(tableName: string): Promise<number>;
}

export interface TransformationContext {
  node: PipelineNode;
  inputTables: string[];
  outputTable: string;
  executor: QueryExecutor;
  maxCartesianProduct?: number;
}

export interface TransformationResult {
  outputTable: string;
  rowCount: number;
  warnings?: string[];
}
