# Data Rewind — Execution Engine, DAG & Reproducibility

**Document Version:** 1.2.0-FINAL-CLOSURE  
**Milestone:** 0.3 (Final Specification Closure & Implementation-Readiness Audit)  
**Status:** Complete Specification / Ready for Owner Review & Explicit Approval  
**Module Identifier:** `SPEC-MOD-03`

---

## 1. Pipeline Execution Engine & DAG Semantics

Data Rewind models every data transformation pipeline as a **Directed Acyclic Graph (DAG)**:
$$G = (V, E)$$
where:
- **Vertices ($V$):** Ingestion nodes ($V_{\text{in}}$), transformation steps ($V_{\text{step}}$), and publication output sinks ($V_{\text{out}}$).
- **Directed Edges ($E$):** Dataflow dependencies $(u, v)$ where $u$ produces a tabular dataset consumed as an input by $v$.

```
   [raw_orders]        [raw_returns]
         │                   │
         ▼                   ▼
  (step_filter)       (step_dedup)
         │                   │
         └─────────┬─────────┘
                   ▼
             (step_join)
                   │
                   ▼
            (step_derive)
                   │
                   ▼
            (step_aggregate)
                   │
                   ▼
         [daily_revenue_mart]
```

### 1.1 Graph Validation Rules
Before any execution begins, the engine runs strict structural validation:
1. **Cycle Detection (Acyclicity):** Topological sort using Kahn’s Algorithm. If the in-degree reduction fails to process $|V|$ nodes, a `CYCLIC_DEPENDENCY_ERROR` is returned with the exact cycle path (e.g., $A \rightarrow B \rightarrow C \rightarrow A$).
2. **Dangling Reference Check:** Every `input_step_id` referenced by a node must resolve to a valid registered input dataset or an upstream step.
3. **Cardinality Verification:**
   - Single-input operations (`filter_rows`, `aggregate_group_by`, `derive_column`) must receive exactly 1 input edge.
   - Dual-input operations (`join_datasets`) must receive exactly 2 input edges (`left` and `right`).
4. **Disjoint Graph Warning:** If $G$ contains multiple disconnected subgraphs, execution is permitted but an informational advisory is recorded.

### 1.2 Execution Orchestration & Step Isolation
- **Sequential Topological Execution:** Nodes are evaluated in topologically sorted order. Independent parallel branches may be evaluated concurrently in local thread pools, bounded by workstation CPU core limits.
- **Intermediate Artifact Materialization:**
  - Every transformation step materializes its output dataset to a local Arrow/Parquet checkpoint.
  - This avoids re-executing upstream nodes during iterative debugging and allows instant step-level comparison between runs.
- **Fail-Fast & Partial Lineage Preservation:**
  - If Step $k$ fails (e.g. division by zero or invalid type cast), Step $k$ is marked `FAILED` with full exception trace.
  - All downstream nodes dependent on Step $k$ are immediately marked `SKIPPED`.
  - All completed upstream steps ($1 \dots k-1$) remain saved, valid, and fully inspectable in the UI.

---

## 2. Lineage Traversal & Downstream Impact Propagation

When a regression or data deviation is detected at step $k$, Data Rewind executes a breadth-first search (BFS) on the transposed graph $G^T$ to trace all impacted downstream assets.

```
Divergence Node (EOD): Step k
         │
         ├──► Intermediate Step k+1 [TAINTED]
         │           │
         │           └──► Mart Table 1 [TAINTED] ──► Dashboard A
         └──► Intermediate Step k+2 [TAINTED] ──► Mart Table 2 [TAINTED]
```

### 2.1 Taint Tracking vs. Proven Value Change
Data Rewind explicitly separates **topological taint** from **empirically proven value change**:
- **Potentially Affected (Tainted):** Any node $v$ that is a topological descendant of $k$ ($v \in \text{Descendants}(k)$). It lies in the dataflow blast radius.
- **Confirmed Affected (Divergent):** A tainted node $v$ whose output artifact content hash ($H(v)$) or row multiset hash differs from the baseline run ($H(v_{R_1}) \neq H(v_{R_0})$).
- **Masked / Unaffected Descendant:** A rare case where a descendant's output remains identical to baseline despite upstream taint (e.g., an aggregation `count(*)` or filter that drops all affected records). The UI explicitly notes: *"Topologically connected, but output values remain identical to baseline."*

---

## 3. Historical Replay & Reproducibility Guarantees

### 3.1 Four Core Investigation Concepts Delineated
To prevent conflating distinct engineering operations, Data Rewind formally distinguishes four concepts:

1. **Comparing Previously Recorded Results:** A static, offline comparison between existing materialized artifacts of Run $R_A$ and Run $R_B$. Requires zero re-execution.
2. **Re-Executing a Retained Pipeline Definition:** Running an existing pipeline configuration against newly supplied or updated inputs.
3. **Reconstructing an Earlier Historical Result (Replay):** Re-executing an exact historical `PipelineVersion` against the identical, pinned historical input `DatasetVersion` artifacts to test determinism.
4. **Verifying a Fix (Regression Verification):** Executing a candidate modified pipeline ($R_{\text{fix}}$) against both baseline ($R_0$) and faulted ($R_1$) runs to prove defect resolution without collateral damage.

