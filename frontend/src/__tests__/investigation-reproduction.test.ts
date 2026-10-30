import { describe, it, expect } from "vitest";
import { ForensicInvestigationService } from "../runtime/forensics/service/investigation-service";
import { PipelineExecutionResult, PipelineDefinition, EXECUTION_CONTRACT_VERSION } from "../runtime/contracts/index";
import { CsvParser } from "../runtime/csv/parser";
import { DiagnosticRuleID, EODStatus, EvidenceTier } from "../runtime/forensics/contracts";

describe("Investigation Correctness & Explainability Overhaul Suite", () => {
  const csvOrders = `order_id,customer_id,amount,status
101,CUST-A,150.00,COMPLETED
102,CUST-B,25.50,PENDING
103,CUST-C,300.00,COMPLETED`;

  const csvInventory = `sku,warehouse,quantity,unit_cost
SKU-99,WH-EAST,500,12.50
SKU-100,WH-WEST,120,45.00
SKU-101,WH-NORTH,85,99.90
SKU-102,WH-SOUTH,12,350.00`;

  it("extracts distinct schemas, row counts, and sha256 fingerprints from different CSVs", async () => {
    const summaryOrders = await CsvParser.parseAndValidate(csvOrders);
    const summaryInventory = await CsvParser.parseAndValidate(csvInventory);

    expect(summaryOrders.rowCount).toBe(3);
    expect(summaryInventory.rowCount).toBe(4);

    expect(summaryOrders.columnCount).toBe(4);
    expect(summaryInventory.columnCount).toBe(4);

    expect(summaryOrders.headers).toEqual(["order_id", "customer_id", "amount", "status"]);
    expect(summaryInventory.headers).toEqual(["sku", "warehouse", "quantity", "unit_cost"]);

    expect(summaryOrders.sha256Hash).not.toBe(summaryInventory.sha256Hash);
  });

  it("proves distinct content-isolated dataset IDs even when files share identical filenames", async () => {
    const file1Content = "id,name,value\n1,Alpha,100";
    const file2Content = "id,name,value\n1,Alpha,200\n2,Beta,300";

    const s1 = await CsvParser.parseAndValidate(file1Content);
    const s2 = await CsvParser.parseAndValidate(file2Content);

    // Both files represent "data.csv"
    const cleanBase = "data";
    const id1 = `raw_${cleanBase}_${s1.sha256Hash.slice(0, 10)}`;
    const id2 = `raw_${cleanBase}_${s2.sha256Hash.slice(0, 10)}`;

    expect(id1).not.toBe(id2);
    expect(s1.rowCount).toBe(1);
    expect(s2.rowCount).toBe(2);
  });

  it("accurately classifies filter predicate parameter mutation as DR-02 and rejects false DR-01 input drift", async () => {
    const pipeline: PipelineDefinition = {
      version: EXECUTION_CONTRACT_VERSION,
      pipelineId: "pipe_filter_test",
      name: "Filter Pipeline",
      nodes: [
        {
          nodeId: "step_1_filter",
          operationType: "filter_rows",
          parameters: { predicate: "amount > 0" },
          inputNodeIds: [],
        },
      ],
      edges: [],
      sourceDatasets: { step_1_filter: "orders_table" },
    };

    const targetPipeline: PipelineDefinition = {
      ...pipeline,
      nodes: [
        {
          nodeId: "step_1_filter",
          operationType: "filter_rows",
          parameters: { predicate: "amount > 100" }, // Mutated predicate!
          inputNodeIds: [],
        },
      ],
    };

    const baselineExec: PipelineExecutionResult = {
      version: EXECUTION_CONTRACT_VERSION,
      executionId: "exec_base",
      pipelineId: "pipe_filter_test",
      status: "COMPLETED",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 5,
      stepResults: {
        step_1_filter: {
          stepId: "step_1_filter",
          status: "SUCCESS",
          rowCount: 3,
          columnCount: 4,
          durationMs: 2,
          schema: {
            version: EXECUTION_CONTRACT_VERSION,
            columns: [
              { name: "order_id", dataType: "STRING", nullable: false, ordinalPosition: 1 },
              { name: "amount", dataType: "FLOAT", nullable: false, ordinalPosition: 2 },
            ],
            primaryKeys: ["order_id"],
          },
          tableName: "t_base",
          contentHash: "hash_base_3_rows",
          multisetHash: "hash_base_3_rows",
          definitionHash: "def_amount_gt_0",
        },
      },
      topologicalOrder: ["step_1_filter"],
      checkpoints: [],
    };

    const targetExec: PipelineExecutionResult = {
      version: EXECUTION_CONTRACT_VERSION,
      executionId: "exec_target",
      pipelineId: "pipe_filter_test",
      status: "COMPLETED",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 5,
      stepResults: {
        step_1_filter: {
          stepId: "step_1_filter",
          status: "SUCCESS",
          rowCount: 2,
          columnCount: 4,
          durationMs: 2,
          schema: {
            version: EXECUTION_CONTRACT_VERSION,
            columns: [
              { name: "order_id", dataType: "STRING", nullable: false, ordinalPosition: 1 },
              { name: "amount", dataType: "FLOAT", nullable: false, ordinalPosition: 2 },
            ],
            primaryKeys: ["order_id"],
          },
          tableName: "t_target",
          contentHash: "hash_target_2_rows",
          multisetHash: "hash_target_2_rows",
          definitionHash: "def_amount_gt_100",
        },
      },
      topologicalOrder: ["step_1_filter"],
      checkpoints: [],
    };

    const report = await ForensicInvestigationService.runInvestigation({
      investigationId: "test_inv_filter_mutation",
      title: "Filter Mutation Investigation",
      baseline: baselineExec,
      target: targetExec,
      pipeline,
      targetPipeline,
      stepDataBaseline: {
        step_1_filter: [
          { order_id: "101", amount: 150.0 },
          { order_id: "102", amount: 25.5 },
          { order_id: "103", amount: 300.0 },
        ],
      },
      stepDataTarget: {
        step_1_filter: [
          { order_id: "101", amount: 150.0 },
          { order_id: "103", amount: 300.0 },
        ],
      },
      config: { primaryKey: ["order_id"] },
    });

    // Verify it is NOT diagnosed as Upstream Input Data Drift!
    expect(report.eodResult.status).toBe(EODStatus.EXACT_EOD);
    expect(report.eodResult.primary_eod_step).toBe("step_1_filter");
    expect(report.eodResult.divergence_category).toBe("Transformation Parameter Mutation");
    expect(report.findings[0]?.rule_id).toBe(DiagnosticRuleID.DR_02_ARITHMETIC_EXPRESSION_MUTATION);
    expect(report.findings[0]?.evidence_tier).toBe(EvidenceTier.CAUSAL_HYPOTHESIS_DIRECT_CODE_DIFF);

    // Verify 5-question structured explainability contract
    const sf = report.findings[0]?.structured_finding;
    expect(sf).toBeDefined();

    // 1. What went wrong?
    expect(sf?.what_went_wrong).toContain('modified from "amount > 0" to "amount > 100"');
    expect(sf?.what_went_wrong).toContain("1 rows to be excluded");

    // 2. Where did it go wrong?
    expect(sf?.where.step_id).toBe("step_1_filter");
    expect(sf?.where.operation).toBe("filter_rows");
    expect(sf?.where.affected_columns).toContain("order_id");

    // 3. What is the evidence?
    expect(sf?.evidence.baseline_row_count).toBe(3);
    expect(sf?.evidence.target_row_count).toBe(2);
    expect(sf?.evidence.row_delta).toBe(-1);
    expect(sf?.evidence.sample_records?.length).toBeGreaterThan(0);

    // 4. Why does it matter?
    expect(sf?.impact.risk_level).toBe("MEDIUM");
    expect(sf?.impact.consequence).toContain("Downstream calculations received 2 records instead of 3");

    // 5. How can I fix and verify it?
    expect(sf?.remediation.action).toContain('Restore the original filter predicate "amount > 0"');
    expect(sf?.remediation.verification_check).toContain("Confirm that step 'step_1_filter' emits exactly 3 rows");
  });

  it("accurately classifies genuine external source payload drift as DR-01 when parameters are identical", async () => {
    // Pipeline where step parameters are 100% identical between runs
    const pipeline: PipelineDefinition = {
      version: EXECUTION_CONTRACT_VERSION,
      pipelineId: "pipe_ingest_test",
      name: "Ingest Pipeline",
      nodes: [
        {
          nodeId: "step_1_ingest",
          operationType: "select_columns",
          parameters: { columns: ["order_id", "amount"] },
          inputNodeIds: [],
        },
      ],
      edges: [],
      sourceDatasets: { step_1_ingest: "vendor_orders.csv" },
    };

    // Baseline: 4 rows from vendor
    const baselineExec: PipelineExecutionResult = {
      version: EXECUTION_CONTRACT_VERSION,
      executionId: "exec_ingest_base",
      pipelineId: "pipe_ingest_test",
      status: "COMPLETED",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 5,
      stepResults: {
        step_1_ingest: {
          stepId: "step_1_ingest",
          status: "SUCCESS",
          rowCount: 4,
          columnCount: 2,
          durationMs: 2,
          schema: {
            version: EXECUTION_CONTRACT_VERSION,
            columns: [
              { name: "order_id", dataType: "STRING", nullable: false, ordinalPosition: 1 },
              { name: "amount", dataType: "FLOAT", nullable: false, ordinalPosition: 2 },
            ],
            primaryKeys: ["order_id"],
          },
          tableName: "t_ingest_base",
          contentHash: "hash_vendor_payload_v1",
          multisetHash: "hash_vendor_payload_v1",
          definitionHash: "def_select_cols",
        },
      },
      topologicalOrder: ["step_1_ingest"],
      checkpoints: [],
    };

    // Target: 5 rows from vendor (external drift, identical pipeline parameters)
    const targetExec: PipelineExecutionResult = {
      version: EXECUTION_CONTRACT_VERSION,
      executionId: "exec_ingest_target",
      pipelineId: "pipe_ingest_test",
      status: "COMPLETED",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 5,
      stepResults: {
        step_1_ingest: {
          stepId: "step_1_ingest",
          status: "SUCCESS",
          rowCount: 5,
          columnCount: 2,
          durationMs: 2,
          schema: {
            version: EXECUTION_CONTRACT_VERSION,
            columns: [
              { name: "order_id", dataType: "STRING", nullable: false, ordinalPosition: 1 },
              { name: "amount", dataType: "FLOAT", nullable: false, ordinalPosition: 2 },
            ],
            primaryKeys: ["order_id"],
          },
          tableName: "t_ingest_target",
          contentHash: "hash_vendor_payload_v2",
          multisetHash: "hash_vendor_payload_v2",
          definitionHash: "def_select_cols",
        },
      },
      topologicalOrder: ["step_1_ingest"],
      checkpoints: [],
    };

    const report = await ForensicInvestigationService.runInvestigation({
      investigationId: "test_inv_source_drift",
      title: "Upstream Drift Investigation",
      baseline: baselineExec,
      target: targetExec,
      pipeline,
      targetPipeline: pipeline, // Parameters IDENTICAL!
      stepDataBaseline: {
        step_1_ingest: [
          { order_id: "101", amount: 100 },
          { order_id: "102", amount: 150 },
          { order_id: "103", amount: 200 },
          { order_id: "104", amount: 80 },
        ],
      },
      stepDataTarget: {
        step_1_ingest: [
          { order_id: "101", amount: 120 }, // modified
          { order_id: "102", amount: 150 },
          { order_id: "103", amount: 200 },
          { order_id: "104", amount: 80 },
          { order_id: "105", amount: 300 }, // added
        ],
      },
      config: { primaryKey: ["order_id"] },
    });

    // Genuinely an upstream input data drift!
    expect(report.eodResult.status).toBe(EODStatus.UPSTREAM_INPUT_DATA_DRIFT);
    expect(report.eodResult.primary_eod_step).toBe("step_1_ingest");
    expect(report.findings[0]?.rule_id).toBe(DiagnosticRuleID.DR_01_UPSTREAM_INPUT_DATA_DRIFT);
    expect(report.findings[0]?.evidence_tier).toBe(EvidenceTier.CAUSAL_HYPOTHESIS_INPUT_DRIFT);

    const sf = report.findings[0]?.structured_finding;
    expect(sf?.what_went_wrong).toContain("The raw input dataset 'vendor_orders.csv' was modified");
    expect(sf?.evidence.baseline_row_count).toBe(4);
    expect(sf?.evidence.target_row_count).toBe(5);
    expect(sf?.evidence.row_delta).toBe(1);
    expect(sf?.impact.risk_level).toBe("CRITICAL");
    expect(sf?.remediation.action).toContain("Verify the upstream data provider's export timestamp");
  });

  it("produces completely independent investigation results on two distinct datasets", async () => {
    // Dataset A: Orders (3 rows)
    const ordersPipeline: PipelineDefinition = {
      version: EXECUTION_CONTRACT_VERSION,
      pipelineId: "pipe_orders",
      name: "Orders Pipeline",
      nodes: [
        {
          nodeId: "step_orders_filter",
          operationType: "filter_rows",
          parameters: { predicate: "amount > 50" },
          inputNodeIds: [],
        },
      ],
      edges: [],
      sourceDatasets: { step_orders_filter: "orders.csv" },
    };

    const ordersBase: PipelineExecutionResult = {
      version: EXECUTION_CONTRACT_VERSION,
      executionId: "orders_base",
      pipelineId: "pipe_orders",
      status: "COMPLETED",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 4,
      stepResults: {
        step_orders_filter: {
          stepId: "step_orders_filter",
          status: "SUCCESS",
          rowCount: 2,
          columnCount: 4,
          durationMs: 2,
          schema: {
            version: EXECUTION_CONTRACT_VERSION,
            columns: [
              { name: "order_id", dataType: "STRING", nullable: false, ordinalPosition: 1 },
              { name: "amount", dataType: "FLOAT", nullable: false, ordinalPosition: 2 },
            ],
            primaryKeys: ["order_id"],
          },
          tableName: "t_orders",
          contentHash: "hash_orders_base",
          multisetHash: "hash_orders_base",
          definitionHash: "def_orders",
        },
      },
      topologicalOrder: ["step_orders_filter"],
      checkpoints: [],
    };

    const ordersTarget: PipelineExecutionResult = {
      ...ordersBase,
      executionId: "orders_target",
      stepResults: {
        step_orders_filter: {
          ...ordersBase.stepResults.step_orders_filter,
          rowCount: 1, // Excluded more
          contentHash: "hash_orders_target",
        },
      },
    };

    const ordersTargetPipeline: PipelineDefinition = {
      ...ordersPipeline,
      nodes: [
        {
          ...ordersPipeline.nodes[0],
          parameters: { predicate: "amount > 200" },
        },
      ],
    };

    const ordersReport = await ForensicInvestigationService.runInvestigation({
      investigationId: "inv_dataset_orders",
      title: "Orders Investigation",
      baseline: ordersBase,
      target: ordersTarget,
      pipeline: ordersPipeline,
      targetPipeline: ordersTargetPipeline,
      stepDataBaseline: {
        step_orders_filter: [
          { order_id: "101", amount: 150.0 },
          { order_id: "103", amount: 300.0 },
        ],
      },
      stepDataTarget: {
        step_orders_filter: [{ order_id: "103", amount: 300.0 }],
      },
      config: { primaryKey: ["order_id"] },
    });

    // Dataset B: Inventory (4 rows)
    const invPipeline: PipelineDefinition = {
      version: EXECUTION_CONTRACT_VERSION,
      pipelineId: "pipe_inventory",
      name: "Inventory Pipeline",
      nodes: [
        {
          nodeId: "step_inv_filter",
          operationType: "filter_rows",
          parameters: { predicate: "quantity >= 100" },
          inputNodeIds: [],
        },
      ],
      edges: [],
      sourceDatasets: { step_inv_filter: "inventory.csv" },
    };

    const invBase: PipelineExecutionResult = {
      version: EXECUTION_CONTRACT_VERSION,
      executionId: "inv_base",
      pipelineId: "pipe_inventory",
      status: "COMPLETED",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 4,
      stepResults: {
        step_inv_filter: {
          stepId: "step_inv_filter",
          status: "SUCCESS",
          rowCount: 2,
          columnCount: 4,
          durationMs: 2,
          schema: {
            version: EXECUTION_CONTRACT_VERSION,
            columns: [
              { name: "sku", dataType: "STRING", nullable: false, ordinalPosition: 1 },
              { name: "quantity", dataType: "INTEGER", nullable: false, ordinalPosition: 2 },
            ],
            primaryKeys: ["sku"],
          },
          tableName: "t_inventory",
          contentHash: "hash_inv_base",
          multisetHash: "hash_inv_base",
          definitionHash: "def_inv",
        },
      },
      topologicalOrder: ["step_inv_filter"],
      checkpoints: [],
    };

    const invTarget: PipelineExecutionResult = {
      ...invBase,
      executionId: "inv_target",
      stepResults: {
        step_inv_filter: {
          ...invBase.stepResults.step_inv_filter,
          rowCount: 4, // All pass
          contentHash: "hash_inv_target",
        },
      },
    };

    const invTargetPipeline: PipelineDefinition = {
      ...invPipeline,
      nodes: [
        {
          ...invPipeline.nodes[0],
          parameters: { predicate: "quantity >= 0" },
        },
      ],
    };

    const inventoryReport = await ForensicInvestigationService.runInvestigation({
      investigationId: "inv_dataset_inventory",
      title: "Inventory Investigation",
      baseline: invBase,
      target: invTarget,
      pipeline: invPipeline,
      targetPipeline: invTargetPipeline,
      stepDataBaseline: {
        step_inv_filter: [
          { sku: "SKU-99", quantity: 500 },
          { sku: "SKU-100", quantity: 120 },
        ],
      },
      stepDataTarget: {
        step_inv_filter: [
          { sku: "SKU-99", quantity: 500 },
          { sku: "SKU-100", quantity: 120 },
          { sku: "SKU-101", quantity: 85 },
          { sku: "SKU-102", quantity: 12 },
        ],
      },
      config: { primaryKey: ["sku"] },
    });

    // Prove both reports are completely distinct in schemas, steps, row deltas, and findings:
    expect(ordersReport.investigation.investigation_id).toBe("inv_dataset_orders");
    expect(inventoryReport.investigation.investigation_id).toBe("inv_dataset_inventory");

    expect(ordersReport.eodResult.primary_eod_step).toBe("step_orders_filter");
    expect(inventoryReport.eodResult.primary_eod_step).toBe("step_inv_filter");

    const ordersSf = ordersReport.findings[0]?.structured_finding;
    const invSf = inventoryReport.findings[0]?.structured_finding;

    expect(ordersSf?.where.affected_columns).toEqual(["order_id", "amount"]);
    expect(invSf?.where.affected_columns).toEqual(["sku", "quantity"]);

    expect(ordersSf?.evidence.row_delta).toBe(-1); // 2 -> 1 rows
    expect(invSf?.evidence.row_delta).toBe(2); // 2 -> 4 rows

    expect(ordersSf?.what_went_wrong).toContain('modified from "amount > 50" to "amount > 200"');
    expect(invSf?.what_went_wrong).toContain('modified from "quantity >= 100" to "quantity >= 0"');
  });
});
