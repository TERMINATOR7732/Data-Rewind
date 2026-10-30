/**
 * Data Rewind Browser Execution Runtime.
 * Implements the browser-first execution engine interface (SPEC-MOD-07).
 * Connects the UI thread to the DuckDB-Wasm Web Worker via a typed correlation protocol.
 */

import {
  DatasetMetadata,
  DatasetSchema,
  PipelineDefinition,
  ExecutionPlan,
  ExecutionRequest,
  PipelineExecutionResult,
  ValidationResult,
  PipelineNode,
} from "./contracts/index";
import {
  WorkerRequest,
  WorkerResponse,
  ProgressPayload,
  QueryResult,
  ImportCsvPayload,
} from "./contracts/protocol";
import { ERROR_CODES, RuntimeError } from "./contracts/errors";
import { TransformationResult } from "./pipeline/transformations/types";

export interface BrowserExecutionRuntime {
  initialize(): Promise<void>;
  importCsv(
    tableName: string,
    content: string | Uint8Array,
    options?: ImportCsvPayload["options"]
  ): Promise<DatasetMetadata>;
  executeQuery<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<QueryResult<T>>;
  getSchema(tableName: string): Promise<DatasetSchema>;
  getRowCount(tableName: string): Promise<number>;
  validatePipeline(pipeline: PipelineDefinition): Promise<ValidationResult>;
  planPipeline(pipeline: PipelineDefinition): Promise<ExecutionPlan>;
  executePipeline(request: ExecutionRequest): Promise<PipelineExecutionResult>;
  executeStep(
    node: PipelineNode,
    inputTables: string[],
    outputTable: string
  ): Promise<TransformationResult>;
  cancel(targetRequestId: string): Promise<void>;
  dispose(): Promise<void>;
  onProgress(callback: (progress: ProgressPayload) => void): () => void;
  isReady(): boolean;
}

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  action: string;
  timeoutTimer?: ReturnType<typeof setTimeout>;
}

export interface DuckDbWasmRuntimeOptions {
  workerFactory?: () => Worker;
  defaultTimeoutMs?: number;
  wasmUrls?: {
    mvpWasm?: string;
    ehWasm?: string;
  };
}

export class DuckDbWasmRuntime implements BrowserExecutionRuntime {
  private worker: Worker | null = null;
  private pendingRequests = new Map<string, PendingRequest>();
  private progressListeners = new Set<(p: ProgressPayload) => void>();
  private initialized = false;
  private initializingPromise: Promise<void> | null = null;
  private options: DuckDbWasmRuntimeOptions;

  constructor(options: DuckDbWasmRuntimeOptions = {}) {
    this.options = {
      defaultTimeoutMs: 120_000, // 120s processing limit per specification
      ...options,
    };
  }

  public isReady(): boolean {
    return this.initialized && this.worker !== null;
  }

  public onProgress(callback: (progress: ProgressPayload) => void): () => void {
    this.progressListeners.add(callback);
    return () => {
      this.progressListeners.delete(callback);
    };
  }

  private notifyProgress(progress: ProgressPayload): void {
    for (const listener of this.progressListeners) {
      try {
        listener(progress);
      } catch (err) {
        console.error("Progress listener error:", err);
      }
    }
  }

  private createWorker(): Worker {
    if (this.options.workerFactory) {
      return this.options.workerFactory();
    }
    // Vite Web Worker instantiation
    return new Worker(
      new URL("./worker/duckdb.worker.ts", import.meta.url),
      { type: "module" }
    );
  }

  public async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    if (this.initializingPromise) {
      return this.initializingPromise;
    }

    this.initializingPromise = (async () => {
      try {
        if (!this.worker) {
          this.worker = this.createWorker();
          this.worker.onmessage = this.handleWorkerMessage.bind(this);
          this.worker.onerror = this.handleWorkerError.bind(this);
          this.worker.onmessageerror = this.handleWorkerMessageError.bind(this);
        }

        await this.sendRequest("INITIALIZE", {
          wasmUrls: this.options.wasmUrls,
        });

        this.initialized = true;
      } catch (err) {
        this.dispose();
        throw err;
      } finally {
        this.initializingPromise = null;
      }
    })();

