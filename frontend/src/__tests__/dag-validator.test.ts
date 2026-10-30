import { describe, it, expect } from "vitest";
import { validatePipeline } from "../runtime/pipeline/dag-validator";
import { PipelineDefinition, EXECUTION_CONTRACT_VERSION } from "../runtime/contracts/index";
import { ERROR_CODES } from "../runtime/contracts/errors";

describe("DAG Validation Engine", () => {
  it("rejects an empty pipeline", () => {
    const pipeline: PipelineDefinition = {
      version: EXECUTION_CONTRACT_VERSION,
      pipelineId: "empty-pipe",
      name: "Empty",
      nodes: [],
      edges: [],
      sourceDatasets: {},
    };

    const res = validatePipeline(pipeline);
    expect(res.valid).toBe(false);
    expect(res.issues.some((i) => i.code === ERROR_CODES.EMPTY_PIPELINE)).toBe(true);
  });

  it("detects duplicate node IDs", () => {
    const pipeline: PipelineDefinition = {
      version: EXECUTION_CONTRACT_VERSION,
      pipelineId: "dup-pipe",
      name: "Duplicate",
      nodes: [
        {
          nodeId: "step1",
          operationType: "select_columns",
          parameters: { columns: ["id", "val"] },
          inputNodeIds: [],
        },
        {
          nodeId: "step1",
          operationType: "drop_columns",
          parameters: { columns: ["val"] },
          inputNodeIds: [],
        },
      ],
      edges: [],
      sourceDatasets: { step1: "datasetA" },
    };

    const res = validatePipeline(pipeline);
    expect(res.valid).toBe(false);
    expect(res.issues.some((i) => i.code === ERROR_CODES.DUPLICATE_NODE_ID)).toBe(true);
  });

  it("detects missing node references in edges", () => {
    const pipeline: PipelineDefinition = {
      version: EXECUTION_CONTRACT_VERSION,
      pipelineId: "missing-ref-pipe",
      name: "Missing Ref",
      nodes: [
        {
          nodeId: "step1",
          operationType: "select_columns",
          parameters: { columns: ["id"] },
          inputNodeIds: [],
        },
      ],
      edges: [
        { sourceNodeId: "step1", targetNodeId: "nonexistent_step" },
      ],
      sourceDatasets: { step1: "datasetA" },
    };

    const res = validatePipeline(pipeline);
    expect(res.valid).toBe(false);
    expect(res.issues.some((i) => i.code === ERROR_CODES.MISSING_NODE_REFERENCE)).toBe(true);
  });

  it("detects self-dependencies (self-loops)", () => {
    const pipeline: PipelineDefinition = {
      version: EXECUTION_CONTRACT_VERSION,
      pipelineId: "self-loop-pipe",
      name: "Self Loop",
      nodes: [
        {
          nodeId: "step1",
          operationType: "select_columns",
          parameters: { columns: ["id"] },
          inputNodeIds: ["step1"],
        },
      ],
      edges: [],
      sourceDatasets: {},
    };

    const res = validatePipeline(pipeline);
    expect(res.valid).toBe(false);
    expect(res.issues.some((i) => i.code === ERROR_CODES.SELF_DEPENDENCY)).toBe(true);
  });

  it("detects cycles and reports exact cycle path", () => {
    // A -> B -> C -> A
    const pipeline: PipelineDefinition = {
      version: EXECUTION_CONTRACT_VERSION,
      pipelineId: "cyclic-pipe",
      name: "Cyclic",
      nodes: [
        {
          nodeId: "nodeA",
          operationType: "select_columns",
          parameters: { columns: ["id"] },
          inputNodeIds: ["nodeC"],
        },
        {
          nodeId: "nodeB",
          operationType: "select_columns",
          parameters: { columns: ["id"] },
          inputNodeIds: ["nodeA"],
        },
        {
          nodeId: "nodeC",
          operationType: "select_columns",
          parameters: { columns: ["id"] },
          inputNodeIds: ["nodeB"],
        },
      ],
      edges: [],
      sourceDatasets: {},
    };

    const res = validatePipeline(pipeline);
    expect(res.valid).toBe(false);
    const cycleIssue = res.issues.find((i) => i.code === ERROR_CODES.CYCLIC_DEPENDENCY);
    expect(cycleIssue).toBeDefined();
    expect(cycleIssue?.message).toContain("nodeA");
    expect(cycleIssue?.message).toContain("nodeB");
    expect(cycleIssue?.message).toContain("nodeC");
  });

  it("enforces join cardinality: requires exactly 2 inputs", () => {
    const singleInputJoin: PipelineDefinition = {
      version: EXECUTION_CONTRACT_VERSION,
      pipelineId: "join-fail-pipe",
      name: "Join Fail",
      nodes: [
        {
          nodeId: "step1",
          operationType: "select_columns",
          parameters: { columns: ["id"] },
          inputNodeIds: [],
        },
        {
          nodeId: "stepJoin",
          operationType: "join_datasets",
          parameters: { join_type: "inner", left_on: ["id"], right_on: ["id"] },
          inputNodeIds: ["step1"], // Only 1 input!
        },
      ],
      edges: [],
      sourceDatasets: { step1: "datasetA" },
    };

    const res = validatePipeline(singleInputJoin);
    expect(res.valid).toBe(false);
    expect(res.issues.some((i) => i.code === ERROR_CODES.INVALID_JOIN_CARDINALITY)).toBe(true);
  });

  it("enforces single input cardinality for non-join steps", () => {
    const multiInputFilter: PipelineDefinition = {
      version: EXECUTION_CONTRACT_VERSION,
      pipelineId: "multi-input-pipe",
      name: "Multi Input Fail",
      nodes: [
        {
          nodeId: "step1",
          operationType: "select_columns",
          parameters: { columns: ["id"] },
          inputNodeIds: [],
        },
        {
          nodeId: "step2",
          operationType: "select_columns",
          parameters: { columns: ["val"] },
          inputNodeIds: [],
        },
        {
          nodeId: "stepFilter",
          operationType: "filter_rows",
          parameters: { predicate: "id > 0" },
          inputNodeIds: ["step1", "step2"], // Invalid: 2 inputs for filter_rows
        },
      ],
      edges: [],
      sourceDatasets: { step1: "datasetA", step2: "datasetB" },
    };

    const res = validatePipeline(multiInputFilter);
    expect(res.valid).toBe(false);
    expect(res.issues.some((i) => i.code === ERROR_CODES.INVALID_STEP_CARDINALITY)).toBe(true);
  });

  it("validates parameters for all transformations and rejects syntax errors in expressions", () => {
    const invalidParamsPipe: PipelineDefinition = {
      version: EXECUTION_CONTRACT_VERSION,
      pipelineId: "bad-params-pipe",
      name: "Bad Params",
      nodes: [
        {
          nodeId: "bad_filter",
          operationType: "filter_rows",
          parameters: { predicate: "amount >> INVALID_SYNTAX @" }, // Expression syntax error
          inputNodeIds: [],
        },
        {
          nodeId: "bad_missing",
          operationType: "handle_missing",
          parameters: { columns: ["val"], strategy: "fill_literal" }, // Missing 'value' parameter
          inputNodeIds: [],
        },
      ],
      edges: [],
      sourceDatasets: { bad_filter: "data1", bad_missing: "data2" },
    };

    const res = validatePipeline(invalidParamsPipe);
    expect(res.valid).toBe(false);
    expect(
      res.issues.some((i) => i.code === ERROR_CODES.EXPRESSION_SYNTAX_ERROR || i.nodeId === "bad_filter")
    ).toBe(true);
    expect(
      res.issues.some((i) => i.nodeId === "bad_missing" && i.code === ERROR_CODES.MISSING_PARAMETER)
    ).toBe(true);
  });

  it("accepts a fully valid DAG with joins and transformations", () => {
    const validPipe: PipelineDefinition = {
      version: EXECUTION_CONTRACT_VERSION,
      pipelineId: "valid-pipe",
      name: "Valid Pipeline",
      nodes: [
        {
          nodeId: "in_orders",
          operationType: "select_columns",
          parameters: { columns: ["order_id", "customer_id", "total"] },
          inputNodeIds: [],
        },
        {
          nodeId: "in_customers",
          operationType: "select_columns",
          parameters: { columns: ["customer_id", "name", "country"] },
          inputNodeIds: [],
        },
        {
          nodeId: "join_step",
          operationType: "join_datasets",
          parameters: { join_type: "inner", left_on: ["customer_id"], right_on: ["customer_id"] },
          inputNodeIds: ["in_orders", "in_customers"],
        },
        {
          nodeId: "derive_step",
          operationType: "derive_column",
          parameters: { new_column: "discounted_total", expression: "total * 0.9" },
          inputNodeIds: ["join_step"],
        },
      ],
      edges: [],
      sourceDatasets: { in_orders: "orders_raw", in_customers: "customers_raw" },
    };

    const res = validatePipeline(validPipe);
    expect(res.valid).toBe(true);
    expect(res.issues.filter((i) => i.severity === "ERROR").length).toBe(0);
  });
});
