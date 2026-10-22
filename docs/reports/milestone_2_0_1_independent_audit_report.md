# DATA REWIND — MILESTONE 2.0.1: INDEPENDENT COMPARATOR AUDIT AND MILESTONE 3 READINESS GATE

**Document Version:** 1.0.0  
**Audit Milestone:** 2.0.1 (Independent Engineering Audit & Verification Gate)  
**Target Milestone:** 2.0 (Tabular Forensic Comparator, Diagnostics & Benchmark Protocol)  
**Execution Date:** 2026-10-22  
**Auditor Role:** Senior Data-Engineering Reviewer, Python Security Engineer, Database-Performance Engineer, and Test Auditor  
**Repository Root:** `E:\MHT CET REGISTRATION\BE\Task\DataRewind\`  
**Target Baseline Commit:** `d776fcf` (`feat: implement tabular forensic comparator, diagnostics, and benchmark protocol`)  

---

## A. Overall Verdict

### **CONDITIONAL PASS — TARGETED REMEDIATION REQUIRED BEFORE MILESTONE 3.0**

### Verdict Rationale:
1. **Core Verification:** The primary objectives of Milestone 2.0 are substantively achieved. The core in-memory comparator implements all 15 operational comparison cases specified in `SPEC-MOD-04`. The Earliest Observable Divergence (EOD) engine topological detection and the six diagnostic rules (DR-01 through DR-06) function with strict categorical evidence tiers. The benchmark suite executes repeatedly, verifying that the DuckDB-accelerated relational outer join achieves provisional performance targets (< 1.5s, < 120 MiB for 500,000 rows).
2. **Quality Gates:** 124 passing unit/regression tests (100% passing), 94.15% branch coverage (above the 90.0% floor), zero Ruff lint/formatting errors, zero strict Mypy issues, clean smoke test (8/8 OK), and clean CLI diagnostics.
3. **Identified Deficiencies Requiring Remediation:**
   - **P1-01:** Multiset fingerprint in `compare_tables` for tables $> 5000$ rows uses `bit_xor`, destroying row multiplicity information for any row with even multiplicity ($x \oplus x = 0$), violating `SPEC-MOD-02` Section 2.
   - **P2-01:** Keyless multiset SQL comparison in `compare_tables` uses `concat_ws('||', coalesce(..., '__NULL__'))`, creating delimiter and literal sentinel collisions with actual `NULL` values.
   - **P2-02:** `compare_tables` does not populate `sample_row_diffs` (`sample_row_diffs=[]`), causing downstream diagnostic rule DR-05 (`NULL_SENTINEL_SURGE`) to silently fail on DuckDB-backed comparisons.
   - **P2-03:** `EODDetector.detect_eod` defaults `step_dependencies` to an empty dictionary, which misclassifies linear pipelines as `CONCURRENT_DIVERGENCE_POINTS` when dependencies are omitted.
   - **P3-01:** The benchmark harness defaults to 5 iterations instead of the 10 iterations specified in `SPEC-MOD-09` Section 2.3.
   - **P3-02:** Unescaped identifier interpolation in DuckDB query templates.
   - **P3-03:** Python `True == 1` equality coercion in `compare_values` direct equality fallback.

Milestone 3.0 (Lineage Graph Blast Radius & Replay Orchestrator) should proceed only after a narrowly scoped remediation milestone (Milestone 2.0.2) resolves findings P1-01, P2-01, P2-02, and P2-03.

---

## B. Environment and Git Baseline

### 1. Git State Verification
- **Branch:** `main`
- **HEAD Commit:** `d776fcf10039d137954401260eebca96a7329a7f`
- **Commit Subject:** `feat: implement tabular forensic comparator, diagnostics, and benchmark protocol`
- **Parent Commit:** `2d8216b` (`feat: establish Data Rewind core foundation`)
- **Working Tree State:** Clean (verified via `git status --short`; 0 modified, 0 untracked).
- **Changed Files in Milestone 2.0 Commit:** 23 files (+4,487 lines, -13 lines).

### 2. Verification Environment
- **Host OS:** Windows 10 Home (Build 19045, AMD64)
- **CPUs:** 12 Logical Cores (AMD Ryzen / Intel x86_64)
- **Total Physical Memory:** 15,777.84 MiB (~16 GB)
- **Python Runtime:** Python 3.12.0 (`.venv\Scripts\python.exe`)
- **DuckDB Runtime:** DuckDB 2.0.0
- **Pytest:** pytest 9.1.1, pytest-cov 7.1.0
- **Linters & Typers:** Ruff 0.17.1, Mypy 2.4.0 (strict mode)

---

## C. Specification Traceability Audit

The following table traces canonical requirements from `SPEC-MOD-04`, `SPEC-MOD-01`, and `SPEC-MOD-09` directly to the codebase and test suite:

| Specification Requirement | Canonical Identifier | Source Module & Function | Test Case Location | Audit Verdict |
| :--- | :--- | :--- | :--- | :--- |
| **Case 1: Keyed Comparison with Unique PK** | `SPEC-MOD-04` §1.1 | `TabularComparator._compare_keyed` (`engine.py:208`) | `test_comparator.py::test_case_1_keyed_pk_partitions` | **PASS** — Complete Outer Join partitioning into $\mathcal{I}, \mathcal{M}, \mathcal{A}, \mathcal{R}$. |
| **Case 2: Composite Keys** | `SPEC-MOD-04` §1.2 | `TabularComparator._compare_keyed` (`engine.py:214`) | `test_comparator.py::test_case_2_composite_key` | **PASS** — Tuple equivalence joined across multi-column keys. |
| **Case 3: Null Key Values** | `SPEC-MOD-04` §1.3 | `TabularComparator._partition_null_keys` (`engine.py:461`) | `test_comparator.py::test_case_3_null_key_warning` | **PASS** — Partitioned to `invalid_key_rows`; raises `NULL_PRIMARY_KEY_WARNING`. |
| **Case 4: Duplicate Key Violations** | `SPEC-MOD-04` §1.4 | `TabularComparator._find_duplicate_keys` (`engine.py:478`) | `test_comparator.py::test_case_4_duplicate_key_fallback` | **PASS** — Aborts keyed join, warns `DUPLICATE_KEY_VIOLATION`, falls back to multiset. |
| **Case 5: Keyless Multiset (Bag) Diff** | `SPEC-MOD-04` §1.5 | `TabularComparator._compare_keyless` (`engine.py:350`) | `test_comparator.py::test_case_5_keyless_multiset` | **PASS** — Hash frequency counts $\min(f_A, f_B)$ identical, delta added/removed. |
| **Case 6: Reordered Rows** | `SPEC-MOD-04` §1.6 | `TabularComparator._compare_keyless` (`engine.py:423`) | `test_comparator.py::test_case_6_reordered_rows` | **PASS** — Multiset hash invariant; tagged `IDENTICAL_MULTISET_REORDERED`. |
| **Case 7: Identical Duplicate Rows** | `SPEC-MOD-04` §1.7 | `TabularComparator._compare_keyless` (`engine.py:371`) | `test_comparator.py::test_case_7_identical_duplicates` | **PASS** — Multiplicity strictly preserved in frequency counts. |
| **Case 8: Partition Invariants** | `SPEC-MOD-04` §1.8 | `TabularDiffResult.verify_partition_invariants` (`models.py:134`) | `test_comparator.py::test_case_8_partition_completeness_invariant` | **PASS** — Enforces $|\mathcal{I}|+|\mathcal{M}|+|\mathcal{R}|==|D_A| \land |\mathcal{I}|+|\mathcal{M}|+|\mathcal{A}|==|D_B|$. |
| **Case 9: Column Additions/Removals** | `SPEC-MOD-04` §1.9 | `TabularComparator._compare_schemas` (`engine.py:137`) | `test_comparator.py::test_case_9_schema_drift` | **PASS** — Populates `added_columns`, `removed_columns`, common column subset. |
| **Case 10: Type Changes and Coercion** | `SPEC-MOD-04` §1.10 | `TabularComparator._compare_schemas` (`engine.py:154`) | `test_comparator.py::test_case_10_type_coercion` | **PASS** — Numeric coercion allowed; int->string flags `BREAKING_TYPE_DRIFT`. |
| **Case 11: Floating-Point Tolerance** | `SPEC-MOD-04` §1.11 | `TabularComparator.compare_values` (`engine.py:616`) | `test_comparator.py::test_case_11_float_tolerance` | **PASS** — Evaluates $|v_A - v_B| \le \text{atol} + \text{rtol} \times |v_B|$. |
| **Case 12: Decimal & Integer Arithmetic** | `SPEC-MOD-04` §1.12 | `TabularComparator.compare_values` (`engine.py:604`) | `test_comparator.py::test_case_12_decimal_and_integer_arithmetic` | **PASS** — Exact 64-bit int and `Decimal` arithmetic preserved without lossy binary float conversion. |
| **Case 13: NaN, Inf, and Null Semantics** | `SPEC-MOD-04` §1.13 | `TabularComparator.compare_values` (`engine.py:547`) | `test_comparator.py::test_case_13_nan_inf_null` | **PASS** — `NULL==NULL` match, `NaN==NaN` warning, finite->NaN `NUMERIC_CORRUPTION`. |
| **Case 14: String Normalization** | `SPEC-MOD-04` §1.14 | `TabularComparator.compare_values` (`engine.py:638`) | `test_comparator.py::test_case_14_string_normalization` | **PASS** — NFC Unicode byte-for-byte; whitespace preserved by default. |
| **Case 15: Dataset Fingerprints** | `SPEC-MOD-04` §1.15 | `TabularComparator.compute_fingerprint` (`engine.py:113`) | `test_comparator.py::test_case_15_dataset_fingerprints` | **PASS** — Order-independent fingerprint $H = \text{SHA-256}(\text{SchemaHash} \parallel H_{\text{multiset}} \parallel |D|)$. |
| **EOD Topological Detection** | `SPEC-MOD-04` §2.1 | `EODDetector.detect_eod` (`eod.py:23`) | `test_diagnostics.py::test_eod_topological_detection` | **PASS** — Topological earliest node divergence isolated. |
| **EOD Missing Intermediates** | `SPEC-MOD-04` §2.1.1 | `EODDetector.detect_eod` (`eod.py:36`) | `test_diagnostics.py::test_eod_missing_intermediate_checkpoints` | **PASS** — Returns `COARSE_GRAINED_EOD (Intermediates not materialized)`. |
| **EOD Concurrent Branches** | `SPEC-MOD-04` §2.1.2 | `EODDetector.detect_eod` (`eod.py:130`) | `test_diagnostics.py::test_eod_concurrent_divergence_points` | **PASS** — Reports `CONCURRENT_DIVERGENCE_POINTS` across parallel DAG branches. |
| **EOD Upstream Input Drift** | `SPEC-MOD-04` §2.1.3 | `EODDetector.detect_eod` (`eod.py:68`) | `test_diagnostics.py::test_eod_upstream_input_drift` | **PASS** — Isolates root divergence to ingestion step 1. |
| **EOD Non-Deterministic Step** | `SPEC-MOD-04` §2.1.4 | `EODDetector.detect_eod` (`eod.py:125`) | `test_diagnostics.py::test_dr_06_nondeterministic_transformation` | **PASS** — Identifies non-deterministic transformations. |
| **DR-01: Upstream Data Drift** | `SPEC-MOD-04` §2.2 | `DiagnosticRuleEngine._evaluate_rule_1_upstream_input_drift` (`rules.py:63`) | `test_diagnostics.py::test_dr_01_upstream_input_data_drift` | **PASS** — Categorized as `CAUSAL_HYPOTHESIS_INPUT_DRIFT`. |
| **DR-02: Arithmetic Mutation** | `SPEC-MOD-04` §2.2 | `DiagnosticRuleEngine._evaluate_rule_2_arithmetic_mutation` (`rules.py:110`) | `test_diagnostics.py::test_dr_02_arithmetic_expression_mutation` | **PASS** — Categorized as `CAUSAL_HYPOTHESIS_DIRECT_CODE_DIFF`. |
| **DR-03: Unmatched Join Drop** | `SPEC-MOD-04` §2.2 | `DiagnosticRuleEngine._evaluate_rule_3_unmatched_join_drop` (`rules.py:166`) | `test_diagnostics.py::test_dr_03_unmatched_join_drop` | **PASS** — Categorized as `PROVEN_OBSERVATION` on $\ge 30\%$ drop. |
| **DR-04: Duplication Burst** | `SPEC-MOD-04` §2.2 | `DiagnosticRuleEngine._evaluate_rule_4_duplication_burst` (`rules.py:211`) | `test_diagnostics.py::test_dr_04_cardinality_burst` | **PASS** — Categorized as `PROVEN_OBSERVATION` on $\ge 10\%$ surge. |
| **DR-05: Null Sentinel Surge** | `SPEC-MOD-04` §2.2 | `DiagnosticRuleEngine._evaluate_rule_5_null_sentinel_surge` (`rules.py:254`) | `test_diagnostics.py::test_dr_05_null_sentinel_surge` | **PASS** (In-memory) / **GAP** (DuckDB `compare_tables`; see P2-02). |
| **DR-06: Non-Deterministic Transformation** | `SPEC-MOD-04` §2.2 | `DiagnosticRuleEngine._evaluate_rule_6_nondeterministic_transformation` (`rules.py:307`) | `test_diagnostics.py::test_dr_06_nondeterministic_transformation` | **PASS** — Categorized as `PROVEN_OBSERVATION`. |
| **Reproducible Benchmark Protocol** | `SPEC-MOD-09` §2 | `data_rewind.benchmarks.protocol` | `test_benchmark_protocol.py` | **PASS** with iteration count gap (see P3-01). |

---

## D. Comparator Correctness Audit

### 1. In-Memory vs. DuckDB SQL Parity Analysis

The comparator provides two distinct public execution methods:
- `TabularComparator.compare(baseline, target, config)`: In-memory Python list of dicts.
- `TabularComparator.compare_tables(conn, table_a, table_b, config)`: Vectorized DuckDB outer join queries.

While both methods enforce the partition completeness invariant ($|\mathcal{I}| + |\mathcal{M}| + |\mathcal{R}| == |D_A| \land |\mathcal{I}| + |\mathcal{M}| + |\mathcal{A}| == |D_B|$), the audit revealed two concrete behavioral divergence points:

1. **Literal `'__NULL__'` Sentinel Collision (P2-01):**
   - In `compare_tables`, keyless multiset rows are hashed using:
     `col_list_sql = ", ".join(f"coalesce(cast(\"{c}\" as varchar), '__NULL__')" for c in common_cols)`
   - When table A contains SQL `NULL` and table B contains the literal string `'__NULL__'`, `compare_tables` maps both to `'__NULL__'` and counts them as **1 identical row**.
   - In contrast, in-memory `compare` evaluates `compare_values(None, '__NULL__')` and reports **0 identical rows, 1 removed row, 1 added row**.
2. **Delimiter Collision (P2-01):**
   - In `compare_tables`, columns are concatenated via `concat_ws('||', ...)`.
   - Rows with `('a||b', 'c')` and `('a', 'b||c')` produce identical strings (`'a||b||c'`), causing DuckDB to treat them as identical. In-memory `compare` uses canonical JSON and correctly treats them as distinct.
3. **Empty Sample Row Diffs in SQL Path (P2-02):**
   - In `compare_tables`, `sample_row_diffs` is unconditionally set to `[]`.
   - Downstream consumers and diagnostic rules (DR-05) that rely on inspecting `sample_row_diffs` receive no sample rows from DuckDB-backed comparisons.

### 2. Adversarial Test Matrix (20 Cases)

| # | Adversarial Scenario | Evaluation Target | In-Memory `compare` | DuckDB `compare_tables` | Audit Finding |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | Identical snapshots | Exact equality | `is_equal=True` | `is_equal=True` | Clean |
| **2** | Value modifications | Modified partition | `modified_count` accurate | `modified_count` accurate | Clean |
| **3** | Added and removed rows | Added/Removed counts | Partition counts accurate | Partition counts accurate | Clean |
| **4** | Row reordering | Order invariance | `IDENTICAL_MULTISET_REORDERED` | `IDENTICAL_MULTISET_REORDERED` | Clean |
| **5** | Column reordering | Schema sorting | Common columns sorted | Common columns sorted | Clean |
| **6** | Added and removed columns | Schema drift detection | `added_cols`, `removed_cols` accurate | `added_cols`, `removed_cols` accurate | Clean |
| **7** | Duplicate rows with differing multiplicity | Multiplicity math | Multiplicity strictly preserved | Multiplicity strictly preserved | Clean |
| **8** | Duplicate rows differing in 1 field | Keyless diff | Correctly partitioned | Correctly partitioned | Clean |
| **9** | Empty vs. empty | Boundary condition | `is_equal=True, identical=0` | Validates table presence | Clean |
| **10** | Empty vs. non-empty | Asymmetric empty | `added_count=N, is_equal=False` | `added_count=N, is_equal=False` | Clean |
| **11** | Null vs. missing values | Key absence | Missing key maps to `None` | Null column maps to NULL | Clean |
| **12** | Numeric vs. textual representations | Type coercion | `BREAKING_TYPE_DRIFT` | `BREAKING_TYPE_DRIFT` | Clean |
| **13** | Boolean vs. numeric values | Type isolation | `True == 1` coerced in fallback | Coerced in DuckDB join | **P3-03** |
| **14** | Heterogeneous record keys | Schema aggregation | Aggregates all keys across rows | Uniform table schema | Clean |
| **15** | Unsupported/malformed values | Error handling | Fails cleanly in serialization | Fails cleanly in DuckDB binder | Clean |
| **16** | Stable date/time serialization | Temporal stability | ISO 8601 string formatting | DuckDB TIMESTAMP format | Clean |
| **17** | Explicit vs. inferred schema | Schema metadata | Inferred from dictionary keys | Read from `PRAGMA table_info` | Clean |
| **18** | Null-containing join keys | Null key isolation | `NULL_PRIMARY_KEY_WARNING` | `NULL_PRIMARY_KEY_WARNING` | Clean |
| **19** | Identical keys, different values | Value drift | `RowDiff(category=MODIFIED)` | Counts modified; no samples | **P2-02** |
| **20** | Large integer/float edge cases | Exact arithmetic | 64-bit int and Decimal exact | 64-bit int and DOUBLE exact | Clean |

---

## E. Earliest Observable Divergence (EOD) and Diagnostics Audit

### 1. EOD Determinism and Edge Cases
- **Topological Sorting:** EOD relies on the deterministic topological ordering established by Kahn's algorithm in `DAGValidator.validate_and_order` (lexicographical tie-breaking).
- **Missing Intermediate Checkpoints:** When `has_unmaterialized_intermediates=True`, terminal sinks are checked, returning `COARSE_GRAINED_EOD`.
- **Concurrent Divergence Points:** When parallel branches diverge without common divergent ancestors, both steps are reported in `divergent_step_ids` with `status=CONCURRENT_DIVERGENCE_POINTS`.
- **Defect in Optional `step_dependencies` (P2-03):** If `step_dependencies` is omitted (`None`), `EODDetector.detect_eod` defaults `dependencies` to `{}`. Consequently, every divergent step is treated as a root divergent step with no upstream dependencies, causing ordinary linear pipelines (A -> B -> C) to be falsely reported as `CONCURRENT_DIVERGENCE_POINTS`.

### 2. Diagnostic Rules Quality and Evidence Tiers
- **Zero Arbitrary Percentage Scores:** No rule emits arbitrary confidence percentages (e.g., "85% confidence").
- **Evidence Tiers Adherence:** Findings strictly utilize the five specification tiers:
  - `PROVEN_OBSERVATION` (DR-03, DR-04, DR-05, DR-06)
  - `CAUSAL_HYPOTHESIS_DIRECT_CODE_DIFF` (DR-02)
  - `CAUSAL_HYPOTHESIS_INPUT_DRIFT` (DR-01)
- **False-Positive Protections:**
  - DR-01 requires `is_ingestion_node=True` and input content hash divergence.
  - DR-02 requires 100% identical inputs, parameter AST divergence, preserved row count, and observed value drift.
  - DR-03 requires join operation type and $\ge 30\%$ row drop.
  - DR-04 requires $\ge 10\%$ row inflation and $\ge 10$ rows delta, or detected duplicate keys.
  - DR-06 requires bit-for-bit identical inputs, identical parameters, yet divergent output hashes.

---

## F. Benchmark Validity Audit

### 1. Documented vs. Rerun Benchmark Measurements

The following table compares the measurements published in `docs/benchmarks/milestone_2_0_benchmark_report.json` against the independent rerun executed during this audit:

| Benchmark Scenario | Rows | Columns | Mode | Claimed Prior p50 (ms) | Claimed Prior $\Delta\text{RSS}$ (MiB) | Independent Rerun p50 (ms) | Independent Rerun $\Delta\text{RSS}$ (MiB) | Provisional Target (< 1.5s, < 120 MiB) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `10k_keyed_pk` | 10,000 | 10 | KEYED_PK | 55.3 ms | 5.7 MiB | 46.9 ms | 6.5 MiB | N/A ($< 500$k) |
| `50k_keyed_pk` | 50,000 | 10 | KEYED_PK | 149.1 ms | 12.5 MiB | 134.1 ms | 12.3 MiB | N/A ($< 500$k) |
| `100k_keyed_pk` | 100,000 | 10 | KEYED_PK | 262.5 ms | 21.0 MiB | 252.0 ms | 21.1 MiB | N/A ($< 500$k) |
| `10k_composite_key` | 10,000 | 10 | COMPOSITE_KEY | 49.0 ms | 5.1 MiB | 48.7 ms | 4.6 MiB | N/A ($< 500$k) |
| `10k_keyless_multiset` | 10,000 | 10 | KEYLESS_MULTISET | 78.9 ms | 6.7 MiB | 78.4 ms | 6.8 MiB | N/A ($< 500$k) |
| `500k_keyed_target_verification` | 500,000 | 10 | KEYED_PK | **515.1 ms** | **103.7 MiB** | **468.0 ms** | **106.7 MiB** | **PASS** |

### 2. Benchmark Protocol Evaluation (Questions 1–13)
1. **Generating Command:** `python -m data_rewind.cli benchmark --output docs/benchmarks/milestone_2_0_benchmark_report.json`.
2. **Real Comparator Execution:** Verified. The benchmark executes `TabularComparator.compare_tables`, exercising real DuckDB table introspection, join planning, and outer-join execution.
3. **Timed Interval Isolation:** Verified. Table generation (`populate_benchmark_tables_duckdb`) is executed prior to the timed interval. Timing measures strictly `time.perf_counter_ns()` surrounding `compare_tables`.
4. **Correctness Invariant Acceptance Gate:** Verified. Partition completeness ($|\mathcal{I}| + |\mathcal{M}| + |\mathcal{R}| == |D_A| \land |\mathcal{I}| + |\mathcal{M}| + |\mathcal{A}| == |D_B|$) is evaluated on every iteration. An invalid partition fails the benchmark run.
5. **Statistical Distribution:** Min, p50, p95, Max, Mean, and StdDev are computed.
6. **Repetition Count Gap (P3-01):** The runner executed 5 iterations instead of the 10 iterations required by `SPEC-MOD-09` Section 2.3.
7. **Memory Sampling Frequency:** `MemorySampler` samples `psutil.Process().memory_info().rss` at 5ms intervals. While transient sub-5ms allocations could theoretically escape detection, DuckDB join hash tables remain resident throughout the outer join execution, ensuring accurate peak capture.
8. **Baseline Memory Measurement:** Baseline RSS is captured per-iteration immediately before timing commences.
9. **Warm vs. Cold Isolation:** Iteration 1 is recorded as `COLD`; iterations 2–5 are recorded as `WARM`.
10. **Dataset Metadata Recording:** Schema, column count, null density, perturbation split, and random seed are fully serialized in the report.
11. **Environment Provenance:** OS, CPU count, RAM, Python version, and DuckDB version are serialized in `SystemEnvironmentInfo`.
12. **Reproducibility:** 100% reproducible. Independent rerun completed cleanly with consistent results.
13. **Target Type:** The 500k targets ($< 1.5$s, $< 120$ MiB) are properly characterized as provisional engineering targets.

---

## G. Security, Resource Limits, and Architecture Audit

### 1. Static Source Inspection
- **Zero Eval/Exec:** `ast_sandbox.py` strictly evaluates AST nodes using an explicit visitor; no `eval()`, `exec()`, or dynamic code execution primitives exist.
- **Path Confinement:** `PathJail` enforces confinement within the workspace; attempts to traverse outside via `../` raise `PathTraversalError`.
- **Zero Remote Telemetry & ₹0 Cost:** Zero network client imports (`requests`, `urllib.request`, `httpx`, `aiohttp`). Loopback only. ₹0 operating cost maintained.

### 2. Dynamically Verified Protections
- **Preflight Disk Space Admission:** Rejects pipeline execution if available disk storage is $< 100$ MB.
- **AST Execution Complexity Limits:** Verified that expressions with depth $> 10$, nodes $> 50$, or length $> 1000$ are rejected before evaluation.
- **AST Runtime Timeout:** Cooperative batch timeout prevents runaway operations.

### 3. Architectural Limitations Preserved
- **In-Thread AST Execution (P2-01 from M 1.0.1):** Remains in-thread with cooperative batch timeouts.
- **DuckDB Concurrency Limitation (P2-02 from M 1.0.1):** DuckDB connections remain single-threaded by design.

---

## H. Test Quality and Coverage Results

### 1. Test Suite Execution
- **Command:** `.venv\Scripts\pytest.exe -v --cov=data_rewind --cov-report=term-missing`
- **Collected Items:** 124 tests across 12 test files.
- **Passed:** 124 (100%).
- **Failed:** 0.
- **Execution Time:** 6.43 seconds.

### 2. Code Coverage Analysis
- **Total Statements:** 2,410
- **Missed Statements:** 101
- **Branch Points:** 682
- **Partial Branch Matches:** 78
- **Total Branch Coverage:** **94.15%** (Mandatory threshold: 90.0%).

---

## I. Findings Register

### Finding P1-01: Multiset Fingerprint in `compare_tables` for $> 5000$ Rows Destroys Row Multiplicity via `bit_xor`
- **Severity:** P1 (High)
- **Affected File:** `src/data_rewind/comparator/engine.py` (lines 754–765)
- **Function:** `TabularComparator.compare_tables`
- **Reproducible Scenario:**
  ```python
  conn = duckdb.connect(':memory:')
  conn.execute("CREATE TABLE d1 (id INT, val VARCHAR)")
  conn.execute("CREATE TABLE d2 (id INT, val VARCHAR)")
  # d1 has 2 identical duplicate rows; d2 has 0 rows
  conn.execute("INSERT INTO d1 VALUES (1, 'hello'), (1, 'hello')")
  xor_1 = conn.execute("SELECT coalesce(bit_xor(cast(hash(concat_ws('||', id, val)) as HUGEINT)), 0) FROM d1").fetchone()[0]
  xor_2 = conn.execute("SELECT coalesce(bit_xor(cast(hash(concat_ws('||', id, val)) as HUGEINT)), 0) FROM d2").fetchone()[0]
  assert xor_1 == xor_2 == 0  # Both evaluate to 0!
  ```
- **Expected Behavior:** `SPEC-MOD-02` Section 2 mandates that multiset hashing preserve row multiplicity: $H_{\text{multiset}}(D) = \sum_{r \in D} \operatorname{int}(h(r)) \bmod 2^{256}$. Two identical rows must contribute $2 \times h(r) \neq 0$.
- **Actual Behavior:** Bitwise XOR is self-inverse ($x \oplus x = 0$). Any duplicate row occurring an even number of times completely cancels out, producing hash collisions with empty or truncated datasets.
- **Impact:** Compromises cryptographic integrity verification for large datasets in `compare_tables`. Tables with duplicate rows can produce identical multiset hashes to tables missing those rows entirely.
- **Minimum Remediation:** Replace `bit_xor(...)` with modular sum `sum(cast(hash(...) as HUGEINT))` or an additive hash accumulator in DuckDB.
- **Regression Test Recommendation:** Test `compare_tables` on tables $> 5000$ rows containing even multiplicities and verify that the multiset hash differs from an empty table.

---

### Finding P2-01: Keyless Multiset SQL Comparison Collides on Literal `'__NULL__'` and Delimiter `'||'`
- **Severity:** P2 (Medium)
- **Affected File:** `src/data_rewind/comparator/engine.py` (lines 920–923)
- **Function:** `TabularComparator.compare_tables`
- **Reproducible Scenario:**
  ```python
  conn = duckdb.connect(':memory:')
  conn.execute("CREATE TABLE t1 (s VARCHAR)")
  conn.execute("CREATE TABLE t2 (s VARCHAR)")
  conn.execute("INSERT INTO t1 VALUES (NULL)")
  conn.execute("INSERT INTO t2 VALUES ('__NULL__')")
  res = TabularComparator.compare_tables(conn, "t1", "t2", ComparisonConfig(primary_key=None))
  assert res.identical_count == 1  # Collides! Should be 0.
  ```
- **Expected Behavior:** SQL `NULL` and literal string `'__NULL__'` must be treated as distinct values (identical count: 0). Cross-column values containing `'||'` must not collide.
- **Actual Behavior:** `coalesce(cast(c as varchar), '__NULL__')` maps SQL `NULL` to the literal string `'__NULL__'`, and `concat_ws('||', ...)` creates ambiguous field boundaries.
- **Impact:** Misclassifies distinct rows as identical in keyless DuckDB comparisons.
- **Minimum Remediation:** Use DuckDB's native JSON row serializer `to_json(table)` to construct unambiguous, structured row hashes.
- **Regression Test Recommendation:** Assert that `compare_tables` on `[None]` vs `['__NULL__']` yields `identical_count=0`.

---

### Finding P2-02: `compare_tables` Does Not Populate `sample_row_diffs`, Breaking Diagnostic Rule DR-05
- **Severity:** P2 (Medium)
- **Affected File:** `src/data_rewind/comparator/engine.py` (line 913) & `src/data_rewind/diagnostics/rules.py` (lines 264–270)
- **Function:** `TabularComparator.compare_tables` / `DiagnosticRuleEngine._evaluate_rule_5_null_sentinel_surge`
- **Reproducible Scenario:** Execute `compare_tables` on two tables where a column transitioned from valid integers to NULLs. Pass the resulting `TabularDiffResult` into `DiagnosticRuleEngine.evaluate_step(ctx)`. DR-05 inspects `diff.sample_row_diffs`, which is empty `[]`. DR-05 returns `None`.
- **Expected Behavior:** Diagnostic Rule DR-05 detects the null surge and emits a `PROVEN_OBSERVATION` finding.
- **Actual Behavior:** DR-05 silently ignores the null surge because `compare_tables` does not populate `sample_row_diffs`.
- **Impact:** Pipeline steps evaluated via DuckDB tables lose null-surge forensic diagnostic coverage.
- **Minimum Remediation:** In `compare_tables`, query a small sample (e.g. `LIMIT 50`) of modified/added/removed rows with column deltas into `sample_row_diffs`.
- **Regression Test Recommendation:** Test DR-05 triggering from a `TabularDiffResult` generated by `compare_tables`.

---

### Finding P2-03: `EODDetector.detect_eod` Defaults `step_dependencies` to Empty Dict, Misclassifying Linear Pipelines
- **Severity:** P2 (Medium)
- **Affected File:** `src/data_rewind/diagnostics/eod.py` (lines 31, 106–110)
- **Function:** `EODDetector.detect_eod`
- **Reproducible Scenario:**
  ```python
  res = EODDetector.detect_eod(
      topological_order=["A", "B", "C"],
      step_contexts={"A": ctx_a, "B": ctx_b, "C": ctx_c},
      # step_dependencies omitted!
  )
  # Returns CONCURRENT_DIVERGENCE_POINTS with ['B', 'C'] instead of EXACT_EOD at 'B'!
  ```
- **Expected Behavior:** A linear pipeline A -> B -> C where B diverged should identify B as the single primary EOD node.
- **Actual Behavior:** Omitting `step_dependencies` causes all steps to have empty upstream dependencies (`[]`). All divergent steps are treated as independent roots, triggering `CONCURRENT_DIVERGENCE_POINTS`.
- **Impact:** Misdiagnoses single-origin upstream bugs as multi-branch concurrent divergences when dependencies are not explicitly supplied.
- **Minimum Remediation:** Make `step_dependencies` mandatory in `detect_eod`, or infer a default linear dependency sequence from `topological_order`.
- **Regression Test Recommendation:** Add a test verifying `detect_eod` behavior when `step_dependencies` is omitted or empty.

---

### Finding P3-01: Benchmark Suite Defaults to 5 Iterations Instead of Specification Minimum of 10
- **Severity:** P3 (Low)
- **Affected File:** `src/data_rewind/benchmarks/runner.py` (line 22)
- **Function:** `build_standard_suite_configs`
- **Description:** `SPEC-MOD-09` Section 2.3 states: "Statistical Aggregation: Minimum 10 iterations per scenario." `runner.py` uses 5 iterations for full runs.
- **Remediation:** Update standard suite to default to 10 iterations.

---

### Finding P3-02: Unescaped Column and Table Identifiers in DuckDB Outer Join Queries
- **Severity:** P3 (Low)
- **Affected File:** `src/data_rewind/comparator/engine.py` (lines 675–680, 795, 807–810)
- **Function:** `TabularComparator.compare_tables`
- **Description:** Table and column names are interpolated into SQL templates as `"{col}"` without escaping double quotes (`""`).
- **Remediation:** Implement a standard identifier quoting helper `_quote_ident`.

---

### Finding P3-03: Python `True == 1` Equality Coercion in `compare_values` Direct Fallback
- **Severity:** P3 (Low)
- **Affected File:** `src/data_rewind/comparator/engine.py` (lines 657–660)
- **Function:** `TabularComparator.compare_values`
- **Description:** In Python, `isinstance(True, int)` is True and `True == 1` is True. A boolean `True` and integer `1` fall through to `if val_a == val_b:` and are reported as identical values.
- **Remediation:** Explicitly guard against mixed boolean/numeric equality in `compare_values`.

---

## J. Milestone 3 Readiness Decision

### **READY AFTER SPECIFIED TARGETED REMEDIATION (MILESTONE 2.0.2)**

### Recommended Remediation Sequence (Milestone 2.0.2):
1. **Fix P1-01:** Replace `bit_xor` with additive multiset hashing in DuckDB `compare_tables`.
2. **Fix P2-01:** Replace `concat_ws` and `'__NULL__'` sentinel with native `to_json` in `compare_tables` keyless comparison.
3. **Fix P2-02:** Populate `sample_row_diffs` in `compare_tables` so that DR-05 and column-level diagnostics work consistently.
4. **Fix P2-03:** Require `step_dependencies` or infer linear topology in `EODDetector.detect_eod`.
5. **Fix P3-01:** Align standard benchmark iteration count to 10 iterations.

Following verification of Milestone 2.0.2, the platform will be fully ready for Milestone 3.0 (Lineage Graph Blast Radius & Replay Orchestrator).

---

## K. Git and Change-Control Summary

- **Source Code Alterations During Audit:** Zero (0 files modified).
- **Test Code Alterations During Audit:** Zero (0 files modified).
- **Git State:** Clean working tree.
- **Untracked Artifacts:** Only this audit report (`docs/reports/milestone_2_0_1_independent_audit_report.md`).
- **Remote Push:** None performed.
