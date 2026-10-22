# Data Rewind — Row Comparison, Diagnostics & Impact Analysis

**Document Version:** 1.2.0-FINAL-CLOSURE  
**Milestone:** 0.3 (Final Specification Closure & Implementation-Readiness Audit)  
**Status:** Complete Specification / Ready for Owner Review & Explicit Approval  
**Module Identifier:** `SPEC-MOD-04`

---

## 1. Precise Tabular Comparison Semantics (15 Cases)

Comparing two tabular datasets $D_A$ (Baseline) and $D_B$ (Target) requires mathematically unambiguous behavior across all data structures and edge cases. Data Rewind formally specifies the exact semantics for 15 operational cases:

```
                  +-----------------------------------+
                  |   What is the dataset key state?  |
                  +-----------------+-----------------+
                                    │
            +-----------------------+-----------------------+
            │                                               │
            ▼                                               ▼
   [ Keyed Dataset ]                               [ Keyless Dataset ]
   (Single PK or Composite Key)                    (No Stable Identifier)
            │                                               │
            ▼                                               ▼
   Relational Key Alignment                        Multiset (Bag) Diff
   Match $r_A[PK] == r_B[PK]$                     Compare Row Hash Frequencies
            │                                               │
   +--------+--------+                                      │
   │        │        │                                      ▼
   ▼        ▼        ▼                             [ Exact Multiset Diff ]
 Added   Removed  Modified                         Count($h$) in $A$ vs Count($h$) in $B$
(In $B$) (In $A$) (Values drift)                            │
                                                            │ (Aggregate & Summary Drift)
                                                            ▼
                                                   [ Heuristic Similarity ]
                                                   *Strictly segregated & labeled*
```

---

### Case 1: Keyed Comparison with Unique Primary Key
- **Condition:** A single column $K$ is designated as the primary key.
- **Pre-Flight Validation:** Verify uniqueness of $K$ in both $D_A$ and $D_B$.
- **Semantics:** Relational full outer join on $r_A[K] = r_B[K]$.
- **Partitions:**
  - Identical ($\mathcal{I}$): $K \in D_A \land K \in D_B \land h(r_A) = h(r_B)$
  - Modified ($\mathcal{M}$): $K \in D_A \land K \in D_B \land h(r_A) \neq h(r_B)$
  - Added ($\mathcal{A}$): $K \in D_B \land K \notin D_A$
  - Removed ($\mathcal{R}$): $K \in D_A \land K \notin D_B$
- **Invariant:** $|\mathcal{I}| + |\mathcal{M}| + |\mathcal{R}| = |D_A|$ and $|\mathcal{I}| + |\mathcal{M}| + |\mathcal{A}| = |D_B|$.

### Case 2: Composite Keys
- **Condition:** Multiple columns $K = [c_1, \dots, c_m]$ form the candidate key.
- **Semantics:** Joined on tuple equivalence: $\bigwedge_{j=1}^m \left( r_A[c_j] = r_B[c_j] \right)$.
- **Collision Check:** Both datasets must pass composite uniqueness prior to join.

### Case 3: Null or Missing Key Values
- **Semantics:** Primary key columns cannot contain nulls. SQL `NULL = NULL` is false.
- **Handling:** Any row where $r[K]$ is `NULL` cannot be joined. Such rows are excluded from 1-to-1 matching and partitioned into a dedicated `INVALID_KEY_ROWS` bucket, raising a `NULL_PRIMARY_KEY_WARNING`.

### Case 4: Duplicate Key Violations
- **Condition:** Primary key $K$ contains duplicates within $D_A$ or $D_B$.
- **Handling:** Prevents Cartesian row multiplication in outer join. The engine flags `DUPLICATE_KEY_VIOLATION` reporting the colliding keys, aborts keyed mode, and falls back to Keyless Multiset Comparison (Case 5).

### Case 5: Keyless Multiset (Bag) Comparison
- **Condition:** No reliable unique key exists.
- **Semantics:** Calculates canonical row hash $h(r)$ for every row. Computes hash frequency distributions:
  $$f_A(h) = \text{count of } h \text{ in } D_A, \quad f_B(h) = \text{count of } h \text{ in } D_B$$
- **Partitions:**
  - Identical: $\min(f_A(h), f_B(h))$
  - Added: $\max(0, f_B(h) - f_A(h))$
  - Removed: $\max(0, f_A(h) - f_B(h))$
- **Ambiguous Correspondence Policy:** Individual row modification cannot be reliably tracked without a key. Instead, the UI displays multiset row insertions/deletions and aggregate column-level statistical drift.

### Case 6: Reordered Rows
- **Semantics:** Row permutation does not alter the multiset hash:
  $$H_{\text{multiset}}(\pi(D)) = H_{\text{multiset}}(D)$$
- If two keyless datasets contain identical rows in different physical order, they are classified as `IDENTICAL_MULTISET_REORDERED`.

### Case 7: Identical Duplicate Rows (Multiplicity)
- **Semantics:** If row $r$ occurs 3 times in $D_A$ and 2 times in $D_B$:
  - 2 instances are categorized as Identical.
  - 1 instance is categorized as Removed.
  - Multiplicity is strictly preserved in multiset arithmetic.

### Case 8: Added, Removed, and Modified Partitioning
- **Invariants:** Every record in $D_A$ and $D_B$ is mapped to exactly one category ($\mathcal{I}, \mathcal{M}, \mathcal{A}, \mathcal{R}$). Double counting is mathematically prohibited.

