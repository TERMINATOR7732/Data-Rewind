/**
 * Unit & Integration Test Suite: Column Lineage & Downstream Blast Radius.
 * Conforms to SPEC-MOD-03 §2.1 and SPEC-MOD-04 §2.1.
 */

import { describe, it, expect } from "vitest";
import {
  ColumnLineageTracker,
  BlastRadiusEngine,
  ForensicInvestigationService,
  TaintStatus,
} from "../runtime/forensics/index";
import { PipelineDefinition, PipelineExecutionResult } from "../runtime/contracts/index";

describe("Column-Level Forensic Lineage Engine", () => {
  const samplePipeline: PipelineDefinition = {
    version: "1.0.0",
    pipelineId: "pipe_lineage_test",
    name: "Lineage Testing Pipeline",
    sourceDatasets: {
      step_1_raw: "transactions_csv",
      step_dim: "customers_csv",
    },
    nodes: [
      {
        nodeId: "step_1_raw",
        operationType: "select_columns",
        parameters: { columns: ["tx_id", "cust_id", "subtotal", "tax_rate"] },
        inputNodeIds: [],
      },
      {
        nodeId: "step_dim",
        operationType: "select_columns",
        parameters: { columns: ["customer_id", "tier", "region"] },
        inputNodeIds: [],
      },
      {
        nodeId: "step_2_derive",
        operationType: "derive_column",
        parameters: { target_column: "total_tax", expression: "subtotal * tax_rate" },
        inputNodeIds: ["step_1_raw"],
      },
      {
        nodeId: "step_3_rename",
        operationType: "rename_columns",
        parameters: { column_mapping: { total_tax: "calculated_tax" } },
        inputNodeIds: ["step_2_derive"],
      },
      {
        nodeId: "step_4_join",
        operationType: "join_datasets",
        parameters: { left_on: "cust_id", right_on: "customer_id", how: "inner" },
        inputNodeIds: ["step_3_rename", "step_dim"],
      },
    ],
    edges: [
      { sourceNodeId: "step_1_raw", targetNodeId: "step_2_derive" },
      { sourceNodeId: "step_2_derive", targetNodeId: "step_3_rename" },
      { sourceNodeId: "step_3_rename", targetNodeId: "step_4_join" },
      { sourceNodeId: "step_dim", targetNodeId: "step_4_join" },
    ],
  };

  it("extracts AST identifiers and traces derived column inputs", () => {
    const lineage = ColumnLineageTracker.traceColumnLineage(
      samplePipeline,
      "step_2_derive",
      "total_tax"
    );

    expect(lineage.is_derived).toBe(true);
    expect(lineage.producing_operation).toBe("derive_column");
    expect(lineage.direct_input_columns).toContain("subtotal");
    expect(lineage.direct_input_columns).toContain("tax_rate");
    expect(lineage.upstream_sources).toHaveLength(2);
    expect(lineage.upstream_sources.some((s) => s.source_column === "subtotal")).toBe(true);
    expect(lineage.upstream_sources.some((s) => s.source_column === "tax_rate")).toBe(true);
  });

  it("traces renamed column backwards across transformations to original source dataset", () => {
    const lineage = ColumnLineageTracker.traceColumnLineage(
      samplePipeline,
      "step_3_rename",
      "calculated_tax"
    );

    expect(lineage.target_column).toBe("calculated_tax");
    expect(lineage.direct_input_columns).toContain("total_tax");
    expect(lineage.upstream_sources.some((s) => s.source_dataset === "transactions_csv")).toBe(true);
  });

  it("traces joined table columns to left and right parent datasets", () => {
    const lineageCust = ColumnLineageTracker.traceColumnLineage(
      samplePipeline,
      "step_4_join",
      "cust_id"
    );
    expect(lineageCust.upstream_sources[0].source_dataset).toBe("transactions_csv");

    const lineageTier = ColumnLineageTracker.traceColumnLineage(
      samplePipeline,
      "step_4_join",
      "tier"
    );
    expect(lineageTier.upstream_sources[0].source_dataset).toBe("customers_csv");
  });
});

