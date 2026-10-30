/**
 * Browser-First Canonical Demonstration Scenarios (SCN-01 to SCN-04).
 * Pure offline-first execution via In-Browser Forensic Intelligence Engine.
 * Conforms strictly to SPEC-MOD-01, SPEC-MOD-03, SPEC-MOD-04, SPEC-MOD-05.
 */

import { ForensicDossier, Investigation, ScenarioSummary } from "../../types/api";
import {
  PipelineDefinition,
  PipelineExecutionResult,
  ExecutionPlan,
  EXECUTION_CONTRACT_VERSION,
  StepOutput,
} from "../../runtime/contracts/index";
import {
  DiagnosticRuleID,
  ForensicInvestigationService,
} from "../../runtime/forensics/index";
import { TriRunVerifier } from "../../runtime/verification/tri-run-verifier";
import { RunManifest } from "../../runtime/storage/run-manifest";
import { indexedDBStorage, StoredInvestigation } from "../../runtime/storage/indexeddb";

export interface CanonicalDemoScenario {
  scenario_id: string;
  title: string;
  description: string;
  expected_eod_step: string;
  expected_rule_id: DiagnosticRuleID;
  step_count: number;
  pipeline: PipelineDefinition;
  targetPipeline?: PipelineDefinition;
  baselineStepData: Record<string, Record<string, unknown>[]>;
  targetStepData: Record<string, Record<string, unknown>[]>;
  primaryKeysByStep: Record<string, string[]>;
}

function computeDataHash(stepId: string, rows: Record<string, unknown>[]): string {
  const str = JSON.stringify(rows);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return `h_${stepId}_${(hash >>> 0).toString(16)}`;
}

function makeStepOutput(
  stepId: string,
  rows: Record<string, unknown>[],
  hash: string,
  primaryKeys: string[] = []
): StepOutput {
  const firstRow = rows[0] || {};
  const columns = Object.keys(firstRow).map((colName, idx) => ({
    name: colName,
    dataType: (typeof firstRow[colName] === "number" ? "DOUBLE" : "VARCHAR") as any,
    nullable: true,
    ordinalPosition: idx,
  }));

  return {
    stepId,
    status: "SUCCESS",
    rowCount: rows.length,
    columnCount: columns.length,
    durationMs: 4,
    schema: {
      version: "1.0.0",
      columns,
      primaryKeys,
    },
    tableName: `step_${stepId}`,
    previewRows: rows,
    contentHash: hash,
    multisetHash: hash,
    definitionHash: `def_${stepId}`,
  };
}

// ---------------------------------------------------------------------------
// 1. SCN-01: Upstream Vendor Input Data Drift
// ---------------------------------------------------------------------------
const scn01Pipeline: PipelineDefinition = {
  version: EXECUTION_CONTRACT_VERSION,
  pipelineId: "pipeline_scn01",
  name: "SCN-01 Orders Ingestion & Regional Aggregation",
  nodes: [
    {
      nodeId: "ingest_orders",
      label: "Ingest Raw Orders",
      operationType: "filter_rows",
      parameters: { predicate: "order_id > 0", primary_keys: ["order_id"] },
      inputNodeIds: [],
    },
    {
      nodeId: "filter_completed",
      label: "Filter Completed Orders",
      operationType: "filter_rows",
      parameters: { predicate: "status == 'COMPLETED'", primary_keys: ["order_id"] },
      inputNodeIds: ["ingest_orders"],
    },
    {
      nodeId: "aggregate_revenue",
      label: "Aggregate Regional Revenue",
      operationType: "aggregate_group_by",
      parameters: {
        group_keys: ["region"],
        aggregations: [{ column: "amount", func: "sum", alias: "total_revenue" }],
        primary_keys: ["region"],
      },
      inputNodeIds: ["filter_completed"],
    },
  ],
  edges: [
    { sourceNodeId: "ingest_orders", targetNodeId: "filter_completed" },
    { sourceNodeId: "filter_completed", targetNodeId: "aggregate_revenue" },
  ],
  sourceDatasets: { ingest_orders: "raw_vendor_orders" },
};

