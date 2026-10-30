/**
 * Cell-Level Forensic Value Diff Engine.
 * Conforms to SPEC-MOD-04 Cases 10, 11, 12, 13, 14.
 */

import { ComparisonConfig, ValueDiff } from "../contracts";

/**
 * Compares two cell values and returns ValueDiff if unequal, or null if identical.
 */
export function compareValues(
  column: string,
  valA: unknown,
  valB: unknown,
  config: ComparisonConfig = {}
): ValueDiff | null {
  const atol = config.atol ?? 1e-6;
  const rtol = config.rtol ?? 1e-5;
  const caseSensitive = config.caseSensitive ?? true;
  const ignoreWhitespace = config.ignoreWhitespace ?? false;

  // Case 13: Both null or undefined
  if ((valA === null || valA === undefined) && (valB === null || valB === undefined)) {
    return null;
  }

  // Null transition (one is null/undefined, one is not)
  if (
    (valA === null || valA === undefined && valB !== null && valB !== undefined) ||
    (valB === null || valB === undefined && valA !== null && valA !== undefined)
  ) {
    return {
      column,
      baseline_value: valA ?? null,
      target_value: valB ?? null,
      is_numeric_tolerant_match: false,
      is_null_transition: true,
      is_numeric_corruption: false,
    };
  }

  // Numbers (Case 11 & 13)
  if (typeof valA === "number" || typeof valB === "number" || typeof valA === "bigint" || typeof valB === "bigint") {
    const numA = Number(valA);
    const numB = Number(valB);

    // NaN handling: NaN == NaN is identical for diff purposes, but both are NaN
    if (Number.isNaN(numA) && Number.isNaN(numB)) {
      return null;
    }

    // Finite -> NaN or Inf corruption
    if (Number.isFinite(numA) && (!Number.isFinite(numB) || Number.isNaN(numB))) {
      return {
        column,
        baseline_value: valA,
        target_value: valB,
        is_numeric_tolerant_match: false,
        is_null_transition: false,
        is_numeric_corruption: true,
      };
    }

    // Both are finite numbers: test floating-point tolerance (Case 11)
    if (Number.isFinite(numA) && Number.isFinite(numB)) {
      const diff = Math.abs(numA - numB);
      const tolerance = atol + rtol * Math.abs(numB);

      if (diff <= tolerance) {
        if (numA === numB) {
          return null; // Exact match
        }
        // Within tolerance: classified as tolerant match (does not trigger diff if allowed)
        return {
          column,
          baseline_value: valA,
          target_value: valB,
          is_numeric_tolerant_match: true,
          is_null_transition: false,
          is_numeric_corruption: false,
        };
      }
    }
  }

  // Strings (Case 14: NFC Unicode normalization & whitespace)
  if (typeof valA === "string" || typeof valB === "string") {
    let strA = String(valA ?? "").normalize("NFC");
    let strB = String(valB ?? "").normalize("NFC");

    if (ignoreWhitespace) {
      strA = strA.trim();
      strB = strB.trim();
    }

    if (!caseSensitive) {
      strA = strA.toLowerCase();
      strB = strB.toLowerCase();
    }

    if (strA === strB) {
      return null;
    }
  }

  // Booleans or generic equality
  if (valA === valB) {
    return null;
  }

  return {
    column,
    baseline_value: valA,
    target_value: valB,
    is_numeric_tolerant_match: false,
    is_null_transition: false,
    is_numeric_corruption: false,
  };
}