    return this.initializingPromise;
  }

  public async importCsv(
    tableName: string,
    content: string | Uint8Array,
    options?: ImportCsvPayload["options"]
  ): Promise<DatasetMetadata> {
    this.ensureInitialized();
    return this.sendRequest<DatasetMetadata>("IMPORT_CSV", {
      tableName,
      csvContent: content,
      options,
    });
  }

  public async executeQuery<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<QueryResult<T>> {
    this.ensureInitialized();
    return this.sendRequest<QueryResult<T>>("EXECUTE_SQL", {
      sql,
      params,
    });
  }

  public async getSchema(tableName: string): Promise<DatasetSchema> {
    this.ensureInitialized();
    return this.sendRequest<DatasetSchema>("GET_TABLE_SCHEMA", {
      tableName,
    });
  }

  public async getRowCount(tableName: string): Promise<number> {
    this.ensureInitialized();
    const res = await this.sendRequest<{ tableName: string; rowCount: number }>(
      "GET_ROW_COUNT",
      { tableName }
    );
    return res.rowCount;
  }

  public async validatePipeline(pipeline: PipelineDefinition): Promise<ValidationResult> {
    this.ensureInitialized();
    return this.sendRequest<ValidationResult>("VALIDATE_PIPELINE", { pipeline });
  }

  public async planPipeline(pipeline: PipelineDefinition): Promise<ExecutionPlan> {
    this.ensureInitialized();
    return this.sendRequest<ExecutionPlan>("PLAN_PIPELINE", { pipeline });
  }

  public async executePipeline(request: ExecutionRequest): Promise<PipelineExecutionResult> {
    this.ensureInitialized();
    return this.sendRequest<PipelineExecutionResult>("EXECUTE_PIPELINE", request);
  }

  public async executeStep(
    node: PipelineNode,
    inputTables: string[],
    outputTable: string
  ): Promise<TransformationResult> {
    this.ensureInitialized();
    return this.sendRequest<TransformationResult>("EXECUTE_STEP", {
      node,
      inputTables,
      outputTable,
    });
  }

  public async cancel(targetRequestId: string): Promise<void> {
    if (!this.worker) {
      return;
    }
    await this.sendRequest("CANCEL", { targetRequestId });
  }

  public async dispose(): Promise<void> {
    if (this.worker) {
      try {
        // Send terminate request
        const termReqId = this.generateRequestId();
        this.worker.postMessage({
          requestId: termReqId,
          action: "TERMINATE",
        });
      } catch {
        // Ignore termination dispatch errors
      }

      this.worker.terminate();
      this.worker = null;
    }

    // Reject all outstanding requests
    for (const [id, req] of this.pendingRequests.entries()) {
      if (req.timeoutTimer) clearTimeout(req.timeoutTimer);
      req.reject(
        new RuntimeError(
          ERROR_CODES.WORKER_TERMINATED,
          `Operation '${id}' cancelled because runtime was disposed.`
        )
      );
    }
    this.pendingRequests.clear();
    this.progressListeners.clear();
    this.initialized = false;
  }

  private ensureInitialized(): void {
    if (!this.initialized || !this.worker) {
      throw new RuntimeError(
        ERROR_CODES.RUNTIME_NOT_INITIALIZED,
        "Browser execution runtime is not initialized. Call initialize() first."
      );
    }
  }

  private generateRequestId(): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  private sendRequest<T>(action: WorkerRequest["action"], payload?: any, timeoutMs?: number): Promise<T> {
    if (!this.worker) {
      return Promise.reject(
        new RuntimeError(
          ERROR_CODES.WORKER_TERMINATED,
          "Web Worker is not active."
        )
      );
    }

    const requestId = this.generateRequestId();
    const effectiveTimeout = timeoutMs ?? this.options.defaultTimeoutMs ?? 120_000;

    return new Promise<T>((resolve, reject) => {
      let timeoutTimer: ReturnType<typeof setTimeout> | undefined;

      if (effectiveTimeout > 0) {
        timeoutTimer = setTimeout(() => {
          if (this.pendingRequests.has(requestId)) {
            this.pendingRequests.delete(requestId);
            reject(
              new RuntimeError(
                "OPERATION_TIMEOUT",
                `Operation '${action}' timed out after ${effectiveTimeout}ms.`
              )
            );
          }
        }, effectiveTimeout);
      }

      this.pendingRequests.set(requestId, {
        resolve,
        reject,
        action,
        timeoutTimer,
      });

      const message: WorkerRequest = {
        requestId,
        action,
        payload,
      } as WorkerRequest;

      this.worker!.postMessage(message);
    });
  }

  private handleWorkerMessage(event: MessageEvent<WorkerResponse>): void {
    const response = event.data;
    if (!response || !response.requestId) {
      return;
    }

    const { requestId, action } = response;

    // Handle progress notification
    if (action === "PROGRESS") {
      this.notifyProgress((response as any).payload);
      return;
    }

    const pending = this.pendingRequests.get(requestId);
    if (!pending) {
      return;
    }

    if (pending.timeoutTimer) {
      clearTimeout(pending.timeoutTimer);
    }
    this.pendingRequests.delete(requestId);

    if (action === "ERROR") {
      const execError = (response as any).error;
      const error = execError
        ? RuntimeError.fromExecutionError(execError)
        : new RuntimeError(ERROR_CODES.SQL_EXECUTION_ERROR, "Unknown worker error");
      pending.reject(error);
    } else if (action === "SUCCESS" || action === "INITIALIZED") {
      pending.resolve((response as any).payload);
    }
  }

  private handleWorkerError(errorEvent: ErrorEvent): void {
    console.error("Worker unhandled error:", errorEvent);
    const err = new RuntimeError(
      ERROR_CODES.WORKER_INIT_FAILED,
      `Web Worker encountered an unhandled error: ${errorEvent.message || "Unknown error"}`
    );

    for (const req of this.pendingRequests.values()) {
      if (req.timeoutTimer) clearTimeout(req.timeoutTimer);
      req.reject(err);
    }
    this.pendingRequests.clear();
  }

  private handleWorkerMessageError(event: MessageEvent): void {
    console.error("Worker message deserialization error:", event);
  }
}

// Global runtime singleton instance
let defaultRuntimeInstance: DuckDbWasmRuntime | null = null;

export function getBrowserRuntime(options?: DuckDbWasmRuntimeOptions): DuckDbWasmRuntime {
  if (!defaultRuntimeInstance) {
    defaultRuntimeInstance = new DuckDbWasmRuntime(options);
  }
  return defaultRuntimeInstance;
}