const scn01BaselineData = {
  ingest_orders: [
    { order_id: 1, region: "NORTH", amount: 100.0, status: "COMPLETED" },
    { order_id: 2, region: "SOUTH", amount: 150.0, status: "COMPLETED" },
    { order_id: 3, region: "NORTH", amount: 200.0, status: "PENDING" },
    { order_id: 4, region: "EAST", amount: 80.0, status: "COMPLETED" },
  ],
  filter_completed: [
    { order_id: 1, region: "NORTH", amount: 100.0, status: "COMPLETED" },
    { order_id: 2, region: "SOUTH", amount: 150.0, status: "COMPLETED" },
    { order_id: 4, region: "EAST", amount: 80.0, status: "COMPLETED" },
  ],
  aggregate_revenue: [
    { region: "EAST", total_revenue: 80.0 },
    { region: "NORTH", total_revenue: 100.0 },
    { region: "SOUTH", total_revenue: 150.0 },
  ],
};

const scn01TargetData = {
  ingest_orders: [
    { order_id: 1, region: "NORTH", amount: 120.0, status: "COMPLETED" },
    { order_id: 2, region: "SOUTH", amount: 150.0, status: "COMPLETED" },
    { order_id: 3, region: "NORTH", amount: 200.0, status: "PENDING" },
    { order_id: 4, region: "EAST", amount: 80.0, status: "COMPLETED" },
    { order_id: 5, region: "WEST", amount: 300.0, status: "COMPLETED" },
  ],
  filter_completed: [
    { order_id: 1, region: "NORTH", amount: 120.0, status: "COMPLETED" },
    { order_id: 2, region: "SOUTH", amount: 150.0, status: "COMPLETED" },
    { order_id: 4, region: "EAST", amount: 80.0, status: "COMPLETED" },
    { order_id: 5, region: "WEST", amount: 300.0, status: "COMPLETED" },
  ],
  aggregate_revenue: [
    { region: "EAST", total_revenue: 80.0 },
    { region: "NORTH", total_revenue: 120.0 },
    { region: "SOUTH", total_revenue: 150.0 },
    { region: "WEST", total_revenue: 300.0 },
  ],
};

// ---------------------------------------------------------------------------
// 2. SCN-02: Arithmetic Expression Mutation
// ---------------------------------------------------------------------------
const scn02PipelineBase: PipelineDefinition = {
  version: EXECUTION_CONTRACT_VERSION,
  pipelineId: "pipeline_scn02",
  name: "SCN-02 Transaction Fee Calculation",
  nodes: [
    {
      nodeId: "ingest_transactions",
      label: "Ingest Transactions",
      operationType: "filter_rows",
      parameters: { predicate: "txn_id > 0", primary_keys: ["txn_id"] },
      inputNodeIds: [],
    },
    {
      nodeId: "compute_fee",
      label: "Compute Dynamic Fee",
      operationType: "derive_column",
      parameters: {
        new_column: "fee",
        expression: "amount * 0.1",
        primary_keys: ["txn_id"],
      },
      inputNodeIds: ["ingest_transactions"],
    },
    {
      nodeId: "mart_revenue",
      label: "Mart Fee Totals",
      operationType: "aggregate_group_by",
      parameters: {
        group_keys: ["currency"],
        aggregations: [{ column: "fee", func: "sum", alias: "total_fee" }],
        primary_keys: ["currency"],
      },
      inputNodeIds: ["compute_fee"],
    },
  ],
  edges: [
    { sourceNodeId: "ingest_transactions", targetNodeId: "compute_fee" },
    { sourceNodeId: "compute_fee", targetNodeId: "mart_revenue" },
  ],
  sourceDatasets: { ingest_transactions: "raw_transactions" },
};

const scn02PipelineTarget: PipelineDefinition = {
  ...scn02PipelineBase,
  nodes: scn02PipelineBase.nodes.map((n) =>
    n.nodeId === "compute_fee"
      ? {
          ...n,
          parameters: {
            new_column: "fee",
            expression: "amount * 0.2",
            primary_keys: ["txn_id"],
          },
        }
      : n
  ),
};

const scn02Txns = [
  { txn_id: 101, currency: "USD", amount: 1000.0 },
  { txn_id: 102, currency: "EUR", amount: 500.0 },
  { txn_id: 103, currency: "USD", amount: 2500.0 },
];

const scn02BaselineData = {
  ingest_transactions: scn02Txns,
  compute_fee: [
    { txn_id: 101, currency: "USD", amount: 1000.0, fee: 100.0 },
    { txn_id: 102, currency: "EUR", amount: 500.0, fee: 50.0 },
    { txn_id: 103, currency: "USD", amount: 2500.0, fee: 250.0 },
  ],
  mart_revenue: [
    { currency: "EUR", total_fee: 50.0 },
    { currency: "USD", total_fee: 350.0 },
  ],
};

