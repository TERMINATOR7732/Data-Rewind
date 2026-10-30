/**
 * Data Rewind Tri-Run Fix Verification Test Suite (12 Essential Scenarios).
 * Conforms strictly to SPEC-MOD-05 §1 and §7.5.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { TriRunVerifier } from "../runtime/verification/tri-run-verifier";
import { RunManifest } from "../runtime/storage/run-manifest";
import { EXECUTION_CONTRACT_VERSION } from "../runtime/contracts/index";
import { IndexedDBStorage } from "../runtime/storage/indexeddb";
import { OpfsArtifactStorage } from "../runtime/storage/opfs";
import { StorageManager } from "../runtime/storage/storage-manager";

describe("Tri-Run Fix Verification — 12 Essential Scenarios", () => {
  let idb: IndexedDBStorage;
  let opfs: OpfsArtifactStorage;
  let storageManager: StorageManager;
  let verifier: TriRunVerifier;

  beforeEach(() => {
    const mockStore = new Map<string, any>();
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
      transaction: () => {
        const tx: any = {
          error: null,
          oncomplete: null,
          onerror: null,
          objectStore: () => ({
            put: (item: any) => {
              const key = item.verificationId || item.runId;
              mockStore.set(key, item);
              return createMockReq(key);
            },
            get: (key: string) => createMockReq(mockStore.get(key)),
            getAll: () => createMockReq(Array.from(mockStore.values())),
          }),
        };
        setTimeout(() => {
          if (tx.oncomplete) tx.oncomplete();
        }, 0);
        return tx;
      },
    };

    idb = new IndexedDBStorage();
    (idb as any).getDB = async () => mockDb;
    opfs = new OpfsArtifactStorage();
    storageManager = new StorageManager(idb, opfs);
    verifier = new TriRunVerifier(storageManager);
  });

  const createRun = (id: string, role: string, steps: Record<string, any>): RunManifest => ({
    version: EXECUTION_CONTRACT_VERSION,
    runId: id,
    workspaceId: "ws_01",
    pipelineId: "pipe_01",
    pipelineName: "Revenue Calculation Pipeline",
    pipelineDefinitionHash: `def_${id}`,
    runType: role as any,
    status: "COMPLETED",
    executionPlan: {
      planId: "plan_01",
      pipelineId: "pipe_01",
      topologicalOrder: Object.keys(steps),
      stages: [Object.keys(steps)],
      stepInputs: {
        step_1: [],
        step_2: ["step_1"],
        sink_step: ["step_2"],
      },
      plannedAt: new Date().toISOString(),
      tieBreakerApplied: false,
    },
    inputArtifacts: {},
    stepsSnapshot: steps,
    checkpointReferences: {},
    missingEvidence: [],
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: 30,
  });

  // Scenario 1: Clean Fix (VERIFIED_CLEAN)
  it("Scenario 1: Clean fix — EOD eliminated, zero secondary regressions (VERIFIED_CLEAN)", async () => {
    const r0 = createRun("r0", "BASELINE", {
      step_1: { stepId: "step_1", rowCount: 10, multisetHash: "h_s1_ok", previewRows: [{ id: 1, val: 10 }] },
      step_2: { stepId: "step_2", rowCount: 10, multisetHash: "h_s2_ok", previewRows: [{ id: 1, rev: 100 }] },
      sink_step: { stepId: "sink_step", rowCount: 10, multisetHash: "h_sink_ok", previewRows: [{ id: 1, tot: 100 }] },
    });

    const r1 = createRun("r1", "FAULTED", {
      step_1: { stepId: "step_1", rowCount: 10, multisetHash: "h_s1_ok", previewRows: [{ id: 1, val: 10 }] },
      step_2: { stepId: "step_2", rowCount: 10, multisetHash: "h_s2_fault", previewRows: [{ id: 1, rev: 0 }] }, // EOD fault
      sink_step: { stepId: "sink_step", rowCount: 10, multisetHash: "h_sink_fault", previewRows: [{ id: 1, tot: 0 }] },
    });

    const r2 = createRun("r2", "FIX", {
      step_1: { stepId: "step_1", rowCount: 10, multisetHash: "h_s1_ok", previewRows: [{ id: 1, val: 10 }] },
      step_2: { stepId: "step_2", rowCount: 10, multisetHash: "h_s2_ok", previewRows: [{ id: 1, rev: 100 }] }, // Fixed
      sink_step: { stepId: "sink_step", rowCount: 10, multisetHash: "h_sink_ok", previewRows: [{ id: 1, tot: 100 }] }, // Equivalent
    });

    const dossier = await verifier.verifyRuns(
      { faultedRunId: "r1", candidateRunId: "r2", baselineRunId: "r0" },
      { r0, r1, r2 }
    );

    expect(dossier.verification.verdict).toBe("VERIFIED_CLEAN");
    expect(dossier.verification.dual_axis.remediation_axis.eod_remediated).toBe(true);
    expect(dossier.verification.dual_axis.baseline_axis?.baseline_equivalent_across_all_steps).toBe(true);
  });

  // Scenario 2: Unresolved Regression (REGRESSION_UNRESOLVED)
  it("Scenario 2: Unresolved regression — identical divergence persists at EOD step (REGRESSION_UNRESOLVED)", async () => {
    const r0 = createRun("r0", "BASELINE", {
      step_1: { stepId: "step_1", rowCount: 10, multisetHash: "h_s1_ok", previewRows: [{ id: 1, val: 10 }] },
      step_2: { stepId: "step_2", rowCount: 10, multisetHash: "h_s2_ok", previewRows: [{ id: 1, rev: 100 }] },
    });

    const r1 = createRun("r1", "FAULTED", {
      step_1: { stepId: "step_1", rowCount: 10, multisetHash: "h_s1_ok", previewRows: [{ id: 1, val: 10 }] },
      step_2: { stepId: "step_2", rowCount: 10, multisetHash: "h_s2_fault", previewRows: [{ id: 1, rev: 0 }] },
    });

    const r2 = createRun("r2", "FIX", {
      step_1: { stepId: "step_1", rowCount: 10, multisetHash: "h_s1_ok", previewRows: [{ id: 1, val: 10 }] },
      step_2: { stepId: "step_2", rowCount: 10, multisetHash: "h_s2_fault", previewRows: [{ id: 1, rev: 0 }] }, // Still 0!
    });

    const dossier = await verifier.verifyRuns(
      { faultedRunId: "r1", candidateRunId: "r2", baselineRunId: "r0" },
      { r0, r1, r2 }
    );

    expect(dossier.verification.verdict).toBe("REGRESSION_UNRESOLVED");
    expect(dossier.verification.dual_axis.remediation_axis.eod_remediated).toBe(false);
  });

  // Scenario 3: New Fault Introduced (NEW_FAULT_INTRODUCED)
  it("Scenario 3: New fault introduced — EOD resolved, but secondary regression at another step (NEW_FAULT_INTRODUCED)", async () => {
    const r0 = createRun("r0", "BASELINE", {
      step_1: { stepId: "step_1", rowCount: 10, multisetHash: "h_s1_ok", previewRows: [{ id: 1, val: 10 }] },
      step_2: { stepId: "step_2", rowCount: 10, multisetHash: "h_s2_ok", previewRows: [{ id: 1, rev: 100 }] },
    });

    const r1 = createRun("r1", "FAULTED", {
      step_1: { stepId: "step_1", rowCount: 10, multisetHash: "h_s1_ok", previewRows: [{ id: 1, val: 10 }] },
      step_2: { stepId: "step_2", rowCount: 10, multisetHash: "h_s2_fault", previewRows: [{ id: 1, rev: 0 }] }, // EOD step
    });

    const r2 = createRun("r2", "FIX", {
      step_1: { stepId: "step_1", rowCount: 10, multisetHash: "h_s1_MUTATED", previewRows: [{ id: 1, val: 999 }] }, // Accidental mutation!
      step_2: { stepId: "step_2", rowCount: 10, multisetHash: "h_s2_ok", previewRows: [{ id: 1, rev: 100 }] }, // EOD step fixed
    });

    const dossier = await verifier.verifyRuns(
      { faultedRunId: "r1", candidateRunId: "r2", baselineRunId: "r0" },
      { r0, r1, r2 }
    );

    expect(dossier.verification.verdict).toBe("NEW_FAULT_INTRODUCED");
    expect(dossier.verification.dual_axis.baseline_axis?.collateral_regressions).toContain("step_1");
  });

  // Scenario 4: Intentional Update (INTENTIONAL_UPDATE)
  it("Scenario 4: Intentional update — declared contract permits divergence (INTENTIONAL_UPDATE)", async () => {
    const r0 = createRun("r0", "BASELINE", {
      step_1: { stepId: "step_1", rowCount: 10, multisetHash: "h_s1_ok", previewRows: [{ id: 1, val: 10 }] },
      step_2: { stepId: "step_2", rowCount: 10, multisetHash: "h_s2_ok", previewRows: [{ id: 1, rev: 100 }] },
    });

    const r1 = createRun("r1", "FAULTED", {
      step_1: { stepId: "step_1", rowCount: 10, multisetHash: "h_s1_ok", previewRows: [{ id: 1, val: 10 }] },
      step_2: { stepId: "step_2", rowCount: 10, multisetHash: "h_s2_fault", previewRows: [{ id: 1, rev: 0 }] },
    });

    const r2 = createRun("r2", "FIX", {
      step_1: { stepId: "step_1", rowCount: 10, multisetHash: "h_s1_upgraded", previewRows: [{ id: 1, val: 20 }] },
      step_2: { stepId: "step_2", rowCount: 10, multisetHash: "h_s2_ok", previewRows: [{ id: 1, rev: 100 }] },
    });

    const dossier = await verifier.verifyRuns(
      {
        faultedRunId: "r1",
        candidateRunId: "r2",
        baselineRunId: "r0",
        intentionalContract: {
          allowed_steps: ["step_1"],
          justification: "Upgraded business multiplier in step_1 from 10 to 20",
        },
      },
      { r0, r1, r2 }
    );

    expect(dossier.verification.verdict).toBe("INTENTIONAL_UPDATE");
  });

  // Scenario 5: Partial Restoration (PARTIAL_RESTORATION)
  it("Scenario 5: Partial restoration — fault severity reduced, but differences remain (PARTIAL_RESTORATION)", async () => {
    const r0 = createRun("r0", "BASELINE", {
      step_1: {
        stepId: "step_1",
        rowCount: 4,
        multisetHash: "h_s1_ok",
        previewRows: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }],
      },
    });

    const r1 = createRun("r1", "FAULTED", {
      step_1: {
        stepId: "step_1",
        rowCount: 4,
        multisetHash: "h_s1_fault",
        previewRows: [{ id: 1 }, { id: 99 }, { id: 98 }, { id: 97 }], // 3 rows modified
      },
    });

    const r2 = createRun("r2", "FIX", {
      step_1: {
        stepId: "step_1",
        rowCount: 4,
        multisetHash: "h_s1_partial",
        previewRows: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 97 }], // Only 1 row modified (reduced severity)
      },
    });

    const dossier = await verifier.verifyRuns(
      { faultedRunId: "r1", candidateRunId: "r2", baselineRunId: "r0" },
      { r0, r1, r2 }
    );

    expect(dossier.verification.verdict).toBe("PARTIAL_RESTORATION");
    expect(dossier.verification.dual_axis.remediation_axis.eod_severity_reduced).toBe(true);
    expect(dossier.verification.dual_axis.remediation_axis.eod_remediated).toBe(false);
  });

  // Scenario 6: Baseline Unavailable (BASELINE_UNAVAILABLE)
  it("Scenario 6: Baseline unavailable — R0 missing, remediation verified against R1 (BASELINE_UNAVAILABLE)", async () => {
    const r1 = createRun("r1", "FAULTED", {
      step_1: { stepId: "step_1", rowCount: 10, multisetHash: "h_s1_bad", previewRows: [{ id: 1, val: 0 }] },
    });

    const r2 = createRun("r2", "FIX", {
      step_1: { stepId: "step_1", rowCount: 10, multisetHash: "h_s1_fixed", previewRows: [{ id: 1, val: 100 }] },
    });

    const dossier = await verifier.verifyRuns(
      { faultedRunId: "r1", candidateRunId: "r2" }, // No baselineRunId
      { r0: null, r1, r2 }
    );

    expect(dossier.verification.verdict).toBe("BASELINE_UNAVAILABLE");
  });

  // Scenario 7: Fault Unreproducible (FAULT_UNREPRODUCIBLE)
  it("Scenario 7: Fault unreproducible — defect in R1 could not be observed (FAULT_UNREPRODUCIBLE)", async () => {
    const r0 = createRun("r0", "BASELINE", {
      step_1: { stepId: "step_1", rowCount: 10, multisetHash: "h_s1_same", previewRows: [{ id: 1, val: 10 }] },
    });

    const r1 = createRun("r1", "FAULTED", {
      step_1: { stepId: "step_1", rowCount: 10, multisetHash: "h_s1_same", previewRows: [{ id: 1, val: 10 }] }, // Identical to R0!
    });

    const r2 = createRun("r2", "FIX", {
      step_1: { stepId: "step_1", rowCount: 10, multisetHash: "h_s1_same", previewRows: [{ id: 1, val: 10 }] },
    });

    const dossier = await verifier.verifyRuns(
      { faultedRunId: "r1", candidateRunId: "r2", baselineRunId: "r0" },
      { r0, r1, r2 }
    );

    expect(dossier.verification.verdict).toBe("FAULT_UNREPRODUCIBLE");
  });

  // Scenario 8: Missing intermediate checkpoint records missing evidence declaration
  it("Scenario 8: Missing intermediate checkpoint records missing evidence declaration", async () => {
    const r0 = createRun("r0", "BASELINE", {
      step_1: { stepId: "step_1", rowCount: 10, multisetHash: "h_s1", previewRows: [{ id: 1 }] },
    });
    r0.missingEvidence = [
      {
        category: "INTERMEDIATE_CHECKPOINT",
        stepId: "step_1",
        description: "Intermediate Parquet checkpoint was pruned",
        remediationAdvice: "Re-run baseline with checkpoint retention enabled",
      },
    ];

    const r1 = createRun("r1", "FAULTED", {
      step_1: { stepId: "step_1", rowCount: 10, multisetHash: "h_s1_fault", previewRows: [{ id: 2 }] },
    });

    const r2 = createRun("r2", "FIX", {
      step_1: { stepId: "step_1", rowCount: 10, multisetHash: "h_s1", previewRows: [{ id: 1 }] },
    });

    const dossier = await verifier.verifyRuns(
      { faultedRunId: "r1", candidateRunId: "r2", baselineRunId: "r0" },
      { r0, r1, r2 }
    );

    expect(dossier.verification.missing_evidence.length).toBeGreaterThan(0);
    expect(dossier.verification.missing_evidence[0].step_id).toBe("step_1");
  });

  // Scenario 9: Incompatible schemas between candidate and baseline
  it("Scenario 9: Incompatible schemas between candidate and baseline flags difference", async () => {
    const r0 = createRun("r0", "BASELINE", {
      step_1: {
        stepId: "step_1",
        rowCount: 1,
        multisetHash: "h_s0",
        previewRows: [{ id: 1, age: 30 }],
      },
    });

    const r1 = createRun("r1", "FAULTED", {
      step_1: {
        stepId: "step_1",
        rowCount: 1,
        multisetHash: "h_s1",
        previewRows: [{ id: 1, age: -99 }],
      },
    });

    const r2 = createRun("r2", "FIX", {
      step_1: {
        stepId: "step_1",
        rowCount: 1,
        multisetHash: "h_s2",
        previewRows: [{ id: 1, user_age: 30 }], // Incompatible column name!
      },
    });

    const dossier = await verifier.verifyRuns(
      { faultedRunId: "r1", candidateRunId: "r2", baselineRunId: "r0" },
      { r0, r1, r2 }
    );

    expect(dossier.verification.dual_axis.baseline_axis?.baseline_equivalent_across_all_steps).toBe(false);
  });

  // Scenario 10: Duplicate keys in candidate output
  it("Scenario 10: Duplicate keys in candidate output handled gracefully by keyed comparator", async () => {
    const r0 = createRun("r0", "BASELINE", {
      step_1: {
        stepId: "step_1",
        rowCount: 2,
        multisetHash: "h_s0",
        previewRows: [{ id: 1, v: 10 }, { id: 2, v: 20 }],
      },
    });

    const r1 = createRun("r1", "FAULTED", {
      step_1: {
        stepId: "step_1",
        rowCount: 2,
        multisetHash: "h_s1",
        previewRows: [{ id: 1, v: 0 }, { id: 2, v: 0 }],
      },
    });

    const r2 = createRun("r2", "FIX", {
      step_1: {
        stepId: "step_1",
        rowCount: 2,
        multisetHash: "h_s2",
        previewRows: [{ id: 1, v: 10 }, { id: 1, v: 20 }], // Duplicate id 1!
      },
    });

    const dossier = await verifier.verifyRuns(
      { faultedRunId: "r1", candidateRunId: "r2", baselineRunId: "r0" },
      { r0, r1, r2 }
    );

    expect(dossier.verification.dual_axis.baseline_axis?.baseline_equivalent_across_all_steps).toBe(false);
  });

  // Scenario 11: Missing run manifests throw clear error
  it("Scenario 11: Missing run manifests throw clear runtime error", async () => {
    await expect(
      verifier.verifyRuns({ faultedRunId: "non_existent_r1", candidateRunId: "non_existent_r2" })
    ).rejects.toThrowError(/Failed to locate required run manifests/);
  });

  // Scenario 12: Float tolerance equivalence across multiple decimal places
  it("Scenario 12: Float tolerance equivalence across multiple decimal places verifies clean", async () => {
    const r0 = createRun("r0", "BASELINE", {
      step_1: {
        stepId: "step_1",
        rowCount: 1,
        multisetHash: "h_s0_f",
        previewRows: [{ id: 1, rate: 0.12345678 }],
      },
    });

    const r1 = createRun("r1", "FAULTED", {
      step_1: {
        stepId: "step_1",
        rowCount: 1,
        multisetHash: "h_s1_f",
        previewRows: [{ id: 1, rate: 0.99999999 }],
      },
    });

    const r2 = createRun("r2", "FIX", {
      step_1: {
        stepId: "step_1",
        rowCount: 1,
        multisetHash: "h_s2_f",
        previewRows: [{ id: 1, rate: 0.12345679 }], // Diff 1e-8, within 1e-6
      },
    });

    const dossier = await verifier.verifyRuns(
      { faultedRunId: "r1", candidateRunId: "r2", baselineRunId: "r0", floatTolerance: 1e-6 },
      { r0, r1, r2 }
    );

    expect(dossier.verification.verdict).toBe("VERIFIED_CLEAN");
  });
});