describe("Downstream Blast Radius & BFS Taint Propagation Engine", () => {
  const dagOrder = ["raw_a", "raw_b", "step_transform_a", "step_transform_b", "step_join", "step_sink_1", "step_sink_2"];
  const dagDeps = {
    raw_a: [],
    raw_b: [],
    step_transform_a: ["raw_a"],
    step_transform_b: ["raw_b"],
    step_join: ["step_transform_a", "step_transform_b"],
    step_sink_1: ["step_join"],
    step_sink_2: ["step_join"],
  };

  it("categorizes UNTAINTED vs CONFIRMED_AFFECTED vs POTENTIALLY_AFFECTED nodes", () => {
    // Failure at step_transform_a:
    // raw_a, raw_b, step_transform_b should be UNTAINTED.
    // step_transform_a is ORIGIN divergent.
    // step_join, step_sink_1 are CONFIRMED_AFFECTED (divergent hashes).
    // step_sink_2 is POTENTIALLY_AFFECTED (no target hash).
    const report = BlastRadiusEngine.computeBlastRadius({
      originDivergentStepIds: ["step_transform_a"],
      topologicalOrder: dagOrder,
      stepDependencies: dagDeps,
      stepOutputsBaseline: {
        step_transform_a: { outputHash: "ha_base" },
        step_join: { outputHash: "hj_base" },
        step_sink_1: { outputHash: "hs1_base" },
        step_sink_2: { outputHash: "hs2_base" },
      },
      stepOutputsTarget: {
        step_transform_a: { outputHash: "ha_targ" }, // divergent
        step_join: { outputHash: "hj_targ" }, // divergent
        step_sink_1: { outputHash: "hs1_targ" }, // divergent
        // step_sink_2 target hash missing
      },
    });

    expect(report.untainted_step_ids).toContain("raw_a");
    expect(report.untainted_step_ids).toContain("raw_b");
    expect(report.untainted_step_ids).toContain("step_transform_b");

    expect(report.nodes["step_transform_a"].taint_status).toBe(TaintStatus.CONFIRMED_AFFECTED);
    expect(report.nodes["step_transform_a"].is_origin).toBe(true);

    expect(report.nodes["step_join"].taint_status).toBe(TaintStatus.CONFIRMED_AFFECTED);
    expect(report.nodes["step_sink_1"].taint_status).toBe(TaintStatus.CONFIRMED_AFFECTED);
    expect(report.nodes["step_sink_2"].taint_status).toBe(TaintStatus.POTENTIALLY_AFFECTED);

    // Terminal sinks identification
    expect(report.affected_terminal_sinks).toContain("step_sink_1");
    expect(report.affected_terminal_sinks).toContain("step_sink_2");

    // Blast radius ratio: 4 tainted nodes out of 7 total nodes
    expect(report.tainted_nodes_count).toBe(4);
    expect(report.total_nodes_count).toBe(7);
    expect(report.blast_radius_ratio).toBeCloseTo(4 / 7, 3);
  });

  it("detects MASKED_UNAFFECTED nodes when downstream node filters out upstream corruption", () => {
    // If step_join had different inputs but identical output hash, it masked the fault
    const report = BlastRadiusEngine.computeBlastRadius({
      originDivergentStepIds: ["step_transform_a"],
      topologicalOrder: ["step_transform_a", "step_join"],
      stepDependencies: {
        step_transform_a: [],
        step_join: ["step_transform_a"],
      },
      stepOutputsBaseline: {
        step_transform_a: { outputHash: "hA_base" },
        step_join: { outputHash: "hJ_identical" },
      },
      stepOutputsTarget: {
        step_transform_a: { outputHash: "hA_diverged" },
        step_join: { outputHash: "hJ_identical" }, // identical output!
      },
    });

    expect(report.nodes["step_join"].taint_status).toBe(TaintStatus.MASKED_UNAFFECTED);
    expect(report.masked_step_ids).toContain("step_join");
  });
});