const scn02TargetData = {
  ingest_transactions: scn02Txns,
  compute_fee: [
    { txn_id: 101, currency: "USD", amount: 1000.0, fee: 200.0 },
    { txn_id: 102, currency: "EUR", amount: 500.0, fee: 100.0 },
    { txn_id: 103, currency: "USD", amount: 2500.0, fee: 500.0 },
  ],
  mart_revenue: [
    { currency: "EUR", total_fee: 100.0 },
    { currency: "USD", total_fee: 700.0 },
  ],
};

// ---------------------------------------------------------------------------
// 3. SCN-03: Unmatched Join Drop
// ---------------------------------------------------------------------------
const scn03Pipeline: PipelineDefinition = {
  version: EXECUTION_CONTRACT_VERSION,
  pipelineId: "pipeline_scn03",
  name: "SCN-03 Customer Orders Join",
  nodes: [
    {
      nodeId: "ingest_orders",
      label: "Ingest Orders",
      operationType: "filter_rows",
      parameters: { predicate: "order_id > 0", primary_keys: ["order_id"] },
      inputNodeIds: [],
    },
    {
      nodeId: "ingest_customers",
      label: "Ingest Customers",
      operationType: "filter_rows",
      parameters: { predicate: "customer_id > 0", primary_keys: ["customer_id"] },
      inputNodeIds: [],
    },
    {
      nodeId: "join_orders_customers",
      label: "Inner Join Orders & Customers",
      operationType: "join_datasets",
      parameters: {
        join_type: "inner",
        left_on: ["customer_id"],
        right_on: ["customer_id"],
        primary_keys: ["order_id"],
      },
      inputNodeIds: ["ingest_orders", "ingest_customers"],
    },
  ],
  edges: [
    { sourceNodeId: "ingest_orders", targetNodeId: "join_orders_customers" },
    { sourceNodeId: "ingest_customers", targetNodeId: "join_orders_customers" },
  ],
  sourceDatasets: {
    ingest_orders: "raw_orders",
    ingest_customers: "raw_customers",
  },
};

const scn03Orders = [
  { order_id: 1, customer_id: 10, amount: 50.0 },
  { order_id: 2, customer_id: 20, amount: 75.0 },
  { order_id: 3, customer_id: 30, amount: 100.0 },
  { order_id: 4, customer_id: 40, amount: 125.0 },
];

const scn03Customers = [
  { customer_id: 10, name: "Alice" },
  { customer_id: 20, name: "Bob" },
  { customer_id: 30, name: "Charlie" },
  { customer_id: 40, name: "Diana" },
];

const scn03BaselineData = {
  ingest_orders: scn03Orders,
  ingest_customers: scn03Customers,
  join_orders_customers: [
    { order_id: 1, customer_id: 10, amount: 50.0, name: "Alice" },
    { order_id: 2, customer_id: 20, amount: 75.0, name: "Bob" },
    { order_id: 3, customer_id: 30, amount: 100.0, name: "Charlie" },
    { order_id: 4, customer_id: 40, amount: 125.0, name: "Diana" },
  ],
};

const scn03TargetData = {
  ingest_orders: scn03Orders,
  ingest_customers: scn03Customers,
  // Catastrophic 75% row drop (only 1 row matched)
  join_orders_customers: [
    { order_id: 1, customer_id: 10, amount: 50.0, name: "Alice" },
  ],
};

// ---------------------------------------------------------------------------
// 4. SCN-04: Null Sentinel Surge
// ---------------------------------------------------------------------------
const scn04PipelineBase: PipelineDefinition = {
  version: EXECUTION_CONTRACT_VERSION,
  pipelineId: "pipeline_scn04",
  name: "SCN-04 Metrics Sanitization",
  nodes: [
    {
      nodeId: "ingest_metrics",
      label: "Ingest Metrics",
      operationType: "filter_rows",
      parameters: { predicate: "metric_id > 0", primary_keys: ["metric_id"] },
      inputNodeIds: [],
    },
    {
      nodeId: "clean_data",
      label: "Cast & Clean Scores",
      operationType: "derive_column",
      parameters: {
        new_column: "score",
        expression: "raw_score * 1.0",
        primary_keys: ["metric_id"],
      },
      inputNodeIds: ["ingest_metrics"],
    },
  ],
  edges: [{ sourceNodeId: "ingest_metrics", targetNodeId: "clean_data" }],
  sourceDatasets: { ingest_metrics: "raw_metrics" },
};