### 3.2 Exact Inputs Required for Historical Replay
To reproduce a historical run deterministically, the following complete input bundle must be retained:
1. **Raw Source Input Artifacts:** Pinned byte-for-byte in `raw_inputs/{sha256}.csv`.
2. **Pipeline DAG Topology:** The complete graph structure and step sequence.
3. **Transformation Definitions & AST Parameters:** Pinned definition hash capturing all formulas, predicates, and thresholds.
4. **Declared Schemas & Parsing Overrides:** Recorded in the original run manifest.
5. **Frozen Run Timestamp:** Ambient system clocks are blocked; replay injects the historical `started_at` timestamp.
6. **Deterministic Random Seeds:** Pre-seeded pseudo-random number generator state (if any step uses sampling).
7. **Runtime & Engine Version Metadata:** Recorded in manifest (Python version, DuckDB version, OS platform).

> [!WARNING]
> **Hash Match $\ne$ Recovery of Missing Artifacts**  
> A cryptographic SHA-256 hash proves content identity only for an artifact that physically exists. Storing a hash does **not** allow reconstructing or un-deleting a missing data file if its underlying Parquet artifact was purged from disk.

---

### 3.3 Replay Manifest Specification

```json
{
  "manifest_version": "1.0",
  "run_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "pipeline_version_id": "4a2c1b8e-1234-4567-89ab-cdef01234567",
  "pipeline_definition_hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "created_at": "2026-10-22T12:00:00Z",
  "engine": {
    "name": "DataRewind-Engine",
    "version": "1.0.0",
    "duckdb_version": "1.1.0",
    "python_version": "3.11.9",
    "os_platform": "Windows-11-10.0.22631-SP0"
  },
  "inputs": [
    {
      "input_id": "raw_orders",
      "version_id": "f81d4fae-7dec-11d0-a765-00a0c91e6bf6",
      "content_hash": "a591a6d40bf420404a011733cfb7b190d62c65bf0bcda32b57b277d9ad9f146e",
      "multiset_hash": "2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae",
      "row_count": 14250,
      "byte_size": 1845200
    }
  ],
  "steps_snapshot": [
    {
      "step_id": "step_clean_orders",
      "operation": "filter_rows",
      "parameters": { "predicate": "order_status == 'COMPLETED'" }
    }
  ]
}
```

---

### 3.4 Replay Outcomes & Failure Handling

When a user requests **"Replay Run $R_X$"**, the engine evaluates prerequisites and returns one of five deterministic outcomes:

| Replay Outcome Status | Required Evidence & Engine Verification | User-Facing Explanation |
| :--- | :--- | :--- |
| `REPRODUCIBLE` | 1. All raw input dataset versions present by SHA-256.<br>2. Pipeline configuration matches definition hash 100%.<br>3. Output multiset hashes match historical records 100%. | *"Historical run successfully reproduced with 100% mathematical equivalence."* |
| `PARTIALLY_REPRODUCIBLE` | 1. Input hashes match.<br>2. Execution completes.<br>3. Row counts match, categorical fields match, float columns match within defined relative tolerance ($\epsilon \le 10^{-6}$), or row ordering differs but multiset matches. | *"Reproduced with non-material floating-point or row-order variances within configured tolerances."* |
| `BLOCKED_MISSING_ARTIFACTS` | One or more input dataset versions were purged from local cache and cannot be verified by SHA-256 hash. | *"Replay blocked: Raw input artifact `raw_orders` (hash `a591a6...`) is no longer retained in workspace storage."* |
| `DIVERGENT` | Inputs and configuration match, but output artifact hashes differ (e.g. non-deterministic formula, unpinned system clock, or altered underlying engine). | *"Divergence detected: Engine re-execution produced output hashes differing from historical records."* |
| `FAILED_VERIFICATION` | The pipeline failed to execute to completion (e.g. underlying parser exception or invalid step logic). | *"Replay execution failed during evaluation."* |

### 3.5 Specific Edge-Case Failure Behaviors
1. **Missing or Corrupted Manifest:** Aborts replay immediately with `INVALID_MANIFEST_ERROR`.
2. **Missing Input Artifacts:** Engine checks file presence before execution; if missing, returns `BLOCKED_MISSING_ARTIFACTS` itemizing the missing hashes.
3. **Hash Mismatch on Disk Checkpoint:** If an on-disk Parquet file fails SHA-256 check on read, flags `CORRUPTED_ARTIFACT_ERROR` and marks the node invalid.
4. **Intermediate Match with Terminal Divergence:** If Steps 1–3 reproduce exactly but Step 4 diverges, the engine pinpoints Step 4 as a `LATE_DIVERGENCE_POINT` and inspects engine version differences or floating-point accumulator variances.
5. **Bit-for-Bit vs. Logical Equivalence:** Data Rewind does not claim identical binary Parquet byte parity across platforms (since Arrow metadata and compression blocks vary). It guarantees **mathematical, logical, and multiset equivalence** across row contents and schemas.
