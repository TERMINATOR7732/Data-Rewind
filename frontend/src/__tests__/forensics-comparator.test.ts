/**
 * Unit & Integration Test Suite: Forensic Tabular Comparator (Cases 1–15).
 * Conforms strictly to SPEC-MOD-04 15-case comparison specification.
 */

import { describe, it, expect } from "vitest";
import {
  TabularComparator,
  compareValues,
  compareSchemas,
  computeDatasetFingerprint,
  CaseClassification,
} from "../runtime/forensics/index";

describe("Forensic Tabular Comparator — SPEC-MOD-04 Specification Cases", () => {
  // Case 1: Keyed Comparison with Single Primary Key
  it("Case 1: detects identical, modified, added, and removed rows with single PK", async () => {
    const baseline = [
      { id: "1", name: "Alice", balance: 100 },
      { id: "2", name: "Bob", balance: 200 },
      { id: "3", name: "Charlie", balance: 300 },
    ];
    const target = [
      { id: "1", name: "Alice", balance: 100 }, // identical
      { id: "2", name: "Bob", balance: 250 }, // modified
      { id: "4", name: "Diana", balance: 400 }, // added
      // id: "3" removed
    ];

    const result = await TabularComparator.compare({
      baselineRows: baseline,
      targetRows: target,
      config: { primaryKey: ["id"] },
    });

    expect(result.is_equal).toBe(false);
    expect(result.identical_count).toBe(1);
    expect(result.modified_count).toBe(1);
    expect(result.added_count).toBe(1);
    expect(result.removed_count).toBe(1);
    expect(result.case_classifications).toContain(CaseClassification.CASE_1_KEYED_PK);
    expect(result.case_classifications).toContain(CaseClassification.CASE_8_PARTITION_INVARIANTS);

    // Verify hard partition invariants: |I| + |M| + |R| == |D_A| and |I| + |M| + |A| == |D_B|
    expect(result.identical_count + result.modified_count + result.removed_count).toBe(baseline.length);
    expect(result.identical_count + result.modified_count + result.added_count).toBe(target.length);
  });

  // Case 2: Keyed Comparison with Composite Primary Key
  it("Case 2: correctly matches and differentiates rows using composite keys", async () => {
    const baseline = [
      { tenant_id: "T1", user_id: "U1", role: "admin" },
      { tenant_id: "T1", user_id: "U2", role: "viewer" },
      { tenant_id: "T2", user_id: "U1", role: "editor" },
    ];
    const target = [
      { tenant_id: "T1", user_id: "U1", role: "superadmin" }, // modified
      { tenant_id: "T1", user_id: "U2", role: "viewer" }, // identical
      { tenant_id: "T2", user_id: "U2", role: "guest" }, // added
    ];

    const result = await TabularComparator.compare({
      baselineRows: baseline,
      targetRows: target,
      config: { primaryKey: ["tenant_id", "user_id"] },
    });

    expect(result.is_equal).toBe(false);
    expect(result.case_classifications).toContain(CaseClassification.CASE_2_COMPOSITE_KEY);
    expect(result.identical_count).toBe(1);
    expect(result.modified_count).toBe(1);
    expect(result.added_count).toBe(1);
    expect(result.removed_count).toBe(1);
  });

  // Case 3: Null Key Isolation
  it("Case 3: isolates rows with null primary keys without crashing", async () => {
    const baseline = [
      { id: "1", val: 10 },
      { id: null, val: 20 },
      { id: undefined, val: 30 },
    ];
    const target = [
      { id: "1", val: 10 },
      { id: null, val: 99 },
    ];

    const result = await TabularComparator.compare({
      baselineRows: baseline,
      targetRows: target,
      config: { primaryKey: ["id"] },
    });

    expect(result.case_classifications).toContain(CaseClassification.CASE_3_NULL_KEY);
    expect(result.invalid_key_rows_baseline.length).toBe(2);
    expect(result.invalid_key_rows_target.length).toBe(1);
    expect(result.warnings.some((w) => w.includes("NULL_PRIMARY_KEY_WARNING"))).toBe(true);
  });

  // Case 4: Duplicate Key Violation with Multiset Fallback
  it("Case 4: detects duplicate primary keys and falls back to keyless multiset comparison", async () => {
    const baseline = [
      { id: "dup", val: 1 },
      { id: "dup", val: 2 },
      { id: "unique", val: 3 },
    ];
    const target = [
      { id: "dup", val: 1 },
      { id: "dup", val: 2 },
      { id: "unique", val: 3 },
    ];

    const result = await TabularComparator.compare({
      baselineRows: baseline,
      targetRows: target,
      config: { primaryKey: ["id"] },
    });

    expect(result.case_classifications).toContain(CaseClassification.CASE_4_DUPLICATE_KEY);
    expect(result.duplicate_keys_detected.length).toBeGreaterThan(0);
    expect(result.warnings.some((w) => w.includes("DUPLICATE_KEY_VIOLATION"))).toBe(true);
    // Should fall back to keyless diff and confirm equality
    expect(result.is_equal).toBe(true);
    expect(result.identical_count).toBe(3);
  });

  // Case 5: Keyless Multiset Comparison
  it("Case 5: performs keyless multiset comparison when no primary key is specified", async () => {
    const baseline = [
      { item: "apple", price: 1.0 },
      { item: "banana", price: 0.5 },
      { item: "cherry", price: 2.0 },
    ];
    const target = [
      { item: "cherry", price: 2.0 },
      { item: "apple", price: 1.0 },
      { item: "banana", price: 0.5 },
    ];

    const result = await TabularComparator.compare({
      baselineRows: baseline,
      targetRows: target,
    });

    expect(result.case_classifications).toContain(CaseClassification.CASE_5_KEYLESS_MULTISET);
    expect(result.is_equal).toBe(true);
    expect(result.identical_count).toBe(3);
    expect(result.modified_count).toBe(0);
    expect(result.added_count).toBe(0);
    expect(result.removed_count).toBe(0);
  });

  // Case 6: Reordered Rows Detection
  it("Case 6: detects reordered rows as identical in multiset hash but flags reordering", async () => {
    const baseline = [
      { seq: 1, val: "A" },
      { seq: 2, val: "B" },
      { seq: 3, val: "C" },
    ];
    const target = [
      { seq: 3, val: "C" },
      { seq: 1, val: "A" },
      { seq: 2, val: "B" },
    ];

    const result = await TabularComparator.compare({
      baselineRows: baseline,
      targetRows: target,
    });

    expect(result.is_equal).toBe(true);
    expect(result.case_classifications).toContain(CaseClassification.CASE_6_REORDERED_ROWS);
    expect(result.identical_count).toBe(3);
  });

  // Case 7: Identical Duplicates Preservation
  it("Case 7: preserves multiplicity of duplicate identical rows", async () => {
    const baseline = [
      { tag: "X" },
      { tag: "X" },
      { tag: "X" },
    ];
    const target = [
      { tag: "X" },
      { tag: "X" },
    ]; // one instance removed

    const result = await TabularComparator.compare({
      baselineRows: baseline,
      targetRows: target,
    });

    expect(result.case_classifications).toContain(CaseClassification.CASE_7_IDENTICAL_DUPLICATES);
    expect(result.is_equal).toBe(false);
    expect(result.identical_count).toBe(2);
    expect(result.removed_count).toBe(1);
    expect(result.added_count).toBe(0);
  });

  // Case 8: Hard Partition Invariants Check
  it("Case 8: strictly enforces partition completeness invariants across all diffs", async () => {
    const baseline = Array.from({ length: 50 }, (_, i) => ({ id: `id_${i}`, val: i }));
    const target = [
      ...baseline.slice(0, 30), // 30 identical
      ...baseline.slice(30, 40).map((r) => ({ id: r.id, val: r.val + 100 })), // 10 modified
      // 10 removed (slice 40..50)
      { id: "new_1", val: 999 }, // 2 added
      { id: "new_2", val: 1000 },
    ];

    const result = await TabularComparator.compare({
      baselineRows: baseline,
      targetRows: target,
      config: { primaryKey: ["id"] },
    });

    expect(result.identical_count).toBe(30);
    expect(result.modified_count).toBe(10);
    expect(result.removed_count).toBe(10);
    expect(result.added_count).toBe(2);

    // Invariant: |I| + |M| + |R| == |D_A|
    expect(result.identical_count + result.modified_count + result.removed_count).toBe(50);
    // Invariant: |I| + |M| + |A| == |D_B|
    expect(result.identical_count + result.modified_count + result.added_count).toBe(42);
  });

  // Case 9: Schema Drift (Added & Removed Columns)
  it("Case 9: detects added and removed columns with schema drift classification", async () => {
    const baseCols = [{ name: "id" }, { name: "email" }, { name: "created_at" }];
    const targCols = [{ name: "id" }, { name: "email" }, { name: "updated_at" }];

    const diff = compareSchemas(baseCols, targCols);

    expect(diff.common_columns).toEqual(["id", "email"]);
    expect(diff.removed_columns).toEqual(["created_at"]);
    expect(diff.added_columns).toEqual(["updated_at"]);
    expect(diff.has_breaking_type_drift).toBe(false);
  });

  // Case 10: Type Coercion & Breaking Type Drift
  it("Case 10: identifies type conversions and flags breaking type drift", async () => {
    const baseCols = [
      { name: "id", dataType: "INTEGER" },
      { name: "amount", dataType: "DECIMAL" },
    ];
    const targCols = [
      { name: "id", dataType: "VARCHAR" }, // safe widening
      { name: "amount", dataType: "BOOLEAN" }, // breaking type drift
    ];

    const diff = compareSchemas(baseCols, targCols);
    expect(diff.type_changes["id"]).toEqual(["INTEGER", "VARCHAR"]);
    expect(diff.type_changes["amount"]).toEqual(["DECIMAL", "BOOLEAN"]);
    expect(diff.has_breaking_type_drift).toBe(true);
  });

  // Case 11: Floating-Point Tolerances (|v_A - v_B| <= atol + rtol * |v_B|)
  it("Case 11: evaluates floating-point equality within specified atol and rtol", () => {
    const vA = 100.0000001;
    const vB = 100.0;

    // Default atol=1e-6, rtol=1e-5: difference is 1e-7 <= 1e-6 + 1e-3
    const match = compareValues("score", vA, vB, { atol: 1e-6, rtol: 1e-5 });
    expect(match?.is_numeric_tolerant_match).toBe(true);

    // Stricter tolerances: atol=1e-9, rtol=1e-10: difference is 1e-7 > atol + rtol*vB
    const strictMatch = compareValues("score", vA, vB, { atol: 1e-9, rtol: 1e-10 });
    expect(strictMatch?.is_numeric_tolerant_match).toBe(false);
  });

  // Case 12: Decimal / Integer Arithmetic Equality
  it("Case 12: treats mathematically equivalent integers and floats as matching", () => {
    const res1 = compareValues("qty", 42, 42.0);
    expect(res1).toBeNull();

    const res2 = compareValues("qty", 0, -0.0);
    expect(res2).toBeNull();
  });

  // Case 13: Numeric Corruption (Finite -> NaN / Infinity / Null)
  it("Case 13: flags numeric corruption when a finite number transitions to NaN or Infinity", () => {
    const nanDiff = compareValues("ratio", 12.5, NaN);
    expect(nanDiff?.is_numeric_corruption).toBe(true);

    const infDiff = compareValues("ratio", 12.5, Infinity);
    expect(infDiff?.is_numeric_corruption).toBe(true);

    const nullTransition = compareValues("ratio", 12.5, null);
    expect(nullTransition?.is_null_transition).toBe(true);
  });

  // Case 14: String Normalization (NFC Unicode, Whitespace & Case Controls)
  it("Case 14: performs Unicode NFC normalization and respects whitespace/case flags", () => {
    // Unicode: 'é' as single code point vs 'e' + combining acute accent
    const nfc1 = "caf\u00e9"; // café (precomposed)
    const nfc2 = "cafe\u0301"; // café (decomposed)

    const unicodeMatch = compareValues("label", nfc1, nfc2);
    expect(unicodeMatch).toBeNull();

    // Whitespace handling
    const wsDiff = compareValues("text", "hello world", "  hello world  ", { ignoreWhitespace: true });
    expect(wsDiff).toBeNull();

    // Case handling
    const caseDiff = compareValues("code", "ABC", "abc", { caseSensitive: false });
    expect(caseDiff).toBeNull();
  });

  // Case 15: Dataset Fingerprinting
  it("Case 15: computes cryptographic SHA-256 dataset fingerprint with multiset hash", async () => {
    const schemaDiff = {
      added_columns: [],
      removed_columns: [],
      common_columns: ["id", "val"],
      type_changes: {},
      has_breaking_type_drift: false,
    };

    const fp1 = await computeDatasetFingerprint(schemaDiff, "multiset_hash_abc", 100);
    const fp2 = await computeDatasetFingerprint(schemaDiff, "multiset_hash_abc", 100);
    const fp3 = await computeDatasetFingerprint(schemaDiff, "multiset_hash_xyz", 100);

    expect(fp1.fingerprint_hash).toBe(fp2.fingerprint_hash);
    expect(fp1.fingerprint_hash).not.toBe(fp3.fingerprint_hash);
    expect(fp1.row_count).toBe(100);
  });
});
