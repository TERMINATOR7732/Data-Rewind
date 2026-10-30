/**
 * Unified Forensic Tabular Comparator Engine.
 * Conforms strictly to SPEC-MOD-04 15-case comparison specification.
 */

import { computeMultisetHash } from "../../pipeline/hashing";
import { CaseClassification, ComparisonConfig, TabularDiffResult } from "../contracts";
import { computeDatasetFingerprint } from "./fingerprint";
import { executeKeyedDiff } from "./keyed-diff";
import { executeKeylessDiff } from "./keyless-diff";
import { ColumnDefinition, compareSchemas } from "./schema-diff";

export * from "./schema-diff";
export * from "./value-diff";
export * from "./fingerprint";
export * from "./keyed-diff";
export * from "./keyless-diff";

export interface CompareDatasetsOptions {
  baselineRows: Record<string, unknown>[];
  targetRows: Record<string, unknown>[];
  baselineColumns?: ColumnDefinition[];
  targetColumns?: ColumnDefinition[];
  config?: ComparisonConfig;
}

export class TabularComparator {
  /**
   * Compares two tabular datasets across the 15 specification cases.
   */
  public static async compare(options: CompareDatasetsOptions): Promise<TabularDiffResult> {
    const startTime = performance.now();
    const { baselineRows, targetRows, config = {} } = options;

    // 1. Schema Comparison (Case 9 & 10)
    const baseCols: ColumnDefinition[] =
      options.baselineColumns ??
      (baselineRows.length > 0 ? Object.keys(baselineRows[0]).map((name) => ({ name })) : []);
    const targCols: ColumnDefinition[] =
      options.targetColumns ??
      (targetRows.length > 0 ? Object.keys(targetRows[0]).map((name) => ({ name })) : []);

    const schemaDiff = compareSchemas(baseCols, targCols);
    const caseClassifications: CaseClassification[] = [];

    if (schemaDiff.added_columns.length > 0 || schemaDiff.removed_columns.length > 0) {
      caseClassifications.push(CaseClassification.CASE_9_SCHEMA_DRIFT);
    }
    if (Object.keys(schemaDiff.type_changes).length > 0) {
      caseClassifications.push(CaseClassification.CASE_10_TYPE_COERCION);
    }

    // 2. Multiset Hashes & Dataset Fingerprints (Case 15)
    const baseMultisetHash = await computeMultisetHash(baselineRows);
    const targMultisetHash = await computeMultisetHash(targetRows);

    const baselineFingerprint = await computeDatasetFingerprint(
      schemaDiff,
      baseMultisetHash,
      baselineRows.length
    );
    const targetFingerprint = await computeDatasetFingerprint(
      schemaDiff,
      targMultisetHash,
      targetRows.length
    );
    caseClassifications.push(CaseClassification.CASE_15_FINGERPRINT);

    // 3. Execution Path Selection: Keyed vs Keyless
    const commonColumns = schemaDiff.common_columns;
    const primaryKey = config.primaryKey;
    const hasCandidateKey =
      primaryKey &&
      primaryKey.length > 0 &&
      primaryKey.every((k) => commonColumns.includes(k));

    let diffOutput: {
      caseClassifications: CaseClassification[];
      identicalCount: number;
      modifiedCount: number;
      addedCount: number;
      removedCount: number;
      sampleRowDiffs: any[];
      warnings: string[];
      invalidKeyRowsBaseline?: Record<string, unknown>[];
      invalidKeyRowsTarget?: Record<string, unknown>[];
      duplicateKeysDetected?: string[];
    };

    if (hasCandidateKey) {
      // Attempt Keyed Outer Join
      const keyedRes = executeKeyedDiff(
        baselineRows,
        targetRows,
        primaryKey,
        commonColumns,
        config
      );

      if (keyedRes.duplicateKeyViolation) {
        // Fallback to Keyless Multiset (Case 4 -> Case 5)
        const keylessRes = executeKeylessDiff(
          baselineRows,
          targetRows,
          commonColumns,
          config
        );
        diffOutput = {
          ...keylessRes,
          caseClassifications: [
            CaseClassification.CASE_4_DUPLICATE_KEY,
            ...keylessRes.caseClassifications,
          ],
          warnings: [...keyedRes.warnings, ...keylessRes.warnings],
          duplicateKeysDetected: keyedRes.duplicateKeys,
          invalidKeyRowsBaseline: keyedRes.invalidKeyRowsBaseline,
          invalidKeyRowsTarget: keyedRes.invalidKeyRowsTarget,
        };
      } else {
        diffOutput = {
          ...keyedRes,
          duplicateKeysDetected: [],
        };
      }
    } else {
      // Keyless Multiset Diff
      const keylessRes = executeKeylessDiff(
        baselineRows,
        targetRows,
        commonColumns,
        config
      );
      diffOutput = {
        ...keylessRes,
        invalidKeyRowsBaseline: [],
        invalidKeyRowsTarget: [],
        duplicateKeysDetected: [],
      };
    }

    const mergedCases = Array.from(
      new Set([...caseClassifications, ...diffOutput.caseClassifications])
    );
    const durationMs = performance.now() - startTime;

    const isEqual =
      diffOutput.modifiedCount === 0 &&
      diffOutput.addedCount === 0 &&
      diffOutput.removedCount === 0 &&
      !schemaDiff.has_breaking_type_drift &&
      schemaDiff.added_columns.length === 0 &&
      schemaDiff.removed_columns.length === 0;

    return {
      is_equal: isEqual,
      case_classifications: mergedCases,
      schema_diff: schemaDiff,
      baseline_fingerprint: baselineFingerprint,
      target_fingerprint: targetFingerprint,
      identical_count: diffOutput.identicalCount,
      modified_count: diffOutput.modifiedCount,
      added_count: diffOutput.addedCount,
      removed_count: diffOutput.removedCount,
      baseline_row_count: baselineRows.length,
      target_row_count: targetRows.length,
      sample_row_diffs: diffOutput.sampleRowDiffs,
      warnings: diffOutput.warnings,
      invalid_key_rows_baseline: diffOutput.invalidKeyRowsBaseline || [],
      invalid_key_rows_target: diffOutput.invalidKeyRowsTarget || [],
      duplicate_keys_detected: diffOutput.duplicateKeysDetected || [],
      execution_duration_ms: Math.round(durationMs * 100) / 100,
    };
  }
}
