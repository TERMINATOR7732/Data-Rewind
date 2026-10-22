# Data Rewind — Master Product Specification (Canonical Source of Truth)

**Document Version:** 1.2.0-FINAL-CLOSURE  
**Milestone:** 0.3 (Final Specification Closure & Implementation-Readiness Audit)  
**Status:** Complete Specification / Ready for Owner Review & Explicit Approval  
**Project Name:** Data Rewind  
**Tagline:** *Understand the past. Verify the present.*  
**Portfolio Position:** Project #5 (INTEGRIS $\rightarrow$ CodeShip $\rightarrow$ PathForge $\rightarrow$ Opwise $\rightarrow$ **Data Rewind**)  
**Category:** Data Engineering, Pipeline Lineage, Reproducibility, Regression Investigation, Evidence-Based Debugging  
**Budgetary Constraint:** Strict ₹0 Recurring Cost (Local-First / Open-Source Tooling)

---

## Table of Contents

1. [Product Requirements Document (PRD) & Problem Statement](#1-product-requirements-document-prd--problem-statement)
2. [Goals, Non-Goals, Target Personas & User Journeys](#2-goals-non-goals-target-personas--user-journeys)
3. [Functional Requirements for Operating Modes & 10-Point Scenarios](#3-functional-requirements-for-operating-modes)
4. [Screen Inventory & User Interaction Specifications](#4-screen-inventory--user-interaction-specifications)
5. [Shared Domain Model, Entity Schemas & Data Lifecycle](#5-shared-domain-model-entity-schemas--data-lifecycle)
6. [Pipeline Execution Engine, DAG Validation & Lineage Rules](#6-pipeline-execution-engine-dag-validation--lineage-rules)
7. [Run Comparison, Diffing Semantics & Regression Detection (15 Cases)](#7-run-comparison-diffing-semantics--regression-detection)
8. [Root-Cause Evidence Engine, Diagnostic Rules & Impact Analysis](#8-root-cause-evidence-engine-diagnostic-rules--impact-analysis)
9. [Historical Replay, Manifests & Reproducibility Guarantees](#9-historical-replay-manifests--reproducibility-guarantees)
10. [Tri-Run Fix Verification Protocol & Loss-Aware CSV Export](#10-tri-run-fix-verification-protocol--loss-aware-csv-export)
11. [REST API Contracts & Standardized Error Models](#11-rest-api-contracts--standardized-error-models)
12. [System Architecture & Local-First Operating Model](#12-system-architecture--local-first-operating-model)
13. [Security Architecture, AST Runtime Bounds & Threat Analysis](#13-security-architecture-ast-runtime-bounds--threat-analysis)
14. [Data Retention, Workspace Isolation & Bounded Deletion Policy](#14-data-retention-workspace-isolation--bounded-deletion-policy)
15. [Resource Limits, Performance Budgets & Benchmark Protocol](#15-resource-limits-performance-budgets--benchmark-protocol)
16. [Comprehensive Testing Strategy & Acceptance Criteria](#16-comprehensive-testing-strategy--acceptance-criteria)
17. [Phase-by-Phase Implementation Roadmap (Milestones 0.1 to 6.0)](#17-phase-by-phase-implementation-roadmap)
18. [Local-First & Zero-Cost (₹0) Deployment Strategy](#18-local-first--zero-cost-deployment-strategy)
19. [Repository Blueprint, README & Release Requirements](#19-repository-blueprint-readme--release-requirements)
20. [Scope Matrix (In-Scope, Deferred, and Excluded Features)](#20-scope-matrix)
21. [Outstanding Decisions Register & Architectural Trade-offs (D-01 to D-05)](#21-outstanding-decisions-register--architectural-trade-offs)
22. [Milestone 0.3 Final Verification & Implementation-Readiness Checklist](#22-milestone-03-final-verification--implementation-readiness-checklist)

---

## 1. Product Requirements Document (PRD) & Problem Statement

Modern data pipelines frequently experience **silent regressions**: an execution completes with exit code `0`, passes basic row-count thresholds, and outputs valid tabular files, yet emits corrupted, mathematically drifted, or structurally compromised downstream metrics.

When reports or decision models consume these faulty outputs, engineers are forced to manually correlate logs, rerun ad-hoc scripts, and speculate on where the issue originated. 

**Data Rewind** solves this by establishing a disciplined, evidence-based investigation loop:
$$\text{Run} \longrightarrow \text{Detect} \longrightarrow \text{Compare} \longrightarrow \text{Trace} \longrightarrow \text{Assess Impact} \longrightarrow \text{Reproduce} \longrightarrow \text{Fix} \longrightarrow \text{Verify} \longrightarrow \text{Report}$$

### Portfolio Differentiation: Data Rewind vs. INTEGRIS
- **INTEGRIS (Project #1):** Focuses on single-dataset static forensics (profiling isolated files in volatile memory for disguised missingness, primary key collisions, temporal contradictions, format drift, and issuing a Trust Score).
- **Data Rewind (Project #5):** Focuses on multi-step pipeline executions over time. It compares Run A vs. Run B, pinpoints the Earliest Observable Divergence (EOD) in the DAG, traces downstream tainted nodes, deterministically replays historical runs via manifests, and verifies patches using tri-run regression validation.

*Reference: [00_INDEX_AND_EXECUTIVE_SUMMARY.md](file:///e:/MHT%20CET%20REGISTRATION/BE/Task/DataRewind/docs/spec/00_INDEX_AND_EXECUTIVE_SUMMARY.md)*

---

## 2. Goals, Non-Goals, Target Personas & User Journeys

### Goals
- Automatically isolate the Earliest Observable Divergence (EOD) between baseline and regressed runs.
- Deliver mathematically rigorous tabular diffs across keyed, composite-keyed, and unkeyed datasets across 15 operational cases.
- Track downstream taint paths across the DAG.
- Provide defensible root-cause evidence while strictly separating observed facts from causal hypotheses without arbitrary percentage scores.
- Reconstruct historical runs deterministically from retained artifacts.
- Verify fixes via dual-axis tri-run validation.
- Maintain a strict ₹0 recurring cost using local-first open-source tooling.

### Non-Goals
- Not a replacement for distributed workflow orchestrators (Airflow, Celery).
- Not a real-time streaming engine (Kafka, Flink).
- Not an arbitrary Python/bash execution container.
- Not an AI chatbot wrapper or generative LLM guesser.

### Personas & Key Journeys
1. **Technical Reviewer & Recruiter:** Uses **Demo Mode** to evaluate technical depth in $< 5$ minutes with pre-loaded scenarios (`SCN-01` to `SCN-04`), inspecting DAG lineage, row diffs, and tri-run fix verification.
2. **Business / BI Analyst:** Uses **CSV Upload Mode** to drag-and-drop CSV files, build pipelines visually, identify join dropouts or filter anomalies, apply fixes, and export forensic dossiers.
3. **Data / Analytics Engineer:** Uses **Developer Mode** to submit declarative YAML/JSON pipeline manifests, inspect content hashes, automate CI regression fixtures, and guarantee historical reproducibility.

*Reference: [01_PRODUCT_REQUIREMENTS_AND_OPERATING_MODES.md](file:///e:/MHT%20CET%20REGISTRATION/BE/Task/DataRewind/docs/spec/01_PRODUCT_REQUIREMENTS_AND_OPERATING_MODES.md)*

---

## 3. Functional Requirements for Operating Modes & 10-Point Scenarios

### Mode A: Demo Mode (10-Point Scenarios)
1. **`SCN-01` (E-Commerce Refund Calculation Regression):**
   - *Initial State:* `orders_2026.csv` (10k rows) and `returns_2026.csv` (1.2k rows).
   - *Defect:* Sign error in formula: `gross - tax + refund` instead of `gross - (tax + refund)`.
   - *Detection:* EOD at Step 3 (`compute_net_revenue`); 1,200 rows modified, average drift +$34.50.
   - *Downstream Impact:* Daily revenue mart altered by +$41,400.00.
   - *Correction:* Restore formula parentheses.
   - *Expected Output:* $R_2$ restores exact $R_0$ margin of $1,204,200.00.
   - *Verdict:* `VERIFIED_CLEAN`.
   - *Negative Test:* Omitting refund deduction yields `NEW_FAULT_INTRODUCED`.
   - *Regression Test:* Automated assertion verifying golden output hash match.
2. **`SCN-02` (Silent Schema Drift & Unmatched Join):** Upstream vendor ID renamed to string `"V-104"`; inner join drops rows from 15k to 0 without error; fix strips prefix and casts to integer; verdict `VERIFIED_CLEAN`.
3. **`SCN-03` (Duplicate Webhook Overcounting):** Webhook retries inject 1,450 duplicates; deduplication subset fixed on `transaction_id`; row count restored from 9,450 to 8,000; verdict `VERIFIED_CLEAN`.
4. **`SCN-04` (Null Sentinel Coalesce Failure):** String `"N/A"` sentinels cause 1,800 null discounts and `TIER_UNKNOWN` classifications; fix coalesces nulls to 0.0; verdict `VERIFIED_CLEAN`.

### Mode B: CSV Upload Mode
- RFC 4180 CSV parsing with BOM (`utf-8-sig`) handling and Latin-1 fallback.
- Source byte preservation: raw uploads copied to `raw_inputs/{sha256}.csv` with read-only permissions.
- Ingestion Guardrails: 64 KB line length cap, 4,096 char cell cap, 50 MB max file size, 500k max rows.
- 12 Supported Atomic Transformations: `select_columns`, `rename_columns`, `drop_columns`, `filter_rows`, `deduplicate_rows`, `handle_missing`, `cast_types`, `join_datasets`, `aggregate_group_by`, `sort_rows`, `derive_column`, `data_quality_rule`.

### Mode C: Developer Mode
- Declarative YAML/JSON pipeline manifests with pinned SHA-256 hashes for code, inputs, and artifacts.
- Automated regression test fixtures and programmatic REST API.

*Reference: [01_PRODUCT_REQUIREMENTS_AND_OPERATING_MODES.md](file:///e:/MHT%20CET%20REGISTRATION/BE/Task/DataRewind/docs/spec/01_PRODUCT_REQUIREMENTS_AND_OPERATING_MODES.md)*

---

## 4. Screen Inventory & User Interaction Specifications

Data Rewind specifies 12 dedicated screens, each defined with normal, empty, loading, error, and recovery states:
1. **Screen 1: Workspace & Scenario Entry (`/`)** — Mode selector and recent local workspace loader.
2. **Screen 2: Demo Mode Walkthrough (`/demo`)** — Scenario selector and interactive guided tour.
3. **Screen 3: CSV Ingestion & Schema Inspector (`/csv/upload`)** — Drag-and-drop upload and type profile grid.
4. **Screen 4: Visual Pipeline DAG Builder (`/pipeline/build`)** — Node/edge construction canvas and parameter forms.
5. **Screen 5: Execution Console & Run Status (`/runs/:id`)** — Live DAG node status monitoring and execution timers.
6. **Screen 6: Lineage & Divergence Investigation Canvas (`/investigate/:id`)** — Core forensic view highlighting the EOD beacon node and tainted blast radius.
7. **Screen 7: Side-by-Side Row & Value Diff Viewer (`/investigate/:id/diff/:step`)** — Virtualized table with sticky PK, status filters (`ADDED`, `REMOVED`, `MODIFIED`), and cell drift highlights.
8. **Screen 8: Evidence & Root-Cause Drawer** — Segregated panels for *Proven Observations* vs. *Causal Hypotheses*.
9. **Screen 9: Downstream Blast Radius & Taint Inspector** — Table and sub-graph of contaminated downstream marts and reports.
10. **Screen 10: Tri-Run Fix Verification Hub (`/verify/:id`)** — Dual-axis comparison matrix and `VERIFIED_CLEAN` verdict card.
11. **Screen 11: Forensic Report & Export Studio (`/reports/:id`)** — Dossier preview and downloads (JSON, Markdown, Raw CSV, Safe CSV).
12. **Screen 12: Workspace Settings & Data Purge (`/settings`)** — Cache storage gauges and application-managed deletion button.

*Reference: [08_UI_UX_DESIGN_AND_SCREEN_INVENTORY.md](file:///e:/MHT%20CET%20REGISTRATION/BE/Task/DataRewind/docs/spec/08_UI_UX_DESIGN_AND_SCREEN_INVENTORY.md)*

---

## 5. Shared Domain Model, Entity Schemas & Data Lifecycle

- **Core Entities:** `Workspace`, `Dataset`, `DatasetVersion`, `Schema`, `ColumnDefinition`, `PipelineDefinition`, `PipelineVersion`, `TransformationStep`, `PipelineRun`, `StepExecution`, `Artifact`, `Comparison`, `StepDiff`, `Finding`, `DownstreamImpactPath`, `ReplayManifest`, `FixVerification`, `InvestigationReport`.
- **Run Lifecycle States:** `PENDING` $\rightarrow$ `RUNNING` $\rightarrow$ `COMPLETED` | `FAILED` | `CANCELLED` | `INTERRUPTED`.
  - Cancellation halts execution cleanly, marks in-progress step `CANCELLED`, downstream `SKIPPED`, and preserves completed checkpoints.
  - Heartbeat scanner (every 5s) detects crashed processes on startup and transitions stale runs ($> 60$s) to `INTERRUPTED`.
- **Atomic Artifact Publication:** Intermediate outputs are written to `.tmp_{uuid}.parquet`, flushed to disk via `os.fsync()`, and atomically renamed (`os.replace`) to `{sha256}.parquet`.
- **Disk Exhaustion Safeguard:** Pre-flight check ensures $> 100$ MB free space; catches `ENOSPC` and prunes uncommitted temps.
- **Multiset Bag Hashing with Multiplicity:**
  $$H_{\text{multiset}}(D) = \left( \sum_{r \in D} \text{int}(h(r)) \right) \pmod{2^{256}}$$
  Accounts strictly for duplicate row multiplicity. If hashes mismatch, datasets are guaranteed non-identical.

*Reference: [02_SHARED_DOMAIN_MODEL_AND_LIFECYCLE.md](file:///e:/MHT%20CET%20REGISTRATION/BE/Task/DataRewind/docs/spec/02_SHARED_DOMAIN_MODEL_AND_LIFECYCLE.md)*

---

## 6. Pipeline Execution Engine, DAG Validation & Lineage Rules

- **Graph Validation:** Kahn’s Algorithm for topological sorting and cycle detection. Rejects cycles, dangling inputs, or invalid edge arity prior to execution.
- **Intermediate Materialization:** Every node materializes its output to a local Parquet checkpoint (`~/.data_rewind/artifacts/{sha256}.parquet`).
- **Fail-Fast Semantics:** A failed step stops execution along its downstream path (marking descendants `SKIPPED`) while preserving all completed upstream artifacts.
- **Lineage Traversal:** BFS traversal on transposed graph $G^T$ identifies downstream blast radius. Distinguishes *topological taint* from *proven value change*.

*Reference: [03_EXECUTION_ENGINE_DAG_AND_REPRODUCIBILITY.md](file:///e:/MHT%20CET%20REGISTRATION/BE/Task/DataRewind/docs/spec/03_EXECUTION_ENGINE_DAG_AND_REPRODUCIBILITY.md)*

---

## 7. Run Comparison, Diffing Semantics & Regression Detection

Data Rewind defines exact mathematical semantics for **15 operational comparison cases**:
1. **Primary Key Comparison:** Outer-join on $PK$, partitioning records into $\mathcal{I}, \mathcal{M}, \mathcal{A}, \mathcal{R}$.
2. **Composite Keys:** Outer-join on composite tuple $\bigwedge_{j=1}^m (r_A[c_j] = r_B[c_j])$.
3. **Null Key Values:** Nulls cannot match nulls; partitioned into `INVALID_KEY_ROWS`.
4. **Duplicate Key Violations:** Pre-flight check flags collision and falls back to keyless multiset mode.
5. **Keyless Multiset Comparison:** Canonical row hash frequency distribution difference ($f_A(h)$ vs $f_B(h)$).
6. **Reordered Rows:** Permutations maintain identical multiset hash (`IDENTICAL_MULTISET_REORDERED`).
7. **Identical Duplicates:** Multiplicity strictly preserved ($\min(f_A, f_B)$ identical, $|f_A - f_B|$ added/removed).
8. **Partition Invariants:** $|\mathcal{I}| + |\mathcal{M}| + |\mathcal{R}| = |D_A|$ and $|\mathcal{I}| + |\mathcal{M}| + |\mathcal{A}| = |D_B|$.
9. **Column Additions/Removals:** Explicit `ADDED_COLUMNS` and `REMOVED_COLUMNS` reporting.
10. **Type Changes & Coercion:** Permitted numeric coercion within tolerance; breaking shifts flagged.
11. **Floating-Point Tolerances:** $|v_A - v_B| \le \text{atol} + \text{rtol} \times |v_B|$ with $\text{atol}=10^{-6}, \text{rtol}=10^{-5}$.
12. **Decimal & Integer Arithmetic:** Exact 64-bit integer arithmetic; high-precision decimal preservation.
13. **NaN, Infinities, and Nulls:** Distinguishes IEEE-754 `NaN`/`Inf` from SQL `NULL`.
14. **String Normalization:** Strict NFC unicode normalization; whitespace preserved; case-sensitive by default.
15. **Deterministic Fingerprints:** $H_{\text{fingerprint}} = \text{SHA-256}(\text{SchemaHash} \parallel H_{\text{multiset}} \parallel |D|)$.

*Unverified Benchmark Target:* Targets 500k-row outer-join diffs in $< 1.5$s and $< 120$ MB RAM, subject to verification via the formal benchmark protocol.

*Reference: [04_ROW_COMPARISON_DIAGNOSTICS_AND_IMPACT.md](file:///e:/MHT%20CET%20REGISTRATION/BE/Task/DataRewind/docs/spec/04_ROW_COMPARISON_DIAGNOSTICS_AND_IMPACT.md)*

---

## 8. Root-Cause Evidence Engine, Diagnostic Rules & Impact Analysis

- **EOD Exact Semantics:** Topological earliest node with divergent output.
  - If intermediate checkpoints are missing: defaults to terminal sink, labeled `COARSE_GRAINED_EOD`.
  - If multiple independent branches diverge: reports all as **Concurrent Divergence Points**.
  - If raw inputs changed: EOD is Step 1, classified as `UPSTREAM_INPUT_DATA_DRIFT`.
- **Evidence-Backed Diagnostic Tiers (No Arbitrary Scores):**
  - `PROVEN_OBSERVATION`: 100% mathematical/structural facts.
  - `CAUSAL_HYPOTHESIS_DIRECT_CODE_DIFF`: Identical inputs, mutated step AST.
  - `CAUSAL_HYPOTHESIS_INPUT_DRIFT`: Mutated raw input file, identical code.
  - `CORRELATION_INFERENCE`: Correlated statistical shifts without direct proof.
  - `INDETERMINATE`: Multi-variable changes requiring isolated replay.

*Reference: [04_ROW_COMPARISON_DIAGNOSTICS_AND_IMPACT.md](file:///e:/MHT%20CET%20REGISTRATION/BE/Task/DataRewind/docs/spec/04_ROW_COMPARISON_DIAGNOSTICS_AND_IMPACT.md)*

---

## 9. Historical Replay, Manifests & Reproducibility Guarantees

- **4 Core Concepts Delineated:**
  1. Comparing previously recorded results (static offline diff).
  2. Re-executing a retained pipeline definition (rerunning with new inputs).
  3. Reconstructing an earlier historical result (re-executing pinned versions and inputs).
  4. Verifying a fix (tri-run regression evaluation).
- **5 Categorical Replay Outcomes:**
  1. `REPRODUCIBLE`: Bit-for-bit and multiset exact match.
  2. `PARTIALLY_REPRODUCIBLE`: Matches within float tolerance ($\epsilon$) or row reordering.
  3. `BLOCKED_MISSING_ARTIFACTS`: Prerequisite input artifact was purged from disk.
  4. `DIVERGENT`: Inputs match but outputs differ.
  5. `FAILED_VERIFICATION`: Engine threw runtime exception during replay.
- **Determinism Safeguards:** Enforces stable sorting tie-breakers, explicit parameterized run timestamps (no ambient `now()`), and invariant UTF-8 text routines.

*Reference: [03_EXECUTION_ENGINE_DAG_AND_REPRODUCIBILITY.md](file:///e:/MHT%20CET%20REGISTRATION/BE/Task/DataRewind/docs/spec/03_EXECUTION_ENGINE_DAG_AND_REPRODUCIBILITY.md)*

---

## 10. Tri-Run Fix Verification Protocol & Loss-Aware CSV Export

- **Dual-Axis Verification:** Evaluates candidate Fix Run ($R_2$) across two axes:
  - Axis 1 ($R_2 \text{ vs } R_1$): Verifies remediation of the specific defect.
  - Axis 2 ($R_2 \text{ vs } R_0$): Verifies baseline equivalence across all non-targeted steps.
- **Verdict Taxonomy & Edge Cases:**
  - `VERIFIED_CLEAN`: Defect resolved and 100% equivalence restored with baseline.
  - `INTENTIONAL_UPDATE`: Defect resolved with explicit intentional logic drift confirmed.
  - `PARTIAL_RESTORATION`: Primary defect mitigated, but residual differences remain.
  - `REGRESSION_UNRESOLVED`: Fault persists in $R_2$.
  - `NEW_FAULT_INTRODUCED`: Original fault resolved, but secondary regression introduced at another node.
  - `BASELINE_UNAVAILABLE`: $R_0$ missing; remediation confirmed, but baseline equivalence unverified.
  - `FAULT_UNREPRODUCIBLE`: Defect in $R_1$ could not be reproduced under test conditions.
  - `INCONCLUSIVE_VERIFICATION`: Ambiguous keyless data correspondence or non-deterministic step.
- **Two CSV Export Flavors:**
  1. **Raw Data Export (`raw`):** Preserves exact logical data and schema without escaping. Round-trip re-importable under schema contract.
  2. **Spreadsheet-Safe Export (`safe`):** Type-aware escaping. Numbers (`INTEGER`, `FLOAT`, scientific notation) are NEVER escaped. Untrusted string cells starting with dangerous characters (`=`, `+`, `-`, `@`, `\t`, `\r`) that fail numeric parsing are escaped with `'`. Pipe character `|` is preserved unless preceded by formula operators. UI displays an explicit modification warning.

*Reference: [05_FIX_VERIFICATION_AND_FORENSIC_REPORTS.md](file:///e:/MHT%20CET%20REGISTRATION/BE/Task/DataRewind/docs/spec/05_FIX_VERIFICATION_AND_FORENSIC_REPORTS.md)*

---

## 11. REST API Contracts & Standardized Error Models

- Base path: `/api/v1`
- Endpoints for Workspaces, Datasets, Pipelines, Runs, DAG Telemetry, Intermediate Artifacts, Comparisons, Step Diffs, Verifications, and Report Exports.
- Standardized error envelope:
  ```json
  {
    "error": {
      "code": "ERROR_CODE_STRING",
      "message": "Human readable summary",
      "details": {},
      "remediation": "Actionable guidance",
      "timestamp": "ISO8601"
    }
  }
  ```

*Reference: [07_SYSTEM_ARCHITECTURE_AND_API_CONTRACTS.md](file:///e:/MHT%20CET%20REGISTRATION/BE/Task/DataRewind/docs/spec/07_SYSTEM_ARCHITECTURE_AND_API_CONTRACTS.md)*

---

## 12. System Architecture & Local-First Operating Model

- **Local-First Web Application (Primary):**
  - Clean launch via `run.bat` (Windows) / `run.sh` (Unix).
  - Backend binds strictly to loopback (`127.0.0.1`), never `0.0.0.0`.
  - CORS restricted to local origins (`127.0.0.1:*`, `localhost:*`).
  - Frontend discovers backend via `http://127.0.0.1:8000/api/v1` with automatic reconnection banner.
  - Local storage in `~/.data_rewind/` with `workspace.lock` concurrency control.
  - 100% offline functionality. No account, no API key, no external network calls.
  - Desktop wrapper (Electron/Tauri) evaluated and excluded for v1.0.
- **Optional Hosted Profile (Secondary):**
  - Activated via `DATA_REWIND_PROFILE="hosted_demo"`.
  - Ephemeral container storage (wiped on restart / 60-min session timeout).
  - Explicit privacy disclosure: user uploads do leave the machine in hosted demo profile.
  - Resource caps: 10 MB upload, 50,000 rows, 256 MB RAM, 30s timeout.

*Reference: [07_SYSTEM_ARCHITECTURE_AND_API_CONTRACTS.md](file:///e:/MHT%20CET%20REGISTRATION/BE/Task/DataRewind/docs/spec/07_SYSTEM_ARCHITECTURE_AND_API_CONTRACTS.md)*

---

## 13. Security Architecture, AST Runtime Bounds & Threat Analysis

- **Threat Matrix:** Mitigates malformed CSVs (`TH-01`), expression injection RCE (`TH-02`), path traversal (`TH-03`), Cartesian explosion (`TH-04`), CSV injection (`TH-05`), and data leakage (`TH-06`).
- **AST Runtime Bounds (AST parsing alone is not enough):**
  - Maximum AST tree depth $\le 10$.
  - Maximum AST node count $\le 50$.
  - Maximum raw expression length $\le 1,000$ characters.
  - Exponentiation (`Pow` / `**`) prohibited or bounded to integer exponent $\le 4$.
  - String multiplication (`str * int`) prohibited.
  - Container displays and comprehensions prohibited.
  - Runtime batch timeout: 1.0 second per 10k-row chunk.
  - Strictly **no `eval()` or `exec()`**.
- **Path Jail:** Enforces `os.path.commonpath` verification against sandboxed workspace directories.

*Reference: [06_SECURITY_PRIVACY_AND_SAFE_EXECUTION.md](file:///e:/MHT%20CET%20REGISTRATION/BE/Task/DataRewind/docs/spec/06_SECURITY_PRIVACY_AND_SAFE_EXECUTION.md)*

---

## 14. Data Retention, Workspace Isolation & Bounded Deletion Policy

- **Workspace Sandboxing:** Every workspace resides under `{HOME}/.data_rewind/workspaces/{id}/`.
- **Ephemeral Sessions:** Web demo sessions are isolated and purged after 60 minutes of inactivity.
- **Application-Managed Deletion & Forensic Limitations:**
  - "Delete All Workspace Data" unlinks raw inputs, Parquet checkpoints, temporary files, and SQLite records, executing `VACUUM`.
  - **Disclaimer:** The application performs operating-system file unlinking. It does not provide military-grade forensic sanitization against SSD wear-leveling, filesystem journaling, or OS volume shadow copies.
- **Zero Telemetry:** No external tracking scripts, no third-party cookies, and no outbound network calls to external AI providers.

*Reference: [06_SECURITY_PRIVACY_AND_SAFE_EXECUTION.md](file:///e:/MHT%20CET%20REGISTRATION/BE/Task/DataRewind/docs/spec/06_SECURITY_PRIVACY_AND_SAFE_EXECUTION.md)*

---

## 15. Resource Limits, Performance Budgets & Benchmark Protocol

### 15.1 Reconciled Resource Limit Matrix

| Resource / Operation | Exact Unit | Hard Limit or Target | Enforcement Location | Expected Behavior When Exceeded | User-Facing Diagnostic |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Raw CSV File Size** | Decimal MB ($10^6$ bytes). | **Hard:** 50 MB (Local) / 10 MB (Hosted). | Ingestion API stream. | Aborts stream; unlinks partial `.tmp` upload. | `FILE_SIZE_LIMIT_EXCEEDED` |
| **Dataset Rows** | Total data rows (excl. header & blanks). | **Hard:** 500,000 rows (Local) / 50k (Hosted). | CSV line iterator. | Parsing halts on row 500,001; unlinks temp. | `ROW_COUNT_LIMIT_EXCEEDED` |
| **Column Count** | Count of distinct columns. | **Hard:** 100 columns (Local) / 50 (Hosted). | CSV header parser. | Rejects ingestion before processing rows. | `COLUMN_COUNT_LIMIT_EXCEEDED` |
| **Cell Length** | Code points per cell. | **Hard:** 4,096 characters. | Field parser buffer. | Parsing halts on offending field. | `CELL_LENGTH_LIMIT_EXCEEDED` |
| **Line Byte Length** | Bytes between newlines. | **Hard:** 65,536 bytes (64 KB). | CSV line reader. | Aborts if newline missing in 64 KB. | `LINE_LENGTH_EXCEEDED` |
| **Process Memory Cap** | Binary MiB ($2^{20}$ bytes) RSS. | **Hard:** 512 MiB RSS. | Heartbeat loop watcher. | Pauses new admissions; halts run at 512 MiB. | `OUT_OF_MEMORY_SAFEGUARD` |
| **DuckDB Query Memory**| Binary MiB. | **Hard:** 256 MiB (`SET max_memory`). | DuckDB runtime context. | Spills query buffers to disk (`tmp/`). | `QUERY_SPILL_TO_DISK` (advisory) |
| **500k Diff Working RAM**| Binary MiB. | **Target:** $< 120$ MiB. | Benchmark runner. | Measured during benchmark protocol. | Unverified performance target |
| **500k Diff Duration** | Wall-clock elapsed time. | **Target:** $< 1.5$ seconds. | Benchmark runner. | Measured during benchmark protocol. | Unverified performance target |
| **Step Execution Timeout**| Wall-clock seconds. | **Hard:** 120 seconds (Local) / 30s (Hosted). | Execution coordinator. | Cancels active step task; unlinks temp. | `STEP_EXECUTION_TIMEOUT` |
| **Expression Timeout** | Seconds per 10k-row chunk. | **Hard:** 1.0 second. | Vectorized AST evaluator. | Aborts batch; marks step failed. | `EXPRESSION_EVALUATION_TIMEOUT`|
| **AST Complexity** | Tree depth / node count. | **Hard:** Depth $\le 10$, Nodes $\le 50$. | AST security visitor. | Rejects expression before execution. | `EXPRESSION_COMPLEXITY_EXCEEDED`|
| **Disk Admission Check**| Decimal MB free disk. | **Hard:** $> 100$ MB free storage. | Pre-flight gate. | Blocks execution if free space $< 100$ MB. | `INSUFFICIENT_DISK_SPACE_ERROR`|

### 15.2 Reproducible Benchmark Protocol
- Evaluates 10k, 50k, 100k, 500k rows across 10, 50, 100 columns with mixed types and null distributions (0% to 50%).
- Instruments `psutil` RSS and `perf_counter_ns` across cold and warm runs.
- Minimum 10 iterations reporting Min, p50, p95, Max, and Standard Deviation.

*Reference: [09_RESOURCE_LIMITS_AND_TESTING_STRATEGY.md](file:///e:/MHT%20CET%20REGISTRATION/BE/Task/DataRewind/docs/spec/09_RESOURCE_LIMITS_AND_TESTING_STRATEGY.md)*

---

## 16. Comprehensive Testing Strategy & Acceptance Criteria

- **Multi-Tier Pyramid:** Unit tests (`pytest`), property-based tests (`hypothesis`), integration tests (`TestClient` + DuckDB), and component tests (`vitest`).
- **Property Invariants:** Proves multiset hash order-independence and diff partition completeness ($|\mathcal{I}| + |\mathcal{M}| + |\mathcal{R}| = |D_A|$).
- **Automated CI/CD:** Mandatory GitHub Actions workflow checking linting (Ruff, ESLint), types (mypy, tsc), and $> 90\%$ test coverage.

*Reference: [09_RESOURCE_LIMITS_AND_TESTING_STRATEGY.md](file:///e:/MHT%20CET%20REGISTRATION/BE/Task/DataRewind/docs/spec/09_RESOURCE_LIMITS_AND_TESTING_STRATEGY.md)*

---

## 17. Phase-by-Phase Implementation Roadmap

- **Milestone 0.1:** Product Specification Audit *(Complete)*.
- **Milestone 0.2:** Specification Hardening & Architecture Decisions *(Complete)*.
- **Milestone 0.3:** Final Specification Closure & Readiness Audit *(Current — strictly spec only)*.
- **Milestone 1.0:** Core Shared Engine & Security Foundations.
- **Milestone 2.0:** Forensic Comparator, Diagnostic Rules & Benchmark Protocol Execution.
- **Milestone 3.0:** Lineage Traversal, Downstream Impact & Replay Manifests.
- **Milestone 4.0:** Tri-Run Fix Verification & Forensic Reporting.
- **Milestone 5.0:** Professional Frontend & 3 UI Operating Modes.
- **Milestone 6.0:** Hardening, E2E Benchmarking & Production Release.

*Reference: [10_ROADMAP_DEPLOYMENT_AND_DECISION_REGISTER.md](file:///e:/MHT%20CET%20REGISTRATION/BE/Task/DataRewind/docs/spec/10_ROADMAP_DEPLOYMENT_AND_DECISION_REGISTER.md)*

---

## 18. Local-First & Zero-Cost (₹0) Deployment Strategy

- **Primary Mode:** 100% local workstation execution (FastAPI backend + Vite frontend dev/preview). Zero external cloud dependencies.
- **Optional Web Demo:** Vercel / GitHub Pages for static frontend SPA + free Docker container (Render / Fly.io / HuggingFace Spaces) for backend. Vercel is an optional candidate, not an architectural requirement.
- **Zero-Cost Policy:** Zero paid cloud databases, zero paid third-party APIs, zero paid fonts.

*Reference: [10_ROADMAP_DEPLOYMENT_AND_DECISION_REGISTER.md](file:///e:/MHT%20CET%20REGISTRATION/BE/Task/DataRewind/docs/spec/10_ROADMAP_DEPLOYMENT_AND_DECISION_REGISTER.md)*

---

## 19. Repository Blueprint, README & Release Requirements

- Target repository: `Data-Rewind`.
- Comprehensive setup guide covering Python 3.11+, Node 20+, and local startup commands (`run.bat` / `run.sh`).
- Verified milestone tags (`v0.1.0-spec`, `v0.2.0-hardened`, `v0.3.0-final`, `v1.0.0-core`, etc.).
- Strict exclusion of user data and credentials via `.gitignore`.

*Reference: [10_ROADMAP_DEPLOYMENT_AND_DECISION_REGISTER.md](file:///e:/MHT%20CET%20REGISTRATION/BE/Task/DataRewind/docs/spec/10_ROADMAP_DEPLOYMENT_AND_DECISION_REGISTER.md)*

---

## 20. Scope Matrix

- **In-Scope (v1.0):** 3 Operating Modes, 4 Curated Demo Scenarios, RFC 4180 CSV Ingestion, 12 Atomic Transformations, Sandboxed AST Evaluator with runtime bounds, 15 Comparison Cases, EOD Detection, BFS Downstream Taint, Replay Manifests, Tri-Run Fix Verification, JSON/Markdown/Raw & Safe CSV Exports.
- **Deferred (v2.0+):** Excel (`.xlsx`) ingestion, Parquet web upload, Client-side DuckDB-Wasm mode, Git-backed pipeline syncing.
- **Excluded (Never):** General workflow scheduler (Airflow clone), real-time stream engine (Kafka), arbitrary host code execution, paid cloud databases, third-party AI LLMs.

*Reference: [10_ROADMAP_DEPLOYMENT_AND_DECISION_REGISTER.md](file:///e:/MHT%20CET%20REGISTRATION/BE/Task/DataRewind/docs/spec/10_ROADMAP_DEPLOYMENT_AND_DECISION_REGISTER.md)*

---

## 21. Outstanding Decisions Register (D-01 to D-05)

1. **D-01 (Tabular Engine):** DuckDB selected over Polars/Pandas/SQLite. Status: **`RECOMMENDED — PENDING OWNER APPROVAL`**.
2. **D-02 (DAG Lineage Canvas):** `@xyflow/react` selected over D3/Cytoscape. Status: **`RECOMMENDED — PENDING OWNER APPROVAL`**.
3. **D-03 (File Formats):** Strict CSV only for v1.0; Excel deferred to v2.0. Status: **`RECOMMENDED — PENDING OWNER APPROVAL`**.
4. **D-04 (Demo Scenarios):** 4 deeply engineered scenarios (`SCN-01` to `SCN-04`) selected over 10 shallow scenarios. Status: **`RECOMMENDED — PENDING OWNER APPROVAL`**.
5. **D-05 (Deployment Topology):** Local-first desktop selected as primary, optional static Vercel demo. Status: **`RECOMMENDED — PENDING OWNER APPROVAL`**.

*Reference: [10_ROADMAP_DEPLOYMENT_AND_DECISION_REGISTER.md](file:///e:/MHT%20CET%20REGISTRATION/BE/Task/DataRewind/docs/spec/10_ROADMAP_DEPLOYMENT_AND_DECISION_REGISTER.md)*

---

## 22. Milestone 0.3 Final Verification & Implementation-Readiness Checklist

- [x] Functional boundaries for Demo, CSV, and Developer Modes established with 10-point scenario specs.
- [x] Shared domain model and immutability rules formalized.
- [x] 15 operational comparison cases specified with exact invariants.
- [x] Unverified DuckDB performance targets labeled; formal benchmark protocol specified.
- [x] Resource limits reconciled into comprehensive 8-column matrix with failure semantics.
- [x] Loss-aware Raw and Spreadsheet-Safe CSV export contracts defined; negative numbers preserved.
- [x] AST expression sandbox hardened with runtime tree depth, node count, and timeout bounds.
- [x] Run lifecycle state machine detailed with cancellation, heartbeats, and crash recovery.
- [x] 4-way replay distinctions and 5 replay outcomes formalized.
- [x] Root-cause evidence rules clearly separate observations from hypotheses without arbitrary scores.
- [x] Tri-run fix verification edge cases (missing baselines, unreproducible faults, secondary regressions) defined.
- [x] Local-first operating model defined with loopback security, clean launch experience, and optional hosted demo profile.
- [x] Application-managed deletion bounded with physical erasure limitations documented.
- [x] Non-overlapping differentiation from INTEGRIS established.
- [x] Screen inventory covering all 12 screens with 5 explicit states documented.
- [x] Implementation roadmap from Milestone 0.1 to 6.0 detailed.
- [x] Outstanding decisions register (D-01 to D-05) compiled for owner review.
- [x] **Zero code implementation occurred.**

---

*End of Master Product Specification.*
