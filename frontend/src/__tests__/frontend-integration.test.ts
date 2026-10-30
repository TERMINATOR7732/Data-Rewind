/**
 * Data Rewind Milestone 05 Frontend Integration Test Suite.
 * Validates unified integration across:
 * - Canonical Demo Scenarios (SCN-01 to SCN-04) browser execution
 * - Tri-Run Fix Verification across all 4 fix modes
 * - Pipeline Execution Engine & Query Executor contracts
 * - Developer Mode DAG validation & Historical Replay Engine
 * - Portable Archive bundle export/import
 */

import { describe, it, expect } from "vitest";
import {
  getCanonicalDemoSummaries,
  executeBrowserScenario,
  verifyBrowserScenarioFix,
} from "../features/demo/demo-scenarios";
import {
  PipelineDefinition,
  EXECUTION_CONTRACT_VERSION,
  DatasetSchema,
  PipelineExecutionResult,
  StepOutput,
} from "../runtime/contracts/index";
import { QueryExecutor } from "../runtime/pipeline/transformations/types";
import { ERROR_CODES } from "../runtime/contracts/errors";
import { DiagnosticRuleID, EODStatus } from "../runtime/forensics/contracts";
import { PipelineExecutionEngine } from "../runtime/pipeline/engine";
import { validatePipeline } from "../runtime/pipeline/dag-validator";
import { ReplayEngine } from "../runtime/replay/replay-engine";
import { ReplayOutcome } from "../runtime/replay/contracts";
import { RunManifest } from "../runtime/storage/run-manifest";
import { ArchiveService } from "../runtime/archive/archive-service";
import { InvestigationArchiveBundle } from "../runtime/archive/archive-contracts";
import { IndexedDBStorage } from "../runtime/storage/indexeddb";
import { OpfsArtifactStorage } from "../runtime/storage/opfs";
import { StorageManager } from "../runtime/storage/storage-manager";

