/**
 * Keyed Tabular Comparison Engine.
 * Conforms to SPEC-MOD-04 Cases 1, 2, 3, 4, 8, 11, 12, 13, 14.
 */

import { serializeDeterministic } from "../../contracts/index";
import { CaseClassification, ComparisonConfig, RowDiff, ValueDiff } from "../contracts";
import { compareValues } from "./value-diff";

export interface KeyedDiffOutput {
  duplicateKeyViolation: boolean;
  duplicateKeys: string[];
  caseClassifications: CaseClassification[];
  identicalCount: number;
  modifiedCount: number;
  addedCount: number;
  removedCount: number;
  sampleRowDiffs: RowDiff[];
  warnings: string[];
  invalidKeyRowsBaseline: Record<string, unknown>[];
  invalidKeyRowsTarget: Record<string, unknown>[];
}

/**
 * Serializes primary key values into an unambiguous lookup key.
 */
function serializeKeyTuple(row: Record<string, unknown>, keys: string[]): string {
  const tuple = keys.map((k) => row[k]);
  return serializeDeterministic(tuple);
}

export function executeKeyedDiff(
  rowsA: Record<string, unknown>[],
  rowsB: Record<string, unknown>[],
  primaryKey: string[],
  commonColumns: string[],
  config: ComparisonConfig = {}
): KeyedDiffOutput {
  const caseClassifications: CaseClassification[] = [
    primaryKey.length > 1 ? CaseClassification.CASE_2_COMPOSITE_KEY : CaseClassification.CASE_1_KEYED_PK,
  ];
  const warnings: string[] = [];
  const maxSamples = config.maxSamples ?? 100;

  // 1. Null Key Isolation (Case 3)
  const validRowsA: Record<string, unknown>[] = [];
  const invalidKeyRowsBaseline: Record<string, unknown>[] = [];

  for (const r of rowsA) {
    const hasNullKey = primaryKey.some((k) => r[k] === null || r[k] === undefined);
    if (hasNullKey) {
      invalidKeyRowsBaseline.push(r);
    } else {
      validRowsA.push(r);
    }
  }

  const validRowsB: Record<string, unknown>[] = [];
  const invalidKeyRowsTarget: Record<string, unknown>[] = [];

  for (const r of rowsB) {
    const hasNullKey = primaryKey.some((k) => r[k] === null || r[k] === undefined);
    if (hasNullKey) {
      invalidKeyRowsTarget.push(r);
    } else {
      validRowsB.push(r);
    }
  }

  if (invalidKeyRowsBaseline.length > 0 || invalidKeyRowsTarget.length > 0) {
    caseClassifications.push(CaseClassification.CASE_3_NULL_KEY);
    warnings.push(
      `NULL_PRIMARY_KEY_WARNING: Isolated ${invalidKeyRowsBaseline.length} baseline and ${invalidKeyRowsTarget.length} target rows with NULL in primary key [${primaryKey.join(", ")}].`
    );
  }

  // 2. Duplicate Key Detection (Case 4)
  const mapA = new Map<string, Record<string, unknown>>();
  const dupKeysA = new Set<string>();

  for (const r of validRowsA) {
    const keyStr = serializeKeyTuple(r, primaryKey);
    if (mapA.has(keyStr)) {
      dupKeysA.add(keyStr);
    } else {
      mapA.set(keyStr, r);
    }
  }

  const mapB = new Map<string, Record<string, unknown>>();
  const dupKeysB = new Set<string>();

  for (const r of validRowsB) {
    const keyStr = serializeKeyTuple(r, primaryKey);
    if (mapB.has(keyStr)) {
      dupKeysB.add(keyStr);
    } else {
      mapB.set(keyStr, r);
    }
  }

  const allDuplicateKeys = Array.from(new Set([...dupKeysA, ...dupKeysB]));

  if (allDuplicateKeys.length > 0) {
    // Duplicate Key Violation: abort outer join and trigger Case 5 fallback
    return {
      duplicateKeyViolation: true,
      duplicateKeys: allDuplicateKeys,
      caseClassifications: [CaseClassification.CASE_4_DUPLICATE_KEY],
      identicalCount: 0,
      modifiedCount: 0,
      addedCount: 0,
      removedCount: 0,
      sampleRowDiffs: [],
      warnings: [
        `DUPLICATE_KEY_VIOLATION: ${allDuplicateKeys.length} duplicate primary key collisions detected. Aborting 1-to-1 keyed alignment.`,
      ],
      invalidKeyRowsBaseline,
      invalidKeyRowsTarget,
    };
  }

  // 3. Partition Alignment (Cases 1, 2, 8)
  let identicalCount = 0;
  let modifiedCount = 0;
  let addedCount = invalidKeyRowsTarget.length; // Null key rows in target count as added
  let removedCount = invalidKeyRowsBaseline.length; // Null key rows in baseline count as removed
  const sampleRowDiffs: RowDiff[] = [];

  // Match rows in mapA against mapB
  for (const [keyStr, rA] of mapA.entries()) {
    const rB = mapB.get(keyStr);

    const keyValues: Record<string, unknown> = {};
    for (const k of primaryKey) {
      keyValues[k] = rA[k];
    }

    if (!rB) {
      // Removed row
      removedCount++;
      if (sampleRowDiffs.length < maxSamples) {
        sampleRowDiffs.push({
          category: "REMOVED",
          key_values: keyValues,
          baseline_row: rA,
          target_row: null,
          field_diffs: [],
          _diff_status: "REMOVED",
          _key_values: keyValues,
        });
      }
    } else {
      // Key present in both: compare fields across common columns
      const fieldDiffs: ValueDiff[] = [];
      let rowHasDifference = false;

      for (const col of commonColumns) {
        const diff = compareValues(col, rA[col], rB[col], config);
        if (diff !== null) {
          if (diff.is_numeric_tolerant_match) {
            caseClassifications.push(CaseClassification.CASE_11_FLOAT_TOLERANCE);
          } else {
            rowHasDifference = true;
            fieldDiffs.push(diff);
            if (diff.is_null_transition) {
              caseClassifications.push(CaseClassification.CASE_13_NAN_INF_NULL);
            }
            if (diff.is_numeric_corruption) {
              caseClassifications.push(CaseClassification.CASE_13_NAN_INF_NULL);
            }
          }
        }
      }

      if (rowHasDifference) {
        modifiedCount++;
        if (sampleRowDiffs.length < maxSamples) {
          sampleRowDiffs.push({
            category: "MODIFIED",
            key_values: keyValues,
            baseline_row: rA,
            target_row: rB,
            field_diffs: fieldDiffs,
            _diff_status: "MODIFIED",
            _key_values: keyValues,
            _field_diffs: fieldDiffs,
          });
        }
      } else {
        identicalCount++;
        if (sampleRowDiffs.length < maxSamples) {
          sampleRowDiffs.push({
            category: "IDENTICAL",
            key_values: keyValues,
            _key_values: keyValues,
            baseline_row: rA,
            target_row: rB,
            field_diffs: [],
            _diff_status: "IDENTICAL",
          });
        }
      }
    }
  }

  // Rows present in mapB but not mapA (Added)
  for (const [keyStr, rB] of mapB.entries()) {
    if (!mapA.has(keyStr)) {
      addedCount++;
      const keyValues: Record<string, unknown> = {};
      for (const k of primaryKey) {
        keyValues[k] = rB[k];
      }
      if (sampleRowDiffs.length < maxSamples) {
        sampleRowDiffs.push({
          category: "ADDED",
          key_values: keyValues,
          baseline_row: null,
          target_row: rB,
          field_diffs: [],
          _diff_status: "ADDED",
          _key_values: keyValues,
        });
      }
    }
  }

  // Add null key samples if capacity permits
  for (const r of invalidKeyRowsBaseline) {
    if (sampleRowDiffs.length < maxSamples) {
      sampleRowDiffs.push({
        category: "REMOVED",
        key_values: { _invalid_null_key: true },
        _key_values: { _invalid_null_key: true },
        baseline_row: r,
        target_row: null,
        field_diffs: [],
        _diff_status: "REMOVED",
      });
    }
  }
  for (const r of invalidKeyRowsTarget) {
    if (sampleRowDiffs.length < maxSamples) {
      sampleRowDiffs.push({
        category: "ADDED",
        key_values: { _invalid_null_key: true },
        _key_values: { _invalid_null_key: true },
        baseline_row: null,
        target_row: r,
        field_diffs: [],
        _diff_status: "ADDED",
      });
    }
  }

  // 4. Mathematical Partition Invariants Assertion (Case 8)
  const invariantBaseline = identicalCount + modifiedCount + removedCount === rowsA.length;
  const invariantTarget = identicalCount + modifiedCount + addedCount === rowsB.length;

  if (invariantBaseline && invariantTarget) {
    caseClassifications.push(CaseClassification.CASE_8_PARTITION_INVARIANTS);
  } else {
    warnings.push(
      `PARTITION_INVARIANT_VIOLATION: Invariants failed (|I|+|M|+|R|=${identicalCount + modifiedCount + removedCount} vs ${rowsA.length}, |I|+|M|+|A|=${identicalCount + modifiedCount + addedCount} vs ${rowsB.length}).`
    );
  }

  return {
    duplicateKeyViolation: false,
    duplicateKeys: [],
    caseClassifications: Array.from(new Set(caseClassifications)),
    identicalCount,
    modifiedCount,
    addedCount,
    removedCount,
    sampleRowDiffs,
    warnings,
    invalidKeyRowsBaseline,
    invalidKeyRowsTarget,
  };
}
