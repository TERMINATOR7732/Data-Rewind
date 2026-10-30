/**
 * Performance Benchmarks & Partition Invariants Suite for Forensic Tabular Comparator.
 * Tests scaling across 10,000, 50,000, and 100,000 rows.
 * Validates throughput, execution latency, and strict partition completeness.
 */

import { describe, it, expect } from "vitest";
import { TabularComparator } from "../runtime/forensics/index";

function generateBenchmarkDatasets(rowCount: number, mutationRatio: number = 0.05, addedRatio: number = 0.02, removedRatio: number = 0.02) {
  const baseline: Record<string, unknown>[] = new Array(rowCount);
  const target: Record<string, unknown>[] = [];

  const modCount = Math.floor(rowCount * mutationRatio);
  const addCount = Math.floor(rowCount * addedRatio);
  const remCount = Math.floor(rowCount * removedRatio);

  for (let i = 0; i < rowCount; i++) {
    baseline[i] = {
      id: `txn_${i}`,
      user_id: `user_${i % 1000}`,
      amount: 100.0 + (i % 500),
      currency: "USD",
      status: i % 2 === 0 ? "SETTLED" : "PENDING",
    };
  }

  // Identical rows: slice from remCount to rowCount - modCount
  const identicalCutoff = rowCount - remCount - modCount;
  for (let i = remCount; i < remCount + identicalCutoff; i++) {
    target.push(baseline[i]);
  }

  // Modified rows
  for (let i = remCount + identicalCutoff; i < rowCount; i++) {
    const orig = baseline[i];
    target.push({
      ...orig,
      amount: (orig.amount as number) + 99.5, // modified value
    });
  }

  // Added rows
  for (let i = 0; i < addCount; i++) {
    target.push({
      id: `txn_new_${i}`,
      user_id: `user_new_${i}`,
      amount: 999.0,
      currency: "EUR",
      status: "SETTLED",
    });
  }

  return { baseline, target, modCount, addCount, remCount };
}

describe("Forensic Tabular Comparator — Scaling & Benchmark Suite", () => {
  it("benchmarks 10,000 rows keyed comparison with partition invariants", async () => {
    const { baseline, target } = generateBenchmarkDatasets(10_000);

    const start = performance.now();
    const result = await TabularComparator.compare({
      baselineRows: baseline,
      targetRows: target,
      config: { primaryKey: ["id"] },
    });
    const durationMs = performance.now() - start;

    console.log(`[Benchmark] 10,000 Rows Keyed Comparison: ${durationMs.toFixed(2)} ms (${Math.round((10000 / durationMs) * 1000)} rows/sec)`);

    // Verify invariants: |I| + |M| + |R| == |D_A| and |I| + |M| + |A| == |D_B|
    expect(result.identical_count + result.modified_count + result.removed_count).toBe(baseline.length);
    expect(result.identical_count + result.modified_count + result.added_count).toBe(target.length);
    expect(result.is_equal).toBe(false);
    expect(durationMs).toBeLessThan(10_000); // Must be well within limit
  });

  it("benchmarks 50,000 rows keyed comparison with partition invariants", async () => {
    const { baseline, target } = generateBenchmarkDatasets(50_000);

    const start = performance.now();
    const result = await TabularComparator.compare({
      baselineRows: baseline,
      targetRows: target,
      config: { primaryKey: ["id"] },
    });
    const durationMs = performance.now() - start;

    console.log(`[Benchmark] 50,000 Rows Keyed Comparison: ${durationMs.toFixed(2)} ms (${Math.round((50000 / durationMs) * 1000)} rows/sec)`);

    // Invariant assertions
    expect(result.identical_count + result.modified_count + result.removed_count).toBe(baseline.length);
    expect(result.identical_count + result.modified_count + result.added_count).toBe(target.length);
    expect(result.is_equal).toBe(false);
    expect(durationMs).toBeLessThan(15_000);
  });

  it("benchmarks 100,000 rows keyed comparison with partition invariants", async () => {
    const { baseline, target } = generateBenchmarkDatasets(100_000);

    const start = performance.now();
    const result = await TabularComparator.compare({
      baselineRows: baseline,
      targetRows: target,
      config: { primaryKey: ["id"] },
    });
    const durationMs = performance.now() - start;

    console.log(`[Benchmark] 100,000 Rows Keyed Comparison: ${durationMs.toFixed(2)} ms (${Math.round((100000 / durationMs) * 1000)} rows/sec)`);

    // Invariant assertions
    expect(result.identical_count + result.modified_count + result.removed_count).toBe(baseline.length);
    expect(result.identical_count + result.modified_count + result.added_count).toBe(target.length);
    expect(result.is_equal).toBe(false);
    expect(durationMs).toBeLessThan(30_000);
  }, 30_000);

  it("benchmarks 10,000 rows keyless multiset comparison", async () => {
    const { baseline, target } = generateBenchmarkDatasets(10_000);

    const start = performance.now();
    const result = await TabularComparator.compare({
      baselineRows: baseline,
      targetRows: target,
    });
    const durationMs = performance.now() - start;

    console.log(`[Benchmark] 10,000 Rows Keyless Comparison: ${durationMs.toFixed(2)} ms`);

    // Multiset Invariants: |I| + |R| == |D_A| and |I| + |A| == |D_B|
    expect(result.identical_count + result.removed_count).toBe(baseline.length);
    expect(result.identical_count + result.added_count).toBe(target.length);
    expect(durationMs).toBeLessThan(10_000);
  });
});