describe("Frontend Integration: Milestone 05", () => {
  describe("1. Canonical Demo Scenarios Offline Browser Runtime", () => {
    it("returns metadata summaries for all 4 canonical scenarios", () => {
      const summaries = getCanonicalDemoSummaries();
      expect(summaries).toHaveLength(4);

      const scn01 = summaries.find((s) => s.scenario_id === "scn01");
      expect(scn01).toBeDefined();
      expect(scn01?.expected_eod_step).toBe("ingest_orders");
      expect(scn01?.expected_rule_id).toBe(DiagnosticRuleID.DR_01_UPSTREAM_INPUT_DATA_DRIFT);
      expect(scn01?.input_tables.length).toBeGreaterThan(0);

      const scn02 = summaries.find((s) => s.scenario_id === "scn02");
      expect(scn02?.expected_eod_step).toBe("compute_fee");
      expect(scn02?.expected_rule_id).toBe(DiagnosticRuleID.DR_02_ARITHMETIC_EXPRESSION_MUTATION);

      const scn03 = summaries.find((s) => s.scenario_id === "scn03");
      expect(scn03?.expected_eod_step).toBe("join_orders_customers");
      expect(scn03?.expected_rule_id).toBe(DiagnosticRuleID.DR_03_UNMATCHED_JOIN_DROP);

      const scn04 = summaries.find((s) => s.scenario_id === "scn04");
      expect(scn04?.expected_eod_step).toBe("clean_data");
      expect(scn04?.expected_rule_id).toBe(DiagnosticRuleID.DR_05_NULL_SENTINEL_SURGE);
    });

    it("executes SCN-01 in pure browser engine and identifies DR-01 EOD", async () => {
      const inv = await executeBrowserScenario("scn01");
      expect(inv).toBeDefined();
      expect(inv.eod_result).toBeDefined();
      expect(inv.eod_result.primary_eod_step).toBe("ingest_orders");
      expect(inv.eod_result.status).toBe(EODStatus.UPSTREAM_INPUT_DATA_DRIFT);
      expect(inv.status).toBe("DIVERGENT");
      expect(Object.keys(inv.step_comparisons).length).toBeGreaterThanOrEqual(3);
    });

    it("executes SCN-02 in pure browser engine and identifies DR-02 cell divergence", async () => {
      const inv = await executeBrowserScenario("scn02");
      expect(inv).toBeDefined();
      expect(inv.eod_result.primary_eod_step).toBe("compute_fee");
      expect(inv.eod_result.status).toBe(EODStatus.EXACT_EOD);
    });

    it("executes SCN-03 in pure browser engine and identifies DR-03 structural mismatch", async () => {
      const inv = await executeBrowserScenario("scn03");
      expect(inv).toBeDefined();
      expect(inv.eod_result.primary_eod_step).toBe("join_orders_customers");
      expect(inv.eod_result.status).toBe(EODStatus.NONDETERMINISTIC_TRANSFORMATION);
    });

    it("executes SCN-04 in pure browser engine and identifies DR-05 schema deviation", async () => {
      const inv = await executeBrowserScenario("scn04");
      expect(inv).toBeDefined();
      expect(inv.eod_result.primary_eod_step).toBe("clean_data");
      expect(inv.eod_result.status).toBe(EODStatus.EXACT_EOD);
    });

    it("throws error for non-existent scenario ID", async () => {
      await expect(executeBrowserScenario("invalid_id")).rejects.toThrow(
        /Unknown demonstration scenario ID/
      );
    });
  });

  describe("2. Demo Tri-Run Fix Verification Matrix", () => {
    it("verifies clean fix restores baseline equivalence without side-effects", async () => {
      const dossier = await verifyBrowserScenarioFix("scn01", "clean");
      expect(dossier).toBeDefined();
      expect(dossier.verification.verdict).toBe("VERIFIED_CLEAN");
      expect(dossier.verification.dual_axis.remediation_axis.eod_remediated).toBe(true);
      expect(dossier.verification.dual_axis.baseline_axis?.baseline_equivalent_across_all_steps).toBe(true);
      expect(dossier.verification.dual_axis.baseline_axis?.collateral_regressions).toHaveLength(0);
    });

    it("verifies unresolved fix leaves defect active", async () => {
      const dossier = await verifyBrowserScenarioFix("scn01", "unresolved");
      expect(dossier.verification.verdict).toBe("REGRESSION_UNRESOLVED");
      expect(dossier.verification.dual_axis.remediation_axis.eod_remediated).toBe(false);
    });

    it("verifies collateral damage when fix mutates untouched step", async () => {
      const dossier = await verifyBrowserScenarioFix("scn01", "collateral");
      expect(dossier.verification.verdict).toBe("NEW_FAULT_INTRODUCED");
      expect(
        dossier.verification.dual_axis.baseline_axis?.collateral_regressions.length
      ).toBeGreaterThan(0);
    });
  });

  describe("3. Pipeline Execution Engine with QueryExecutor Integration", () => {
    it("executes a deterministic pipeline DAG through QueryExecutor abstraction", async () => {
      const tables = new Map<string, Record<string, unknown>[]>();
      tables.set("source_data", [
        { id: 1, amount: 100, active: true },
        { id: 2, amount: 200, active: false },
        { id: 3, amount: 300, active: true },
      ]);

      const mockExecutor: QueryExecutor = {
        async query<T = Record<string, unknown>>(sql: string) {
          if (sql.includes("CREATE OR REPLACE TABLE")) {
            const match = sql.match(/CREATE OR REPLACE TABLE\s+"([^"]+)"/i);
            const tblName = match ? match[1] : "out";
            const filtered = [
              { id: 1, amount: 100, active: true },
              { id: 3, amount: 300, active: true },
            ];
            tables.set(tblName, filtered);
            return {
              columns: ["id", "amount", "active"],
              columnTypes: ["INTEGER", "INTEGER", "BOOLEAN"],
              rows: filtered as unknown as T[],
              rowCount: filtered.length,
              durationMs: 2,
            };
          }

          if (sql.includes("LIMIT")) {
            const match = sql.match(/FROM\s+"([^"]+)"/i);
            const tblName = match ? match[1] : "source_data";
            const rows = (tables.get(tblName) || []) as T[];
            return {
              columns: ["id", "amount", "active"],
              columnTypes: ["INTEGER", "INTEGER", "BOOLEAN"],
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
              { name: "id", dataType: "INTEGER" as any, nullable: false, ordinalPosition: 1 },
              { name: "amount", dataType: "INTEGER" as any, nullable: false, ordinalPosition: 2 },
              { name: "active", dataType: "BOOLEAN" as any, nullable: false, ordinalPosition: 3 },
            ],
            primaryKeys: ["id"],
          };
        },

        async getRowCount(tableName: string): Promise<number> {
          return tables.get(tableName)?.length ?? 2;
        },
      };

      const pipeline: PipelineDefinition = {
        version: EXECUTION_CONTRACT_VERSION,
        pipelineId: "test_pipe_builder",
        name: "Test Pipeline Builder",
        sourceDatasets: {
          step_filter: "src_01",
        },
        nodes: [
          {
            nodeId: "step_filter",
            label: "Filter Active Rows",
            operationType: "filter_rows",
            parameters: { predicate: 'active == true' },
            inputNodeIds: [],
          },
        ],
        edges: [],
      };

      const engine = new PipelineExecutionEngine({ executor: mockExecutor });
      const result = await engine.execute({
        version: EXECUTION_CONTRACT_VERSION,
        executionId: "exec_test_01",
        pipeline,
        runType: "BASELINE",
      });

      expect(result.status).toBe("COMPLETED");
      expect(result.topologicalOrder).toEqual(["step_filter"]);
      expect(result.stepResults["step_filter"]).toBeDefined();
      expect(result.stepResults["step_filter"].status).toBe("SUCCESS");
      expect(result.stepResults["step_filter"].rowCount).toBe(2);
    });
  });

  describe("4. Developer Mode Replay & DAG Validation", () => {
    it("validates valid DAG structure and catches cycles", () => {
      const validPipeline: PipelineDefinition = {
        version: EXECUTION_CONTRACT_VERSION,
        pipelineId: "valid_dag",
        name: "Valid DAG",
        sourceDatasets: { step_a: "ds_raw" },
        nodes: [
          {
            nodeId: "step_a",
            label: "Step A",
            operationType: "filter_rows",
            parameters: { predicate: "amount > 0" },
            inputNodeIds: [],
          },
          {
            nodeId: "step_b",
            label: "Step B",
            operationType: "derive_column",
            parameters: { target_column: "fee", expression: "amount * 0.1" },
            inputNodeIds: ["step_a"],
          },
        ],
        edges: [{ sourceNodeId: "step_a", targetNodeId: "step_b" }],
      };

      const validation = validatePipeline(validPipeline);
      expect(validation.valid).toBe(true);
      expect(validation.issues).toHaveLength(0);

      // Mutate to create cycle
      const cyclicPipeline: PipelineDefinition = {
        ...validPipeline,
        nodes: [
          {
            nodeId: "step_a",
            label: "Step A",
            operationType: "filter_rows",
            parameters: { predicate: "amount > 0" },
            inputNodeIds: ["step_b"], // Cycle!
          },
          {
            nodeId: "step_b",
            label: "Step B",
            operationType: "derive_column",
            parameters: { target_column: "fee", expression: "amount * 0.1" },
            inputNodeIds: ["step_a"],
          },
        ],
        edges: [
          { sourceNodeId: "step_a", targetNodeId: "step_b" },
          { sourceNodeId: "step_b", targetNodeId: "step_a" },
        ],
      };

      const cyclicValidation = validatePipeline(cyclicPipeline);
      expect(cyclicValidation.valid).toBe(false);
      expect(cyclicValidation.issues.some((i) => i.code === ERROR_CODES.CYCLIC_DEPENDENCY)).toBe(true);
    });

    it("verifies deterministic replay match using ReplayEngine", async () => {
      const topo = ["step_1"];
      const stepOutput: StepOutput = {
        stepId: "step_1",
        status: "SUCCESS",
        rowCount: 10,
        columnCount: 2,
        durationMs: 5,
        schema: {
          version: EXECUTION_CONTRACT_VERSION,
          columns: [{ name: "id", dataType: "INTEGER" as any, nullable: false, ordinalPosition: 1 }],
          primaryKeys: ["id"],
        },
        tableName: "tbl_step_1",
        contentHash: "hash_deterministic_abc123",
        multisetHash: "hash_deterministic_abc123",
        definitionHash: "def_step_1",
      };

      const manifest: RunManifest = {
        version: EXECUTION_CONTRACT_VERSION,
        runId: "run_historical_01",
        workspaceId: "default",
        pipelineId: "pipe_replay",
        pipelineName: "Replay Test Pipeline",
        pipelineDefinitionHash: "pipe_hash_123",
        runType: "BASELINE",
        status: "COMPLETED",
        executionPlan: {
          planId: "plan_1",
          pipelineId: "pipe_replay",
          topologicalOrder: topo,
          stages: [topo],
          stepInputs: {},
          plannedAt: new Date().toISOString(),
          tieBreakerApplied: false,
        },
        inputArtifacts: {},
        stepsSnapshot: { step_1: stepOutput },
        checkpointReferences: {},
        missingEvidence: [],
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: 5,
      };

      const replayedExecution: PipelineExecutionResult = {
        version: EXECUTION_CONTRACT_VERSION,
        executionId: "run_replayed_01",
        pipelineId: "pipe_replay",
        status: "COMPLETED",
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: 5,
        stepResults: { step_1: stepOutput },
        topologicalOrder: topo,
        checkpoints: [],
      };

      const replayEngine = new ReplayEngine();
      const outcome = await replayEngine.evaluateReplay(manifest, replayedExecution);

      expect(outcome.outcome).toBe(ReplayOutcome.REPRODUCIBLE);
      expect(outcome.stepVerifications["step_1"]).toBeDefined();
      expect(outcome.stepVerifications["step_1"].isMatched).toBe(true);
    });
  });

  describe("5. Portable Archive Export & Staged Traversal Import", () => {
    it("round-trips archive bundle and rejects path traversal attacks", async () => {
      const mockStores: Record<string, Map<string, any>> = {
        workspaces: new Map(),
        datasets: new Map(),
        artifacts: new Map(),
        runtime_config: new Map(),
        run_manifests: new Map(),
        verifications: new Map(),
        replay_records: new Map(),
        investigations: new Map([
          [
            "inv_test_archive",
            {
              investigationId: "inv_test_archive",
              workspaceId: "ws_default",
              title: "Archive Roundtrip Test",
              faultedRunId: "run_r1",
              status: "COMPLETED",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
        ]),
      };

      const createMockReq = (result: any) => {
        const req: any = { result, onsuccess: null, onerror: null };
        setTimeout(() => {
          if (req.onsuccess) req.onsuccess({ target: req });
        }, 0);
        return req;
      };

      const mockDb: any = {
        objectStoreNames: { contains: () => true },
        createObjectStore: () => ({}),
        transaction: (storeNames: string | string[]) => {
          const tx: any = {
            error: null,
            oncomplete: null,
            onerror: null,
            objectStore: (storeName?: string) => {
              const resolvedName =
                storeName || (Array.isArray(storeNames) ? storeNames[0] : storeNames);
              const storeMap = mockStores[resolvedName] || new Map();
              return {
                put: (item: any) => {
                  const key = item.investigationId || item.runId || item.artifactId || item.key;
                  storeMap.set(key, item);
                  return createMockReq(key);
                },
                get: (key: string) => createMockReq(storeMap.get(key)),
                getAll: () => createMockReq(Array.from(storeMap.values())),
                delete: (key: string) => {
                  storeMap.delete(key);
                  return createMockReq(undefined);
                },
              };
            },
          };
          setTimeout(() => {
            if (tx.oncomplete) tx.oncomplete();
          }, 0);
          return tx;
        },
      };

      const idb = new IndexedDBStorage();
      (idb as any).getDB = async () => mockDb;
      const opfs = new OpfsArtifactStorage();
      const storageManager = new StorageManager(idb, opfs);
      const archiveService = new ArchiveService(storageManager);

      const bundle = await archiveService.exportArchive("inv_test_archive");
      expect(bundle).toBeDefined();
      expect(bundle.investigation.investigationId).toBe("inv_test_archive");

      // Verify staged import
      const result = await archiveService.importArchive(bundle, { conflictStrategy: "OVERWRITE" });
      expect(result.investigationId).toBe("inv_test_archive");

      // Malicious path traversal injection in bundle artifact filename
      const maliciousBundle: InvestigationArchiveBundle = {
        ...bundle,
        artifacts: {
          "malicious_path": {
            reference: {
              artifactId: "art_bad",
              runId: "run_bad",
              stepId: "step_bad",
              storagePath: "../../etc/passwd",
              byteSize: 10,
              sha256Hash: "badhash",
              artifactType: "CSV",
              createdAt: new Date().toISOString(),
            },
            dataBase64: "dGVzdA==",
            sha256Hash: "badhash",
            byteSize: 10,
          },
        },
      };

      await expect(archiveService.importArchive(maliciousBundle)).rejects.toThrow(
        /violates safe directory traversal/
      );
    });
  });
});
