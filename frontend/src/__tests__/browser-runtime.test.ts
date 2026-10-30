import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DuckDbWasmRuntime } from "../runtime/browser-runtime";
import { ERROR_CODES } from "../runtime/contracts/errors";
import { WorkerRequest, WorkerResponse } from "../runtime/contracts/protocol";
import { EXECUTION_CONTRACT_VERSION } from "../runtime/contracts/index";

class MockWorker {
  onmessage: ((ev: MessageEvent<WorkerResponse>) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;
  onmessageerror: ((ev: MessageEvent) => void) | null = null;
  sentMessages: WorkerRequest[] = [];
  terminated = false;

  postMessage(msg: WorkerRequest) {
    this.sentMessages.push(msg);

    // Default automated mock response based on action
    setTimeout(() => {
      if (!this.onmessage || this.terminated) return;

      if (msg.action === "INITIALIZE") {
        this.onmessage(
          new MessageEvent("message", {
            data: {
              requestId: msg.requestId,
              action: "INITIALIZED",
              payload: {
                version: "1.29.0",
                environment: "web-worker",
                features: { singleThreaded: true, opfsSupported: false },
              },
            },
          })
        );
      } else if (msg.action === "IMPORT_CSV") {
        // Send a progress message first
        this.onmessage(
          new MessageEvent("message", {
            data: {
              requestId: msg.requestId,
              action: "PROGRESS",
              payload: { stage: "Ingesting", percentComplete: 50 },
            },
          })
        );
        // Send success
        this.onmessage(
          new MessageEvent("message", {
            data: {
              requestId: msg.requestId,
              action: "SUCCESS",
              payload: {
                datasetId: (msg as any).payload.tableName,
                name: (msg as any).payload.tableName,
                rowCount: 10,
                columnCount: 2,
                byteSize: 200,
                sha256Hash: "hash123",
                schema: {
                  version: EXECUTION_CONTRACT_VERSION,
                  columns: [
                    { name: "id", dataType: "INTEGER", nullable: false, ordinalPosition: 1 },
                    { name: "name", dataType: "STRING", nullable: true, ordinalPosition: 2 },
                  ],
                  primaryKeys: [],
                },
                createdAt: new Date().toISOString(),
              },
            },
          })
        );
      } else if (msg.action === "EXECUTE_SQL") {
        this.onmessage(
          new MessageEvent("message", {
            data: {
              requestId: msg.requestId,
              action: "SUCCESS",
              payload: {
                columns: ["id", "val"],
                columnTypes: ["INTEGER", "VARCHAR"],
                rows: [{ id: 1, val: "A" }],
                rowCount: 1,
                durationMs: 4,
              },
            },
          })
        );
      } else if (msg.action === "GET_TABLE_SCHEMA") {
        this.onmessage(
          new MessageEvent("message", {
            data: {
              requestId: msg.requestId,
              action: "SUCCESS",
              payload: {
                version: EXECUTION_CONTRACT_VERSION,
                columns: [{ name: "id", dataType: "INTEGER", nullable: false, ordinalPosition: 1 }],
                primaryKeys: ["id"],
              },
            },
          })
        );
      } else if (msg.action === "GET_ROW_COUNT") {
        this.onmessage(
          new MessageEvent("message", {
            data: {
              requestId: msg.requestId,
              action: "SUCCESS",
              payload: { tableName: (msg as any).payload.tableName, rowCount: 42 },
            },
          })
        );
      } else if (msg.action === "CANCEL") {
        this.onmessage(
          new MessageEvent("message", {
            data: {
              requestId: msg.requestId,
              action: "SUCCESS",
              payload: { targetRequestId: (msg as any).payload.targetRequestId, cancelled: true },
            },
          })
        );
      } else if (msg.action === "TERMINATE") {
        this.onmessage(
          new MessageEvent("message", {
            data: {
              requestId: msg.requestId,
              action: "SUCCESS",
              payload: { terminated: true },
            },
          })
        );
      }
    }, 5);
  }

  terminate() {
    this.terminated = true;
  }
}

describe("DuckDbWasmRuntime Web Worker Integration", () => {
  let mockWorker: MockWorker;
  let runtime: DuckDbWasmRuntime;

  beforeEach(() => {
    mockWorker = new MockWorker();
    runtime = new DuckDbWasmRuntime({
      workerFactory: () => mockWorker as unknown as Worker,
      defaultTimeoutMs: 5000,
    });
  });

  afterEach(async () => {
    await runtime.dispose();
  });

  it("initializes worker and reports ready status", async () => {
    expect(runtime.isReady()).toBe(false);
    await runtime.initialize();
    expect(runtime.isReady()).toBe(true);

    const initMsg = mockWorker.sentMessages.find((m) => m.action === "INITIALIZE");
    expect(initMsg).toBeDefined();
    expect(initMsg?.requestId).toBeDefined();
  });

  it("throws RUNTIME_NOT_INITIALIZED when calling methods before initialize()", async () => {
    await expect(runtime.executeQuery("SELECT 1;")).rejects.toThrowError(
      expect.objectContaining({
        code: ERROR_CODES.RUNTIME_NOT_INITIALIZED,
      })
    );
  });

  it("correlates request IDs and handles progress callbacks on importCsv", async () => {
    await runtime.initialize();

    const progressEvents: any[] = [];
    const unsubscribe = runtime.onProgress((p) => {
      progressEvents.push(p);
    });

    const metadata = await runtime.importCsv("test_orders", "id,name\n1,Alpha");

    expect(metadata.datasetId).toBe("test_orders");
    expect(metadata.rowCount).toBe(10);
    expect(metadata.columnCount).toBe(2);
    expect(progressEvents.length).toBeGreaterThan(0);
    expect(progressEvents[0].stage).toBe("Ingesting");

    unsubscribe();
  });

  it("executes SQL queries and parses typed QueryResults", async () => {
    await runtime.initialize();

    const res = await runtime.executeQuery<{ id: number; val: string }>("SELECT 1;");
    expect(res.rowCount).toBe(1);
    expect(res.columns).toEqual(["id", "val"]);
    expect(res.rows[0].val).toBe("A");
  });

  it("retrieves table schema and row count", async () => {
    await runtime.initialize();

    const schema = await runtime.getSchema("test_table");
    expect(schema.columns[0].name).toBe("id");

    const rowCount = await runtime.getRowCount("test_table");
    expect(rowCount).toBe(42);
  });

  it("handles worker error responses properly mapped to RuntimeError", async () => {
    await runtime.initialize();

    // Custom worker behavior that returns an ERROR
    mockWorker.postMessage = (msg: WorkerRequest) => {
      setTimeout(() => {
        if (mockWorker.onmessage) {
          mockWorker.onmessage(
            new MessageEvent("message", {
              data: {
                requestId: msg.requestId,
                action: "ERROR",
                error: {
                  code: ERROR_CODES.SQL_SYNTAX_ERROR,
                  message: "Parser Error near 'SELCT'",
                  timestamp: new Date().toISOString(),
                },
              },
            })
          );
        }
      }, 5);
    };

    await expect(runtime.executeQuery("SELCT * FROM test;")).rejects.toThrowError(
      expect.objectContaining({
        code: ERROR_CODES.SQL_SYNTAX_ERROR,
      })
    );
  });

  it("handles request cancellation", async () => {
    await runtime.initialize();
    await runtime.cancel("target_req_123");

    const cancelMsg = mockWorker.sentMessages.find((m) => m.action === "CANCEL");
    expect(cancelMsg).toBeDefined();
    expect((cancelMsg as any).payload.targetRequestId).toBe("target_req_123");
  });

  it("disposes cleanly and rejects pending requests on disposal", async () => {
    await runtime.initialize();

    // Intercept next message so it doesn't resolve immediately
    mockWorker.postMessage = () => {};

    const pendingPromise = runtime.executeQuery("SELECT * FROM huge;");

    // Dispose while query is pending
    await runtime.dispose();

    expect(runtime.isReady()).toBe(false);
    expect(mockWorker.terminated).toBe(true);

    await expect(pendingPromise).rejects.toThrowError(
      expect.objectContaining({
        code: ERROR_CODES.WORKER_TERMINATED,
      })
    );
  });
});