const scn04PipelineTarget: PipelineDefinition = {
  ...scn04PipelineBase,
  nodes: scn04PipelineBase.nodes.map((n) =>
    n.nodeId === "clean_data"
      ? {
          ...n,
          parameters: {
            new_column: "score",
            expression: "null",
            primary_keys: ["metric_id"],
          },
        }
      : n
  ),
};

const scn04Metrics = [
  { metric_id: 1, raw_score: 95.5, status: "ACTIVE" },
  { metric_id: 2, raw_score: 88.0, status: "ACTIVE" },
  { metric_id: 3, raw_score: 72.3, status: "INACTIVE" },
];

const scn04BaselineData = {
  ingest_metrics: scn04Metrics,
  clean_data: [
    { metric_id: 1, raw_score: 95.5, status: "ACTIVE", score: 95.5 },
    { metric_id: 2, raw_score: 88.0, status: "ACTIVE", score: 88.0 },
    { metric_id: 3, raw_score: 72.3, status: "INACTIVE", score: 72.3 },
  ],
};

const scn04TargetData = {
  ingest_metrics: scn04Metrics,
  clean_data: [
    { metric_id: 1, raw_score: 95.5, status: "ACTIVE", score: null },
    { metric_id: 2, raw_score: 88.0, status: "ACTIVE", score: null },
    { metric_id: 3, raw_score: 72.3, status: "INACTIVE", score: null },
  ],
};

// ---------------------------------------------------------------------------
// CANONICAL SCENARIOS REGISTRY
// ---------------------------------------------------------------------------
export const CANONICAL_DEMO_SCENARIOS: Record<string, CanonicalDemoScenario> = {
  scn01: {
    scenario_id: "scn01",
    title: "SCN-01: Upstream Vendor Input Data Drift",
    description: "External source vendor mutated ingestion payload, producing upstream data drift.",
    expected_eod_step: "ingest_orders",
    expected_rule_id: DiagnosticRuleID.DR_01_UPSTREAM_INPUT_DATA_DRIFT,
    step_count: 3,
    pipeline: scn01Pipeline,
    baselineStepData: scn01BaselineData,
    targetStepData: scn01TargetData,
    primaryKeysByStep: {
      ingest_orders: ["order_id"],
      filter_completed: ["order_id"],
      aggregate_revenue: ["region"],
    },
  },
  scn02: {
    scenario_id: "scn02",
    title: "SCN-02: Arithmetic Expression Mutation",
    description: "Downstream fee calculation formula mutated, altering values across rows.",
    expected_eod_step: "compute_fee",
    expected_rule_id: DiagnosticRuleID.DR_02_ARITHMETIC_EXPRESSION_MUTATION,
    step_count: 3,
    pipeline: scn02PipelineBase,
    targetPipeline: scn02PipelineTarget,
    baselineStepData: scn02BaselineData,
    targetStepData: scn02TargetData,
    primaryKeysByStep: {
      ingest_transactions: ["txn_id"],
      compute_fee: ["txn_id"],
      mart_revenue: ["currency"],
    },
  },
  scn03: {
    scenario_id: "scn03",
    title: "SCN-03: Unmatched Join Drop",
    description: "Join predicate mutation caused catastrophic 75% row drop during join.",
    expected_eod_step: "join_orders_customers",
    expected_rule_id: DiagnosticRuleID.DR_03_UNMATCHED_JOIN_DROP,
    step_count: 3,
    pipeline: scn03Pipeline,
    baselineStepData: scn03BaselineData,
    targetStepData: scn03TargetData,
    primaryKeysByStep: {
      ingest_orders: ["order_id"],
      ingest_customers: ["customer_id"],
      join_orders_customers: ["order_id"],
    },
  },
  scn04: {
    scenario_id: "scn04",
    title: "SCN-04: Null Sentinel Surge",
    description: "Coercion failure or missing string sentinels caused valid scores to become NULL.",
    expected_eod_step: "clean_data",
    expected_rule_id: DiagnosticRuleID.DR_05_NULL_SENTINEL_SURGE,
    step_count: 2,
    pipeline: scn04PipelineBase,
    targetPipeline: scn04PipelineTarget,
    baselineStepData: scn04BaselineData,
    targetStepData: scn04TargetData,
    primaryKeysByStep: {
      ingest_metrics: ["metric_id"],
      clean_data: ["metric_id"],
    },
  },
};

