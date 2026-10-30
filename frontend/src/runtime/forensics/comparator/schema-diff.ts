/**
 * Schema Comparison & Drift Engine.
 * Conforms to SPEC-MOD-04 Cases 9 & 10.
 */

import { SchemaDiff } from "../contracts";

export interface ColumnDefinition {
  name: string;
  dataType?: string;
  type?: string;
}

/**
 * Checks whether type mutation is breaking (e.g., numeric/date to string, or string to boolean).
 */
function isBreakingTypeDrift(typeA: string, typeB: string): boolean {
  const normA = typeA.toUpperCase();
  const normB = typeB.toUpperCase();

  if (normA === normB) return false;

  // Numeric coercions between INT and FLOAT are non-breaking
  const isNumA = normA.includes("INT") || normA.includes("FLOAT") || normA.includes("DOUBLE") || normA.includes("DECIMAL");
  const isNumB = normB.includes("INT") || normB.includes("FLOAT") || normB.includes("DOUBLE") || normB.includes("DECIMAL");

  if (isNumA && isNumB) {
    return false;
  }

  // Any other type change is breaking (e.g. INT -> STRING, TIMESTAMP -> INT, etc.)
  return true;
}

export function compareSchemas(
  columnsA: ColumnDefinition[],
  columnsB: ColumnDefinition[]
): SchemaDiff {
  const mapA = new Map(columnsA.map((c) => [c.name, c.dataType || c.type || "VARCHAR"]));
  const mapB = new Map(columnsB.map((c) => [c.name, c.dataType || c.type || "VARCHAR"]));

  const namesA = new Set(mapA.keys());
  const namesB = new Set(mapB.keys());

  const added_columns: string[] = [];
  const removed_columns: string[] = [];
  const common_columns: string[] = [];
  const type_changes: Record<string, [string, string]> = {};
  let has_breaking_type_drift = false;

  for (const name of namesB) {
    if (!namesA.has(name)) {
      added_columns.push(name);
    } else {
      common_columns.push(name);
      const typeA = mapA.get(name)!;
      const typeB = mapB.get(name)!;
      if (typeA.toUpperCase() !== typeB.toUpperCase()) {
        type_changes[name] = [typeA, typeB];
        if (isBreakingTypeDrift(typeA, typeB)) {
          has_breaking_type_drift = true;
        }
      }
    }
  }

  for (const name of namesA) {
    if (!namesB.has(name)) {
      removed_columns.push(name);
    }
  }

  return {
    added_columns,
    removed_columns,
    common_columns,
    type_changes,
    has_breaking_type_drift,
  };
}
