import { describe, it, expect } from "vitest";
import { computeMultisetHash, computeContentHash } from "../runtime/pipeline/hashing";
import { createExecutionPlan } from "../runtime/pipeline/planner";
import { PipelineDefinition, EXECUTION_CONTRACT_VERSION } from "../runtime/contracts/index";

describe("Pipeline Engine Benchmarks & Invariants", () => {
  it("verifies order-independent multiset hash invariant on shuffled datasets", async () => {
    const originalRows: Record<string, unknown>[] = [
      { id: 101, customer: "Alice", amount: 450.5, status: "completed" },
      { id: 102, customer: "Bob", amount: 120.0, status: "pending" },
      { id: 103, customer: "Charlie", amount: 980.25, status: "completed" },
      { id: 104, customer: "Diana", amount: 310.0, status: "failed" },
    ];

    // Shuffled copy
    const shuffledRows = [
      originalRows[2],
      originalRows[0],
      originalRows[3],
      originalRows[1],
    ];

    // Mutated copy (one value changed)
    const mutatedRows = [
      originalRows[0],
      { ...originalRows[1], amount: 120.01 }, // 1 cent difference
      originalRows[2],
      originalRows[3],
    ];

    const hashOriginal = await computeMultisetHash(originalRows);
    const hashShuffled = await computeMultisetHash(shuffledRows);
    const hashMutated = await computeMultisetHash(mutatedRows);

    // Multiset hash must be identical for shuffled rows
    expect(hashOriginal).toBe(hashShuffled);

    // Multiset hash must be different for mutated row
    expect(hashOriginal).not.toBe(hashMutated);

    // Content hash (order-dependent) must differ for shuffled rows
    const contentOriginal = await computeContentHash(originalRows);
    const contentShuffled = await computeContentHash(shuffledRows);
    expect(contentOriginal).not.toBe(contentShuffled);
  });

  it("benchmarks planning latency for complex 20-node DAG", () => {
    // Construct a 20-node DAG
    const nodes: PipelineDefinition["nodes"] = [];
    const edges: PipelineDefinition["edges"] = [];

    // Stage 0: 5 sources
    for (let i = 0; i < 5; i++) {
      nodes.push({
        nodeId: `source_${i}`,
        operationType: "select_columns",
        parameters: { columns: ["id", "val"] },
        inputNodeIds: [],
      });
    }

    // Stage 1: 5 filters
    for (let i = 0; i < 5; i++) {
      nodes.push({
        nodeId: `filter_${i}`,
        operationType: "filter_rows",
        parameters: { predicate: "val > 0" },
        inputNodeIds: [`source_${i}`],
      });
      edges.push({ sourceNodeId: `source_${i}`, targetNodeId: `filter_${i}` });
    }

    // Stage 2: derivations
    for (let i = 0; i < 5; i++) {
      nodes.push({
        nodeId: `derive_${i}`,
        operationType: "derive_column",
        parameters: { new_column: `metric_${i}`, expression: "val * 2" },
        inputNodeIds: [`filter_${i}`],
      });
      edges.push({ sourceNodeId: `filter_${i}`, targetNodeId: `derive_${i}` });
    }

    // Stage 3: aggregations
    for (let i = 0; i < 5; i++) {
      nodes.push({
        nodeId: `agg_${i}`,
        operationType: "aggregate_group_by",
        parameters: {
          group_keys: ["id"],
          aggregations: [{ column: "val", func: "sum", alias: "sum_val" }],
        },
        inputNodeIds: [`derive_${i}`],
      });
      edges.push({ sourceNodeId: `derive_${i}`, targetNodeId: `agg_${i}` });
    }

    const pipeline: PipelineDefinition = {
      version: EXECUTION_CONTRACT_VERSION,
      pipelineId: "bench_20_nodes",
      name: "20 Node DAG",
      nodes,
      edges,
      sourceDatasets: {
        source_0: "ds0",
        source_1: "ds1",
        source_2: "ds2",
        source_3: "ds3",
        source_4: "ds4",
      },
    };

    const t0 = performance.now();
    const plan = createExecutionPlan(pipeline);
    const planDurationMs = performance.now() - t0;

    expect(plan.topologicalOrder.length).toBe(20);
    expect(plan.stages.length).toBe(4);
    // Planning 20 nodes should easily take under 50ms (typically < 3ms)
    expect(planDurationMs).toBeLessThan(100);
    console.log(`[Benchmark] 20-Node DAG Planning Time: ${planDurationMs.toFixed(3)} ms`);
  });

  it("benchmarks multiset hashing throughput at 10,000 rows", async () => {
    const N = 10_000;
    const rows: Record<string, unknown>[] = new Array(N);
    for (let i = 0; i < N; i++) {
      rows[i] = {
        id: i,
        account: `ACC_${i % 100}`,
        amount: (i * 1.5) % 1000,
        active: i % 2 === 0,
      };
    }

    const t0 = performance.now();
    const hash = await computeMultisetHash(rows);
    const durationMs = performance.now() - t0;

    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    console.log(`[Benchmark] 10,000 Rows Multiset Hash: ${durationMs.toFixed(2)} ms (${Math.round(N / (durationMs / 1000))} rows/sec)`);
    // Should comfortably compute in under 2000ms
    expect(durationMs).toBeLessThan(2000);
  });

  it("benchmarks multiset hashing throughput at 50,000 rows", async () => {
    const N = 50_000;
    const rows: Record<string, unknown>[] = new Array(N);
    for (let i = 0; i < N; i++) {
      rows[i] = {
        id: i,
        score: i * 2,
        dept: `D_${i % 10}`,
      };
    }

    const t0 = performance.now();
    const hash = await computeMultisetHash(rows);
    const durationMs = performance.now() - t0;

    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    console.log(`[Benchmark] 50,000 Rows Multiset Hash: ${durationMs.toFixed(2)} ms (${Math.round(N / (durationMs / 1000))} rows/sec)`);
    expect(durationMs).toBeLessThan(5000);
  });

  it("benchmarks multiset hashing throughput at 100,000 rows", async () => {
    const N = 100_000;
    const rows: Record<string, unknown>[] = new Array(N);
    for (let i = 0; i < N; i++) {
      rows[i] = {
        id: i,
        v: i % 500,
      };
    }

    const t0 = performance.now();
    const hash = await computeMultisetHash(rows);
    const durationMs = performance.now() - t0;

    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    console.log(`[Benchmark] 100,000 Rows Multiset Hash: ${durationMs.toFixed(2)} ms (${Math.round(N / (durationMs / 1000))} rows/sec)`);
    expect(durationMs).toBeLessThan(10000);
  });
});
