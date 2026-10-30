import { describe, it, expect } from "vitest";
import {
  EXECUTION_CONTRACT_VERSION,
  serializeDeterministic,
  DatasetSchema,
  PipelineDefinition,
} from "../runtime/contracts/index";
import { ERROR_CODES, RuntimeError } from "../runtime/contracts/errors";

describe("Runtime Contracts & Serialization", () => {
  it("enforces canonical execution contract version 1.0.0", () => {
    expect(EXECUTION_CONTRACT_VERSION).toBe("1.0.0");
  });

  it("produces deterministic serialization regardless of object key order", () => {
    const objA = {
      version: EXECUTION_CONTRACT_VERSION,
      b: 2,
      a: 1,
      nested: { z: 10, y: 20 },
    };

    const objB = {
      nested: { y: 20, z: 10 },
      a: 1,
      b: 2,
      version: EXECUTION_CONTRACT_VERSION,
    };

    const jsonA = serializeDeterministic(objA);
    const jsonB = serializeDeterministic(objB);

    expect(jsonA).toBe(jsonB);
    expect(jsonA).toBe(
      '{"a":1,"b":2,"nested":{"y":20,"z":10},"version":"1.0.0"}'
    );
  });

  it("handles primitive types, null, arrays, and booleans deterministically", () => {
    expect(serializeDeterministic(null)).toBe("null");
    expect(serializeDeterministic(12345)).toBe("12345");
    expect(serializeDeterministic("sample")).toBe('"sample"');
    expect(serializeDeterministic([3, 2, 1])).toBe("[3,2,1]");
    expect(serializeDeterministic({ list: ["a", "b"], flag: true })).toBe(
      '{"flag":true,"list":["a","b"]}'
    );
  });

  it("validates PipelineDefinition schema structure", () => {
    const pipeline: PipelineDefinition = {
      version: EXECUTION_CONTRACT_VERSION,
      pipelineId: "pipe_test_01",
      name: "Test Transformation",
      nodes: [
        {
          nodeId: "node_1",
          label: "Filter high value orders",
          operationType: "filter_rows",
          parameters: { predicate: "amount > 100" },
          inputNodeIds: ["input_source"],
        },
      ],
      edges: [{ sourceNodeId: "input_source", targetNodeId: "node_1" }],
      sourceDatasets: { input_source: "orders_2026" },
    };

    expect(pipeline.version).toBe("1.0.0");
    expect(pipeline.nodes).toHaveLength(1);
    expect(pipeline.edges).toHaveLength(1);
    expect(pipeline.sourceDatasets.input_source).toBe("orders_2026");
  });

  it("validates DatasetSchema column definitions", () => {
    const schema: DatasetSchema = {
      version: EXECUTION_CONTRACT_VERSION,
      columns: [
        { name: "id", dataType: "INTEGER", nullable: false, ordinalPosition: 1 },
        { name: "customer", dataType: "STRING", nullable: true, ordinalPosition: 2 },
        { name: "amount", dataType: "FLOAT", nullable: false, ordinalPosition: 3 },
      ],
      primaryKeys: ["id"],
    };

    expect(schema.columns).toHaveLength(3);
    expect(schema.columns[0].dataType).toBe("INTEGER");
    expect(schema.primaryKeys).toContain("id");
  });
});

describe("Structured Runtime Errors", () => {
  it("creates RuntimeError with code, remediation, and details", () => {
    const err = new RuntimeError(
      ERROR_CODES.CSV_FILE_TOO_LARGE,
      "File size 60MB exceeds limit",
      { byteSize: 60_000_000, maxBytes: 50_000_000 },
      "Reduce dataset to under 50 MB"
    );

    expect(err.name).toBe("RuntimeError");
    expect(err.code).toBe(ERROR_CODES.CSV_FILE_TOO_LARGE);
    expect(err.message).toBe("File size 60MB exceeds limit");
    expect(err.remediation).toBe("Reduce dataset to under 50 MB");
    expect(err.details?.byteSize).toBe(60_000_000);
  });

  it("converts between RuntimeError and ExecutionError contract", () => {
    const err = new RuntimeError(
      ERROR_CODES.SQL_SYNTAX_ERROR,
      "Syntax error near WHERE",
      { line: 1, col: 14 }
    );

    const execError = err.toExecutionError("step_query");
    expect(execError.code).toBe(ERROR_CODES.SQL_SYNTAX_ERROR);
    expect(execError.stepId).toBe("step_query");
    expect(execError.details?.col).toBe(14);
    expect(execError.timestamp).toBeDefined();

    const restoredErr = RuntimeError.fromExecutionError(execError);
    expect(restoredErr.code).toBe(execError.code);
    expect(restoredErr.message).toBe(execError.message);
    expect(restoredErr.details?.line).toBe(1);
  });
});