### Case 9: Column Additions and Removals (Schema Drift)
- **Semantics:**
  - Columns in $D_B \setminus D_A$ are classified as `ADDED_COLUMNS`.
  - Columns in $D_A \setminus D_B$ are classified as `REMOVED_COLUMNS`.
  - Common columns $D_A \cap D_B$ are compared for value drift.
  - Rows are compared across the intersection of schema columns, with schema drift explicitly reported in the header.

### Case 10: Type Changes and Coercion
- **Semantics:** If column $c$ changes from `INTEGER` to `FLOAT`, values are compared numerically within tolerance. If $c$ changes from `INTEGER` to `STRING`, type coercion is not performed silently; it is flagged as `BREAKING_TYPE_DRIFT`.

### Case 11: Floating-Point Tolerance
- **Formula:**
  $$\left| v_A - v_B \right| \le \text{atol} + \text{rtol} \times \left| v_B \right|$$
- **Defaults:** $\text{atol} = 10^{-6}$, $\text{rtol} = 10^{-5}$.
- Differences within tolerance are classified as `TOLERANT_NUMERIC_MATCH`.

### Case 12: Decimal and Integer Arithmetic
- **Semantics:** Integer operations are performed with exact 64-bit integer arithmetic. High-precision financial decimals are preserved without conversion to lossy binary floats.

### Case 13: NaN, Infinities, and Null Semantics
- **Distinction:**
  - SQL `NULL` represents missing data. `NULL == NULL` is true for diff identity purposes (both missing), but flagged as null.
  - IEEE-754 `NaN` represents invalid floating-point results. `NaN == NaN` is treated as equivalent in tabular diffs, but surfaces a `NON_FINITE_FLOAT_WARNING`.
  - `+Inf == +Inf` and `-Inf == -Inf` are equivalent.
  - Transition from a finite number to `NaN` or `Inf` triggers a `NUMERIC_CORRUPTION` finding.

### Case 14: String Normalization
- **Default Policy:** Strict byte-for-byte comparison using NFC Unicode normalization.
- **Whitespace:** Whitespace is preserved by default (no silent trimming).
- **Case Sensitivity:** Case-sensitive by default. Optional case-insensitive comparison must be explicitly requested.

### Case 15: Deterministic Dataset Fingerprints
- **Fingerprint Calculation:**
  $$H_{\text{fingerprint}}(D) = \text{SHA-256}\left( \text{SchemaHash} \parallel H_{\text{multiset}}(D) \parallel |D| \right)$$
- Accounts for column types, row counts, and row multiset hashes with multiplicity.

---

## 2. Earliest Observable Divergence (EOD) & Diagnostic Rules

### 2.1 EOD Exact Semantics & Graph Edge Cases
The Earliest Observable Divergence (EOD) is defined as:
$$v^* = \operatorname{arg\,topological\_first} \left( H(v_{R_1}) \neq H(v_{R_0}) \right)$$

Handling edge cases:
1. **Missing Intermediate Checkpoints:** If intermediate step outputs were purged or not materialized, only terminal sinks are compared. EOD defaults to the first divergent terminal sink, explicitly marked: `COARSE_GRAINED_EOD (Intermediates not materialized)`.
2. **Multiple Independent Divergent Branches:** If two parallel DAG branches diverge independently without sharing an upstream divergent node, the engine reports both as **Concurrent Divergence Points** ($v^*_1, v^*_2$).
3. **Upstream Input Drift:** If the raw input dataset version changed hash, EOD is Step 1 (the Ingestion Node). The root cause is diagnosed as `UPSTREAM_INPUT_DATA_DRIFT`, not transformation code error.
4. **Non-Deterministic Transformations:** If a step produces different outputs despite identical inputs and parameters, it is flagged as `NONDETERMINISTIC_TRANSFORMATION_DETECTED`.

### 2.2 Evidence-Backed Categorical Diagnostic Tiers
Data Rewind completely rejects arbitrary numerical confidence percentages (e.g. "88% confidence"). Instead, findings are classified into five **Evidence Tiers**:

| Evidence Tier | Criteria | Example Finding |
| :--- | :--- | :--- |
| `PROVEN_OBSERVATION` | Backed 100% by deterministic mathematical or structural delta. | *"Step 3 output row count decreased by 42% (from 10,000 to 5,800 rows)."* |
| `CAUSAL_HYPOTHESIS_DIRECT_CODE_DIFF` | Inputs to step are identical ($H_{R_1} = H_{R_0}$), but step parameter or code AST changed. | *"Sign inversion in Step 3 net revenue formula explains 100% of observed value drift."* |
| `CAUSAL_HYPOTHESIS_INPUT_DRIFT` | Upstream input file changed content hash while step parameters remained unchanged. | *"Ingestion input raw_orders.csv hash changed; 420 new rows added."* |
| `CORRELATION_INFERENCE` | Observed statistical correlation between independent variables without direct proof. | *"Step 4 join selectivity dropped following vendor_id type mutation in Step 2."* |
| `INDETERMINATE` | Multiple simultaneous inputs and transformation parameters changed across steps. | *"Multiple variables changed; causal isolation requires isolated replay."* |

---

## 3. Scalable Local Execution Targets

To process large local datasets without memory exhaustion, tabular diffs are evaluated in DuckDB using vectorized SQL outer joins:
- **Provisional Target Benchmarks:** The platform architecture targets executing 500,000-row outer-join diffs in $< 1.5$s and $< 120$ MB of working memory on standard developer workstations.
- **Verification Requirement:** These figures represent unverified architectural targets and will be rigorously tested under the benchmark protocol specified in `09_RESOURCE_LIMITS_AND_TESTING_STRATEGY.md`. Performance is workload-dependent and not guaranteed before benchmark execution.
