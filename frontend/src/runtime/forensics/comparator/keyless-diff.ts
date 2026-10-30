/**
 * Keyless Multiset (Bag) Tabular Comparison Engine.
 * Conforms to SPEC-MOD-04 Cases 5, 6, 7, 8.
 */

import { serializeDeterministic } from "../../contracts/index";
import { computeSha256Sync } from "../../pipeline/hashing";
import { CaseClassification, ComparisonConfig, RowDiff } from "../contracts";

export interface KeylessDiffOutput {
  caseClassifications: CaseClassification[];
  identicalCount: number;
  modifiedCount: number;
  addedCount: number;
  removedCount: number;
  sampleRowDiffs: RowDiff[];
  warnings: string[];
}

export function executeKeylessDiff(
  rowsA: Record<string, unknown>[],
  rowsB: Record<string, unknown>[],
  commonColumns: string[],
  config: ComparisonConfig = {}
): KeylessDiffOutput {
  const caseClassifications: CaseClassification[] = [CaseClassification.CASE_5_KEYLESS_MULTISET];
  const warnings: string[] = [];
  const maxSamples = config.maxSamples ?? 100;

  // Project rows to common columns and compute canonical row hash
  const projectRow = (r: Record<string, unknown>): Record<string, unknown> => {
    const proj: Record<string, unknown> = {};
    for (const c of commonColumns) {
      proj[c] = r[c];
    }
    return proj;
  };

  // Build row hash frequency distributions
  const freqA = new Map<string, { count: number; sampleRow: Record<string, unknown> }>();
  for (const r of rowsA) {
    const proj = projectRow(r);
    const h = computeSha256Sync(serializeDeterministic(proj));
    const entry = freqA.get(h);
    if (entry) {
      entry.count++;
    } else {
      freqA.set(h, { count: 1, sampleRow: proj });
    }
  }

  const freqB = new Map<string, { count: number; sampleRow: Record<string, unknown> }>();
  for (const r of rowsB) {
    const proj = projectRow(r);
    const h = computeSha256Sync(serializeDeterministic(proj));
    const entry = freqB.get(h);
    if (entry) {
      entry.count++;
    } else {
      freqB.set(h, { count: 1, sampleRow: proj });
    }
  }

  let identicalCount = 0;
  let addedCount = 0;
  let removedCount = 0;
  let hasMultiplicity = false;
  const sampleRowDiffs: RowDiff[] = [];

  const allHashes = new Set([...freqA.keys(), ...freqB.keys()]);

  for (const h of allHashes) {
    const countA = freqA.get(h)?.count ?? 0;
    const countB = freqB.get(h)?.count ?? 0;

    if (countA > 1 || countB > 1) {
      hasMultiplicity = true;
    }

    const matched = Math.min(countA, countB);
    identicalCount += matched;

    if (matched > 0 && sampleRowDiffs.length < maxSamples) {
      const sampleRow = (freqA.get(h) || freqB.get(h))!.sampleRow;
      for (let i = 0; i < Math.min(matched, maxSamples - sampleRowDiffs.length); i++) {
        sampleRowDiffs.push({
          category: "IDENTICAL",
          key_values: { _row_hash: h.slice(0, 16) },
          _key_values: { _row_hash: h.slice(0, 16) },
          baseline_row: sampleRow,
          target_row: sampleRow,
          field_diffs: [],
          row_hash_baseline: h,
          row_hash_target: h,
          _diff_status: "IDENTICAL",
        });
      }
    }

    if (countA > countB) {
      const removedInstances = countA - countB;
      removedCount += removedInstances;
      const sampleRow = freqA.get(h)!.sampleRow;
      for (let i = 0; i < Math.min(removedInstances, maxSamples - sampleRowDiffs.length); i++) {
        sampleRowDiffs.push({
          category: "REMOVED",
          key_values: { _row_hash: h.slice(0, 16) },
          _key_values: { _row_hash: h.slice(0, 16) },
          baseline_row: sampleRow,
          target_row: null,
          field_diffs: [],
          row_hash_baseline: h,
          _diff_status: "REMOVED",
        });
      }
    } else if (countB > countA) {
      const addedInstances = countB - countA;
      addedCount += addedInstances;
      const sampleRow = freqB.get(h)!.sampleRow;
      for (let i = 0; i < Math.min(addedInstances, maxSamples - sampleRowDiffs.length); i++) {
        sampleRowDiffs.push({
          category: "ADDED",
          key_values: { _row_hash: h.slice(0, 16) },
          _key_values: { _row_hash: h.slice(0, 16) },
          baseline_row: null,
          target_row: sampleRow,
          field_diffs: [],
          row_hash_target: h,
          _diff_status: "ADDED",
        });
      }
    }
  }

  if (hasMultiplicity) {
    caseClassifications.push(CaseClassification.CASE_7_IDENTICAL_DUPLICATES);
  }

  // Check reordered rows (Case 6)
  if (addedCount === 0 && removedCount === 0 && rowsA.length === rowsB.length && rowsA.length > 0) {
    // Check if physical sequence differs
    let sequenceIdentical = true;
    for (let i = 0; i < rowsA.length; i++) {
      const hA = computeSha256Sync(serializeDeterministic(projectRow(rowsA[i])));
      const hB = computeSha256Sync(serializeDeterministic(projectRow(rowsB[i])));
      if (hA !== hB) {
        sequenceIdentical = false;
        break;
      }
    }
    if (!sequenceIdentical) {
      caseClassifications.push(CaseClassification.CASE_6_REORDERED_ROWS);
    }
  }

  // Partition Invariant Verification (Case 8)
  const invariantA = identicalCount + removedCount === rowsA.length;
  const invariantB = identicalCount + addedCount === rowsB.length;

  if (invariantA && invariantB) {
    caseClassifications.push(CaseClassification.CASE_8_PARTITION_INVARIANTS);
  } else {
    warnings.push(
      `KEYLESS_PARTITION_VIOLATION: Invariants failed (|I|+|R|=${identicalCount + removedCount} vs ${rowsA.length}, |I|+|A|=${identicalCount + addedCount} vs ${rowsB.length}).`
    );
  }

  return {
    caseClassifications: Array.from(new Set(caseClassifications)),
    identicalCount,
    modifiedCount: 0, // Keyless multiset does not perform ambiguous row correspondence
    addedCount,
    removedCount,
    sampleRowDiffs,
    warnings,
  };
}