describe("In-Browser Forensic Investigation Service", () => {
  const pipeline: PipelineDefinition = {
    version: "1.0.0",
    pipelineId: "pipe_probe",
    name: "Probe Pipeline",
    nodes: [
      {
        nodeId: "step_ingest",
        operationType: "select_columns",
        parameters: { columns: ["id", "val"] },
        inputNodeIds: [],
      },
      {
        nodeId: "step_derive",
        operationType: "derive_column",
        parameters: { target_column: "val", expression: "val * 2" },
        inputNodeIds: ["step_ingest"],
      },
    ],
    edges: [{ sourceNodeId: "step_ingest", targetNodeId: "step_derive" }],
    sourceDatasets: { step_ingest: "raw_data" },
  };

  const baselineExecution: PipelineExecutionResult = {
    version: "1.0.0",
    executionId: "base_001",
    pipelineId: "pipe_probe",
    status: "COMPLETED",
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: 12,
    stepResults: {
      step_ingest: {
        stepId: "step_ingest",
        status: "SUCCESS",
        rowCount: 3,
        columnCount: 2,
        durationMs: 2,
        schema: {
          version: "1.0.0",
          columns: [
            { name: "id", dataType: "STRING", nullable: false, ordinalPosition: 0 },
            { name: "val", dataType: "INTEGER", nullable: false, ordinalPosition: 1 },
          ],
          primaryKeys: ["id"],
        },
        tableName: "base_ingest",
        contentHash: "hash_in_clean",
        multisetHash: "hash_in_clean",
        definitionHash: "def_in",
      },
      step_derive: {
        stepId: "step_derive",
        status: "SUCCESS",
        rowCount: 3,
        columnCount: 2,
        durationMs: 3,
        schema: {
          version: "1.0.0",
          columns: [
            { name: "id", dataType: "STRING", nullable: false, ordinalPosition: 0 },
            { name: "val", dataType: "INTEGER", nullable: false, ordinalPosition: 1 },
          ],
          primaryKeys: ["id"],
        },
        tableName: "base_derive",
        contentHash: "hash_out_clean",
        multisetHash: "hash_out_clean",
        definitionHash: "def_derive",
      },
    },
    topologicalOrder: ["step_ingest", "step_derive"],
    checkpoints: [],
  };

  const targetExecution: PipelineExecutionResult = {
    version: "1.0.0",
    executionId: "targ_002",
    pipelineId: "pipe_probe",
    status: "COMPLETED",
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: 14,
    stepResults: {
      step_ingest: {
        stepId: "step_ingest",
        status: "SUCCESS",
        rowCount: 3,
        columnCount: 2,
        durationMs: 2,
        schema: {
          version: "1.0.0",
          columns: [
            { name: "id", dataType: "STRING", nullable: false, ordinalPosition: 0 },
            { name: "val", dataType: "INTEGER", nullable: false, ordinalPosition: 1 },
          ],
          primaryKeys: ["id"],
        },
        tableName: "targ_ingest",
        contentHash: "hash_in_clean",
        multisetHash: "hash_in_clean",
        definitionHash: "def_in",
      },
      step_derive: {
        stepId: "step_derive",
        status: "SUCCESS",
        rowCount: 3,
        columnCount: 2,
        durationMs: 3,
        schema: {
          version: "1.0.0",
          columns: [
            { name: "id", dataType: "STRING", nullable: false, ordinalPosition: 0 },
            { name: "val", dataType: "INTEGER", nullable: false, ordinalPosition: 1 },
          ],
          primaryKeys: ["id"],
        },
        tableName: "targ_derive",
        contentHash: "hash_out_faulted",
        multisetHash: "hash_out_faulted",
        definitionHash: "def_derive",
      },
    },
    topologicalOrder: ["step_ingest", "step_derive"],
    checkpoints: [],
  };

  it("runs full investigation, creates investigation report and provides paged diffs", async () => {
    const rawData = [
      { id: "1", val: 10 },
      { id: "2", val: 20 },
      { id: "3", val: 30 },
    ];
    const baseDerive = [
      { id: "1", val: 20 },
      { id: "2", val: 40 },
      { id: "3", val: 60 },
    ];
    const targetDerive = [
      { id: "1", val: 20 },
      { id: "2", val: 999 }, // modified row!
      { id: "3", val: 60 },
    ];

    const report = await ForensicInvestigationService.runInvestigation({
      investigationId: "inv_test_001",
      baseline: baselineExecution,
      target: targetExecution,
      pipeline,
      config: { primaryKey: ["id"] },
      stepDataBaseline: {
        step_ingest: rawData,
        step_derive: baseDerive,
      },
      stepDataTarget: {
        step_ingest: rawData,
        step_derive: targetDerive,
      },
    });

    expect(report.investigation.investigation_id).toBe("inv_test_001");
    expect(report.investigation.eod_result.primary_eod_step).toBe("step_derive");
    expect(report.investigation.status).toBe("DIVERGENT");

    // Test Paged Diff retrieval
    const pagedAll = ForensicInvestigationService.getStepDiff("inv_test_001", "step_derive", "ALL", 1, 10);
    expect(pagedAll.total_matching_rows).toBe(3);

    const pagedModified = ForensicInvestigationService.getStepDiff("inv_test_001", "step_derive", "MODIFIED", 1, 10);
    expect(pagedModified.total_matching_rows).toBe(1);
    expect(pagedModified.rows[0].key_values).toEqual({ id: "2" });

    // Test list investigations
    const list = ForensicInvestigationService.listInvestigations();
    expect(list.some((inv) => inv.investigation_id === "inv_test_001")).toBe(true);
  });
});