export const getCanonicalDemoSummaries = (): ScenarioSummary[] => {
  return Object.values(CANONICAL_DEMO_SCENARIOS).map((s) => ({
    scenario_id: s.scenario_id,
    title: s.title,
    description: s.description,
    expected_eod_step: s.expected_eod_step,
    expected_rule_id: s.expected_rule_id,
    step_count: s.step_count,
    input_tables: Object.keys(s.pipeline.sourceDatasets || {}),
    primary_keys_by_step: s.primaryKeysByStep,
  }));
};

/**
 * Execute a canonical demonstration scenario completely in the browser.
 */
export async function executeBrowserScenario(scenarioId: string): Promise<Investigation> {
  const sid = scenarioId.toLowerCase();
  const scenario = CANONICAL_DEMO_SCENARIOS[sid];
  if (!scenario) {
    throw new Error(`Unknown demonstration scenario ID: '${scenarioId}'.`);
  }

  const baselineRunId = `run_${sid}_base_${Date.now()}`;
  const targetRunId = `run_${sid}_fault_${Date.now()}`;

  const topo = scenario.pipeline.nodes.map((n) => n.nodeId);

  const baselineStepOutputs: Record<string, StepOutput> = {};
  const targetStepOutputs: Record<string, StepOutput> = {};

  for (const stepId of topo) {
    const baseRows = scenario.baselineStepData[stepId] || [];
    const targetRows = scenario.targetStepData[stepId] || [];
    const pks = scenario.primaryKeysByStep[stepId] || [];

    const baseHash = computeDataHash(stepId, baseRows);
    const targetHash = computeDataHash(stepId, targetRows);

    baselineStepOutputs[stepId] = makeStepOutput(
      stepId,
      baseRows,
      baseHash,
      pks
    );
    targetStepOutputs[stepId] = makeStepOutput(
      stepId,
      targetRows,
      targetHash,
      pks
    );
  }

  const baselineExecution: PipelineExecutionResult = {
    version: EXECUTION_CONTRACT_VERSION,
    executionId: baselineRunId,
    pipelineId: scenario.pipeline.pipelineId,
    status: "COMPLETED",
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: 35,
    stepResults: baselineStepOutputs,
    topologicalOrder: topo,
    checkpoints: [],
  };

  const targetExecution: PipelineExecutionResult = {
    version: EXECUTION_CONTRACT_VERSION,
    executionId: targetRunId,
    pipelineId: scenario.pipeline.pipelineId,
    status: "COMPLETED",
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: 38,
    stepResults: targetStepOutputs,
    topologicalOrder: topo,
    checkpoints: [],
  };

  const report = await ForensicInvestigationService.runInvestigation({
    investigationId: `inv_${sid}_${Date.now()}`,
    title: `Scenario ${sid.toUpperCase()}: ${scenario.title}`,
    baseline: baselineExecution,
    target: targetExecution,
    pipeline: scenario.pipeline,
    targetPipeline: scenario.targetPipeline,
    stepDataBaseline: scenario.baselineStepData,
    stepDataTarget: scenario.targetStepData,
  });

  // Persist to local IndexedDB for recovery & investigation history
  try {
    const storedInv: StoredInvestigation = {
      investigationId: report.investigation.investigation_id,
      workspaceId: "default",
      title: `Scenario ${sid.toUpperCase()}: ${scenario.title}`,
      baselineRunId,
      faultedRunId: targetRunId,
      status: "COMPLETED",
      createdAt: report.investigation.created_at || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await indexedDBStorage.saveInvestigation(storedInv);
  } catch (err) {
    console.warn("Could not persist scenario investigation to IndexedDB:", err);
  }

  return report.investigation;
}

/**
 * Execute Tri-Run Fix Verification for a demonstration scenario completely in the browser.
 */
export async function verifyBrowserScenarioFix(
  scenarioId: string,
  fixMode: string = "clean"
): Promise<ForensicDossier> {
  const sid = scenarioId.toLowerCase();
  const scenario = CANONICAL_DEMO_SCENARIOS[sid];
  if (!scenario) {
    throw new Error(`Unknown demonstration scenario ID: '${scenarioId}'.`);
  }

  const topo = scenario.pipeline.nodes.map((n) => n.nodeId);
  const baselineRunId = `run_${sid}_r0_${Date.now()}`;
  const faultedRunId = `run_${sid}_r1_${Date.now()}`;
  const candidateRunId = `run_${sid}_r2_${Date.now()}`;

  // Formulate R2 candidate step data based on fixMode
  let candidateData: Record<string, Record<string, unknown>[]> = {};

  if (fixMode === "clean" || fixMode === "intentional") {
    // Restores baseline behavior
    candidateData = { ...scenario.baselineStepData };
  } else if (fixMode === "unresolved") {
    // Remains faulted
    candidateData = { ...scenario.targetStepData };
  } else if (fixMode === "partial") {
    // Partially fixed: blend of baseline and target
    candidateData = {};
    for (const stepId of topo) {
      const bRows = scenario.baselineStepData[stepId] || [];
      const tRows = scenario.targetStepData[stepId] || bRows;
      if (tRows.length > 1) {
        candidateData[stepId] = [tRows[0], ...bRows.slice(1)];
      } else {
        candidateData[stepId] = tRows;
      }
    }
  } else if (fixMode === "collateral") {
    // Fixes EOD step to baseline, but mutates a non-EOD step
    candidateData = { ...scenario.baselineStepData };
    const nonEodStep = topo.find((s) => s !== scenario.expected_eod_step) || topo[topo.length - 1];
    const original = scenario.baselineStepData[nonEodStep] || [];
    candidateData[nonEodStep] = original.slice(0, Math.max(1, original.length - 1));
  } else {
    candidateData = { ...scenario.baselineStepData };
  }

  const buildManifest = (
    runId: string,
    stepData: Record<string, Record<string, unknown>[]>,
    runRole: "BASELINE" | "FAULTED" | "CANDIDATE"
  ): RunManifest => {
    const stepOutputs: Record<string, StepOutput> = {};
    for (const stepId of topo) {
      const rows = stepData[stepId] || [];
      const pks = scenario.primaryKeysByStep[stepId] || [];
      const dataHash = computeDataHash(stepId, rows);
      stepOutputs[stepId] = makeStepOutput(
        stepId,
        rows,
        dataHash,
        pks
      );
    }

    const execPlan: ExecutionPlan = {
      planId: `plan_${sid}`,
      pipelineId: scenario.pipeline.pipelineId,
      topologicalOrder: topo,
      stages: [topo],
      stepInputs: {},
      plannedAt: new Date().toISOString(),
      tieBreakerApplied: false,
    };

    return {
      version: EXECUTION_CONTRACT_VERSION,
      runId,
      workspaceId: "default",
      pipelineId: scenario.pipeline.pipelineId,
      pipelineName: scenario.title,
      pipelineDefinitionHash: `hash_pipe_${sid}`,
      runType:
        runRole === "BASELINE"
          ? "BASELINE"
          : runRole === "FAULTED"
          ? "INVESTIGATION_PROBE"
          : "FIX_VERIFICATION",
      status: "COMPLETED",
      executionPlan: execPlan,
      inputArtifacts: {},
      stepsSnapshot: stepOutputs,
      checkpointReferences: {},
      missingEvidence: [],
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 30,
    };
  };

  const r0Manifest = buildManifest(baselineRunId, scenario.baselineStepData, "BASELINE");
  const r1Manifest = buildManifest(faultedRunId, scenario.targetStepData, "FAULTED");
  const r2Manifest = buildManifest(candidateRunId, candidateData, "CANDIDATE");

  const verifier = new TriRunVerifier();
  const dossier = await verifier.verifyRuns(
    {
      title: `Fix Verification: ${scenario.title} (${fixMode.toUpperCase()})`,
      baselineRunId,
      faultedRunId,
      candidateRunId,
      terminalSinkStepIds: [topo[topo.length - 1]],
    },
    {
      r0: r0Manifest,
      r1: r1Manifest,
      r2: r2Manifest,
    }
  );

  // Persist verification dossier to IndexedDB
  try {
    await indexedDBStorage.saveVerification(dossier);
  } catch (err) {
    console.warn("Could not persist scenario verification dossier:", err);
  }

  return dossier;
}
