import { describe, it, expect } from "vitest";
import { createExecutionPlan } from "../runtime/pipeline/planner";
import { PipelineDefinition, EXECUTION_CONTRACT_VERSION } from "../runtime/contracts/index";

describe("Deterministic Execution Planner", () => {
  it("generates deterministic topological order with lexicographical tie-breaking", () => {
    // 3 parallel entry nodes: 'zeta', 'alpha', 'beta'
    // They all feed into 'agg'
    const pipeline: PipelineDefinition = {
      version: EXECUTION_CONTRACT_VERSION,
      pipelineId: "diamond-pipeline",
      name: "Deterministic Tie-breaking Test",
      nodes: [
        {
          nodeId: "zeta",
          operationType: "select_columns",
          parameters: { columns: ["id"] },
          inputNodeIds: [],
        },
        {
          nodeId: "alpha",
          operationType: "select_columns",
          parameters: { columns: ["id"] },
          inputNodeIds: [],
        },
        {
          nodeId: "beta",
          operationType: "select_columns",
          parameters: { columns: ["id"] },
          inputNodeIds: [],
        },
      ],
      edges: [],
      sourceDatasets: {
        zeta: "dataZ",
        alpha: "dataA",
        beta: "dataB",
      },
    };

    const plan1 = createExecutionPlan(pipeline);
    const plan2 = createExecutionPlan(pipeline);

    // Order must be strictly alphabetical in stage 0: ['alpha', 'beta', 'zeta']
    expect(plan1.topologicalOrder).toEqual(["alpha", "beta", "zeta"]);
    expect(plan2.topologicalOrder).toEqual(["alpha", "beta", "zeta"]);
    expect(plan1.tieBreakerApplied).toBe(true);
    expect(plan1.stages).toEqual([["alpha", "beta", "zeta"]]);
  });

  it("partitions multi-stage pipelines into dependency stages", () => {
    // Stage 0: raw_a, raw_b
    // Stage 1: join_ab
    // Stage 2: filter_c
    const pipeline: PipelineDefinition = {
      version: EXECUTION_CONTRACT_VERSION,
      pipelineId: "staged-pipe",
      name: "Staged",
      nodes: [
        {
          nodeId: "raw_b",
          operationType: "select_columns",
          parameters: { columns: ["id", "val"] },
          inputNodeIds: [],
        },
        {
          nodeId: "raw_a",
          operationType: "select_columns",
          parameters: { columns: ["id", "name"] },
          inputNodeIds: [],
        },
        {
          nodeId: "join_ab",
          operationType: "join_datasets",
          parameters: { join_type: "inner", left_on: ["id"], right_on: ["id"] },
          inputNodeIds: ["raw_a", "raw_b"],
        },
        {
          nodeId: "filter_c",
          operationType: "filter_rows",
          parameters: { predicate: "id > 10" },
          inputNodeIds: ["join_ab"],
        },
      ],
      edges: [],
      sourceDatasets: { raw_a: "table_a", raw_b: "table_b" },
    };

    const plan = createExecutionPlan(pipeline);
    expect(plan.stages).toEqual([
      ["raw_a", "raw_b"],
      ["join_ab"],
      ["filter_c"],
    ]);
    expect(plan.topologicalOrder).toEqual(["raw_a", "raw_b", "join_ab", "filter_c"]);
    expect(plan.stepInputs["join_ab"]).toEqual(["raw_a", "raw_b"]);
    expect(plan.stepInputs["filter_c"]).toEqual(["join_ab"]);
  });
});
