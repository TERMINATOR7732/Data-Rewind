import { describe, it, expect } from "vitest";
import { PipelineExecutionEngine } from "../runtime/pipeline/engine";
import {
  PipelineDefinition,
  ExecutionRequest,
  EXECUTION_CONTRACT_VERSION,
  DatasetSchema,
} from "../runtime/contracts/index";
import { QueryExecutor } from "../runtime/pipeline/transformations/types";

function createMockExecutor(): { executor: QueryExecutor; queryLog: string[] } {
  const queryLog: string[] = [];
  const tables = new Map<string, Record<string, unknown>[]>();

  // Seed raw table
  tables.set("raw_sales", [
    { order_id: 1, region: "North", revenue: 100 },
    { order_id: 2, region: "South", revenue: 200 },
    { order_id: 3, region: "North", revenue: 300 },
  ]);

  const executor: QueryExecutor = {
    async query<T = Record<string, unknown>>(sql: string) {
      queryLog.push(sql.trim());

      if (sql.includes("CREATE OR REPLACE TABLE")) {
        const match = sql.match(/CREATE OR REPLACE TABLE\s+"([^"]+)"/i);
        const tblName = match ? match[1] : "out";

        if (sql.includes("FAIL_NOW")) {
          throw new Error("Simulated query execution failure");
        }

        tables.set(tblName, [
          { order_id: 1, region: "North", revenue: 100 },
          { order_id: 3, region: "North", revenue: 300 },
        ]);
        return { columns: [], columnTypes: [], rows: [] as T[], rowCount: 2, durationMs: 2 };
      }

      if (sql.includes("LIMIT")) {
        const match = sql.match(/FROM\s+"([^"]+)"/i);
        const tblName = match ? match[1] : "raw_sales";
        const rows = (tables.get(tblName) || []) as T[];
        return {
          columns: ["order_id", "region", "revenue"],
          columnTypes: ["INTEGER", "VARCHAR", "DOUBLE"],
          rows,
          rowCount: rows.length,
          durationMs: 1,
        };
      }

      return { columns: [], columnTypes: [], rows: [] as T[], rowCount: 0, durationMs: 1 };
    },

    async getSchema(_tableName: string): Promise<DatasetSchema> {
      return {
        version: EXECUTION_CONTRACT_VERSION,
        columns: [
          { name: "order_id", dataType: "INTEGER", nullable: false, ordinalPosition: 1 },
          { name: "region", dataType: "STRING", nullable: false, ordinalPosition: 2 },
          { name: "revenue", dataType: "FLOAT", nullable: false, ordinalPosition: 3 },
        ],
        primaryKeys: ["order_id"],
      };
    },

    async getRowCount(tableName: string): Promise<number> {
      return tables.get(tableName)?.length ?? 2;
    },
  };

  return { executor, queryLog };
}

describe("Pipeline Execution Engine", () => {
  it("executes a multi-step pipeline successfully with checkpoints and multiset hashing", async () => {
    const { executor } = createMockExecutor();
    const progressEvents: string[] = [];

    const engine = new PipelineExecutionEngine({
      executor,
      onProgress: (evt) => {
        progressEvents.push(`${evt.stage}:${evt.percentComplete}`);
      },
    });

    const pipeline: PipelineDefinition = {
      version: EXECUTION_CONTRACT_VERSION,
      pipelineId: "pipe_success",
      name: "Successful Multi-Step Pipeline",
      nodes: [
        {
          nodeId: "step_filter",
          label: "Filter North Region",
          operationType: "filter_rows",
          parameters: { predicate: 'region == "North"' },
          inputNodeIds: [],
        },
        {
          nodeId: "step_derive",
          label: "Derive Tax",
          operationType: "derive_column",
          parameters: { new_column: "tax", expression: "revenue * 0.1" },
          inputNodeIds: ["step_filter"],
        },
      ],
      edges: [],
      sourceDatasets: { step_filter: "raw_sales" },
    };

    const request: ExecutionRequest = {
      version: EXECUTION_CONTRACT_VERSION,
      executionId: "exec_1",
      pipeline,
      runType: "BASELINE",
    };

    const result = await engine.execute(request);

    expect(result.status).toBe("COMPLETED");
    expect(result.topologicalOrder).toEqual(["step_filter", "step_derive"]);
    expect(result.stepResults["step_filter"].status).toBe("SUCCESS");
    expect(result.stepResults["step_derive"].status).toBe("SUCCESS");

    // Intermediate checkpoints
    expect(result.checkpoints.length).toBe(2);
    expect(result.checkpoints[0].stepId).toBe("step_filter");
    expect(result.checkpoints[0].contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.checkpoints[0].multisetHash).toMatch(/^[a-f0-9]{64}$/);

    // Progress events emitted
    expect(progressEvents.some((p) => p.startsWith("VALIDATING"))).toBe(true);
    expect(progressEvents.some((p) => p.startsWith("PLANNING"))).toBe(true);
    expect(progressEvents.some((p) => p.startsWith("EXECUTING"))).toBe(true);
    expect(progressEvents.some((p) => p.startsWith("COMPLETED"))).toBe(true);
  });

  it("handles fail-fast fault isolation: preserves upstream checkpoints and marks downstream as SKIPPED", async () => {
    const { executor } = createMockExecutor();

    const engine = new PipelineExecutionEngine({
      executor,
    });

    const pipeline: PipelineDefinition = {
      version: EXECUTION_CONTRACT_VERSION,
      pipelineId: "pipe_failfast",
      name: "Fail-Fast Pipeline",
      nodes: [
        {
          nodeId: "step_good",
          label: "Good Upstream",
          operationType: "select_columns",
          parameters: { columns: ["order_id", "revenue"] },
          inputNodeIds: [],
        },
        {
          nodeId: "step_failing",
          label: "Failing Step",
          operationType: "filter_rows",
          // Contains FAIL_NOW token triggering simulated error in mock executor
          parameters: { predicate: 'revenue > 100 and FAIL_NOW == 1' },
          inputNodeIds: ["step_good"],
        },
        {
          nodeId: "step_downstream",
          label: "Skipped Downstream",
          operationType: "derive_column",
          parameters: { new_column: "fee", expression: "revenue * 0.05" },
          inputNodeIds: ["step_failing"],
        },
      ],
      edges: [],
      sourceDatasets: { step_good: "raw_sales" },
    };

    const request: ExecutionRequest = {
      version: EXECUTION_CONTRACT_VERSION,
      executionId: "exec_fail",
      pipeline,
      runType: "INVESTIGATION_PROBE",
    };

    const result = await engine.execute(request);

    expect(result.status).toBe("FAILED");
    expect(result.failedStepId).toBe("step_failing");

    // Upstream step succeeded and checkpoint was preserved
    expect(result.stepResults["step_good"].status).toBe("SUCCESS");
    expect(result.checkpoints.some((c) => c.stepId === "step_good")).toBe(true);

    // Failing step recorded error
    expect(result.stepResults["step_failing"].status).toBe("FAILED");
    expect(result.stepResults["step_failing"].error).toBeDefined();

    // Downstream step was skipped
    expect(result.stepResults["step_downstream"].status).toBe("SKIPPED");
  });
});
