# Data Rewind — Product Requirements & Operating Modes

**Document Version:** 1.2.0-FINAL-CLOSURE  
**Milestone:** 0.3 (Final Specification Closure & Implementation-Readiness Audit)  
**Status:** Complete Specification / Ready for Owner Review & Explicit Approval  
**Module Identifier:** `SPEC-MOD-01`

---

## 1. Vision & Core Philosophy

### 1.1 Problem Statement
In data pipelines, a **silent regression** is far more dangerous than a catastrophic crash. When a pipeline crashes (e.g., syntax error or division by zero), monitoring alerts fire and downstream consumers receive no data. However, when a pipeline succeeds with exit code `0` while producing corrupted values—due to an unintended filter, schema drift, unhandled nulls, duplicate keys, or a modified calculation—downstream reports and analytics quietly propagate the flaw into executive decisions, financial records, and operational models.

Traditional data engineering tooling lacks granular, temporal regression debugging:
- **Orchestrators (Airflow, Dagster, Prefect)** manage scheduling and task dependencies, but treat task interiors as opaque black boxes.
- **Lineage Viewers (OpenLineage, Marquez)** show metadata graph topology ("Table A flows into Table B"), but do not capture intermediate row-level data deltas between runs.
- **Data Quality Frameworks (Great Expectations, Soda)** flag threshold breaches at boundaries, but do not isolate the *earliest divergence point* or prove whether a patch fixes the root cause without side effects.

### 1.2 Mission
Data Rewind enables data engineers, analytics engineers, and analysts to forensicly audit pipeline executions, pin down the exact transformation step where data diverged from an established baseline, trace downstream impact, deterministically replay executions, and verify patches with tri-run regression validation.

---

## 2. Goals & Non-Goals

### 2.1 Explicit Goals
1. **Deterministic Regression Isolation:** Automatically identify the *Earliest Observable Divergence (EOD)* between a baseline run ($R_0$) and a regressed run ($R_1$).
2. **Keyed and Keyless Tabular Diffing:** Accurately differentiate row insertions, deletions, modifications, and re-orderings across keyed, composite-keyed, and unkeyed datasets across 15 operational cases.
3. **Downstream Taint Tracing:** Traverse the execution DAG downstream from the EOD to isolate every contaminated intermediate artifact and final output.
4. **Evidence-Based Root-Cause Hypotheses:** Provide clear, auditable evidence for suspected defects while rigorously separating observable facts from causal hypotheses without arbitrary percentage scores.
5. **Deterministic Historical Replay:** Reconstruct and re-execute historical pipeline states from retained content-addressed artifacts and parameter manifests.
6. **Tri-Run Fix Verification:** Automatically run and validate a fix run ($R_{\text{fix}}$) against both baseline ($R_0$) and regression ($R_1$) to prove remediation and zero unintended delta.
7. **Local-First, Privacy-Preserving ₹0 Budget:** Fully functional on a standard local workstation with zero required cloud subscriptions or external paid APIs.

### 2.2 Explicit Non-Goals
1. **Not a Distributed Workflow Orchestrator:** Data Rewind does not replace Celery, Airflow, or Kubernetes for scheduling multi-node cluster jobs.
2. **Not a Real-Time Stream Processor:** Data Rewind is designed for batch tabular datasets (CSV, Parquet), not Kafka/Flink micro-batch or unbounded streams.
3. **Not an Arbitrary Code Execution Sandbox:** Data Rewind will **never** execute arbitrary user-submitted Python or bash scripts in the host process. Transformations are strictly declarative or sandboxed AST operations.
4. **Not a Static Dataset Quality Profiler:** Data Rewind does not compete with INTEGRIS. It does not profile single static datasets for generic hygiene; it investigates *changes across pipeline runs*.
5. **Not an AI Hallucination/Chatbot Interface:** Data Rewind's forensic conclusions are derived from deterministic relational algorithms and set theory, not generative LLM guesses.

---

## 3. Target Personas & User Journeys

```
+----------------------------------------------------------------------------------------------------+
|                                      DATA REWIND TARGET PERSONAS                                   |
+----------------------------------------------------------------------------------------------------+
|                                                                                                    |
|  1. REVIEWS & EVALUATORS         2. ANALYTICS & BI USERS             3. DATA & ANALYTICS ENGINEERS  |
|  (Recruiters, Tech Leads)       (No-Code Explorers)                  (Code & DAG Authors)          |
|                                                                                                    |
|  * Needs instant, friction-      * Needs intuitive CSV upload,        * Needs declarative YAML/JSON |
|    free proof of depth.           visual transform builder,            DAGs, content-addressed     |
|  * Zero setup / demo mode.        and clear visual diffs.              manifests, CLI/API triggers. |
|  * Pre-loaded fault scenarios.   * Downstream impact reporting        * Mathematical diffing,      |
|  * Clear evidence chain.          without writing Python.              reproducibility proofs.      |
+----------------------------------------------------------------------------------------------------+
```

### 3.1 Persona 1: The Technical Reviewer & Recruiter
- **Objective:** Evaluate systems design, domain depth, frontend craft, and engineering discipline in under 5 minutes without installing local dependencies or configuring API keys.
- **Journey:**
  1. Opens application in **Demo Mode**.
  2. Selects pre-loaded scenario: *"E-Commerce Refund Calculation Regression"*.
  3. Clicks **"Run Investigation"** to observe healthy baseline ($R_0$) vs. faulted run ($R_1$).
  4. Inspects interactive DAG; sees visual divergence alert at Step 3 (`compute_net_revenue`).
  5. Reviews Side-by-Side Row Diff with highlighted cell-level value drift.
  6. Inspects **Evidence Drawer**: notes exact formula change in transformation logic.
  7. Clicks **"Apply Recommended Fix"** $\rightarrow$ executes Fix Run ($R_2$).
  8. Observes **Fix Verification Card**: 100% equivalence restored with baseline, zero regressions (`VERIFIED_CLEAN`).
  9. Exports signed forensic report.

### 3.2 Persona 2: The Business / Analytics User (No-Code CSV Upload)
- **Objective:** Understand why yesterday's uploaded CSV produced different customer churn counts compared to today's CSV, without writing code.
- **Journey:**
  1. Opens **CSV Upload Mode**.
  2. Uploads baseline file (`customers_v1.csv`) and modified file (`customers_v2.csv`).
  3. Reviews inferred schemas, null counts, and column types.
  4. Uses the visual pipeline builder to construct a 4-step pipeline: Filter $\rightarrow$ Deduplicate $\rightarrow$ Join $\rightarrow$ Group By.
  5. Executes Run $R_0$ on $v1$; executes Run $R_1$ on $v2$.
  6. System highlights that 14 records in $v2$ had uppercase emails, causing a case-sensitive join failure in Step 3.
  7. Modifies Step 2 to add `normalize_string(email, lower)`.
  8. Triggers verification run; confirms join match rate returns to 100%.

### 3.3 Persona 3: The Data & Analytics Engineer (Developer Mode)
- **Objective:** Integrate regression assertions into CI/CD, run declarative pipeline definitions, inspect content hashes, and verify historical reproducibility.
- **Journey:**
  1. Opens **Developer Mode** (or interacts via REST API).
  2. Submits a declarative pipeline specification (`pipeline_spec.yaml`) defining inputs, steps, and intermediate checkpoints.
  3. Executes pipeline with baseline fixture parameters.
  4. Injects a code patch or modified input manifest.
  5. Executes comparison run.
  6. Inspects JSON execution manifest: verifies step-by-step SHA-256 hashes, execution duration, and memory watermarks.
  7. Queries REST API `/api/v1/investigations/{id}/diff` for machine-readable JSON diffs.
  8. Runs replay check against historical run hash; confirms whether retained artifacts yield bit-for-bit equivalence.

---

## 4. Mode A: Demo Mode Detailed Scenario Specifications

Demo Mode runs entirely on pre-compiled, deterministic synthetic fixtures stored in the application distribution. It requires zero file uploads and zero network access.

### 4.1 Scenario 1 (`SCN-01`): Upstream Vendor Input Data Drift (`DR-01`)
1. **Initial Dataset & Pipeline:** Ingests `orders_data` (Orders Ingestion & Regional Aggregation). Pipeline: `ingest_orders` $\rightarrow$ `filter_completed` $\rightarrow$ `aggregate_revenue`.
2. **Injected Defect / Regression:** External source vendor modified ingestion payload (e.g. order amounts drifting from 100.0 to 120.0, or injected extraneous orders), producing upstream data drift at the ingestion boundary.
3. **Expected Detection:** Earliest Observable Divergence (EOD) detected at Step 1 (`ingest_orders`). Rule `DR_01_UPSTREAM_INPUT_DATA_DRIFT` triggered.
4. **Evidence Supporting Finding:** Step 1 raw input row hash and cell values deviate between $R_0$ and $R_1$; downstream filter and regional aggregation propagate the drifted totals.
5. **Affected Downstream Nodes:** Step 2 (`filter_completed`), Step 3 (`aggregate_revenue`).
6. **Proposed Correction:** Ingest sanitized vendor orders or apply upstream schema validation filter.
7. **Expected Output Before & After:** Corrected Run $R_2$ restores baseline order amounts and matching regional revenue.
8. **Expected Tri-Run Verification Verdict:** `VERIFIED_CLEAN` ($R_2 \equiv R_0$ downstream; delta against $R_1$ eliminated).
9. **Negative Test:** If fix leaves drifted amounts active, verification reports `REGRESSION_UNRESOLVED`.
10. **Regression Test:** Automated assertion validating that regional revenue totals match golden baseline.

### 4.2 Scenario 2 (`SCN-02`): Arithmetic Expression Mutation (`DR-02`)
1. **Initial Dataset & Pipeline:** Ingests `transactions` (Transaction Fee Calculation). Pipeline: `ingest_transactions` $\rightarrow$ `compute_fee` $\rightarrow$ `mart_revenue`.
2. **Injected Defect / Regression:** In Step 2 (`compute_fee`), dynamic fee parameter expression mutated from `amount * 0.1` to `amount * 0.2` (100% fee multiplier increase).
3. **Expected Detection:** EOD at Step 2 (`compute_fee`). Input data matches, but cell-level value drift occurs across all rows. Rule `DR_02_ARITHMETIC_EXPRESSION_MUTATION` triggered.
4. **Evidence Supporting Finding:** Upstream inputs to Step 2 are identical ($H(\text{in}_{R_1}) = H(\text{in}_{R_0})$); AST diff indicates multiplier coefficient mutated from 0.1 to 0.2.
5. **Affected Downstream Nodes:** Step 3 (`mart_revenue`).
6. **Proposed Correction:** Restore fee expression to `amount * 0.1`.
7. **Expected Output Before & After:** Faulted Run $R_1$ has doubled fees ($700.00 total); Corrected Run $R_2$ outputs $350.00 total matching $R_0$.
8. **Expected Tri-Run Verification Verdict:** `VERIFIED_CLEAN`.
9. **Negative Test:** If fee expression is altered to an incorrect formula, verification reports `REGRESSION_UNRESOLVED` or `COLLATERAL_DAMAGE`.
10. **Regression Test:** Automated assertion checking fee calculation precision against $R_0$ golden fixture.

### 4.3 Scenario 3 (`SCN-03`): Unmatched Join Drop (`DR-03`)
1. **Initial Dataset & Pipeline:** Ingests `orders` and `customers` (Customer Orders Join). Pipeline: `ingest_orders` + `ingest_customers` $\rightarrow$ `join_orders_customers` (inner join on `customer_id`).
2. **Injected Defect / Regression:** In upstream customer updates or join configuration, customer ID references mutated or dropped, causing catastrophic 75% row drop during inner join.
3. **Expected Detection:** EOD at Step 3 (`join_orders_customers`). Row count drops from baseline without syntax errors. Rule `DR_03_UNMATCHED_JOIN_DROP` triggered.
4. **Evidence Supporting Finding:** Input orders and customers exist, but join match rate drops precipitously; row delta indicates missing joined records.
5. **Affected Downstream Nodes:** All downstream marts dependent on `join_orders_customers`.
6. **Proposed Correction:** Restore proper foreign keys or configure appropriate join fallback.
7. **Expected Output Before & After:** Faulted Run $R_1$ output row count: 1; Corrected Run $R_2$ output row count: 4 (100% multiset match with $R_0$).
8. **Expected Tri-Run Verification Verdict:** `VERIFIED_CLEAN`.
9. **Negative Test:** If foreign keys remain mismatched, row count remains depressed, yielding `REGRESSION_UNRESOLVED`.
10. **Regression Test:** Cardinality assertion verifying join output row count equals baseline.

### 4.4 Scenario 4 (`SCN-04`): Null Sentinel Surge (`DR-05`)
1. **Initial Dataset & Pipeline:** Ingests `metrics` (Metric Scoring & Cleansing). Pipeline: `ingest_metrics` $\rightarrow$ `clean_data`.
2. **Injected Defect / Regression:** Expression or type conversion coerces valid scores to NULL (null sentinel surge), causing valid numeric scores to become null across all active records.
3. **Expected Detection:** EOD at Step 2 (`clean_data`). Row counts match, but null count in `score` column surges from 0 to 100%. Rule `DR_05_NULL_SENTINEL_SURGE` triggered.
4. **Evidence Supporting Finding:** Column null ratio diff surfaces 100% null mutation in `score`; raw input has valid non-null floats.
5. **Affected Downstream Nodes:** Downstream scoring aggregations and analytics marts.
6. **Proposed Correction:** Restore proper score derivation expression retaining numeric floats.
7. **Expected Output Before & After:** Faulted Run $R_1$ has all null scores; Corrected Run $R_2$ restores non-null scores matching $R_0$.
8. **Expected Tri-Run Verification Verdict:** `VERIFIED_CLEAN`.
9. **Negative Test:** If expression still emits nulls, null ratio remains elevated, yielding `REGRESSION_UNRESOLVED`.
10. **Regression Test:** Assertion verifying null ratio in `score` equals 0.0.

---

## 5. Mode B: CSV Upload Mode Detailed Specification

### 5.1 Import Contract & Data Preservation
- **Source Byte Preservation:** When a CSV file is uploaded, raw bytes are immediately copied to `~/.data_rewind/workspaces/{workspace_id}/raw_inputs/{sha256}.csv` and made read-only (`chmod 0444`). This raw file serves as immutable physical evidence.
- **UTF-8 Handling & Byte Order Mark (BOM):**
  - UTF-8 with BOM (`utf-8-sig`) is automatically detected and the 3-byte prefix (`\xEF\xBB\xBF`) is stripped transparently.
  - Standard UTF-8 without BOM is default.
  - Fallback to Latin-1/ISO-8859-1 is attempted if UTF-8 decoding fails; unhandled raw binary aborts with `INVALID_ENCODING_ERROR`.
- **Delimiter & Quoting Standards:**
  - Standard RFC 4180 parsing with comma (`,`), semicolon (`;`), or tab (`\t`) auto-detected across first 64 KB.
  - Double quotes (`"`) enclose fields containing delimiters or newlines; literal quotes are represented as `""`.
- **Header Policies:**
  - Duplicate headers trigger `DUPLICATE_HEADER_ERROR(col_name)` or are deterministically renamed with `_1`, `_2` suffix with an explicit warning recorded in manifest.
  - Empty headers trigger `EMPTY_HEADER_ERROR(col_index)`.
  - Reserved column names (`_row_id`, `_row_hash`, `_diff_status`) are disallowed in raw inputs; ingestion automatically prefixes collisions with `orig_`.
- **Empty Strings vs. Nulls:**
  - Empty unquoted string `""` is parsed as SQL `NULL`.
  - Quoted empty string `""` is parsed as empty string `""`.
  - Configurable sentinel list (`["NA", "N/A", "null", "NULL", "-999"]`) can be mapped to SQL `NULL` during schema preview.
- **Type Inference & Schema Overrides:**
  - Automatic inference samples first 1,000 rows using strict priority: `BOOLEAN` $\rightarrow$ `INTEGER` $\rightarrow$ `FLOAT` $\rightarrow$ `DATE` $\rightarrow$ `TIMESTAMP` $\rightarrow$ `STRING`.
  - Users can manually override inferred types during the Preview step. Parsing decisions and overrides are recorded in the run manifest.
- **Inconsistent Field Counts:**
  - Any row with column count differing from header aborts ingestion with `MALFORMED_CSV_RECORD_ERROR(line_number, expected_cols, observed_cols)`.
- **File & Line Limits:**
  - Uncompressed file size limit: **50 MB**. Compressed formats (`.gz`, `.zip`) are rejected in v1.0.
  - Maximum row count: **500,000 rows** (excluding header and trailing blank lines).
  - Maximum line length: **65,536 bytes**.
  - Maximum cell length: **4,096 characters**.

---

### 5.2 Supported Transformations Catalog (12 Operations)

| Transformation Name | Operational Semantics | Configurable Parameters | Validation Rules |
| :--- | :--- | :--- | :--- |
| `select_columns` | Retains specified columns in specified order; drops others. | `columns: list[str]` | Must specify at least 1 valid existing column. |
| `rename_columns` | Renames one or more columns. | `mapping: dict[str, str]` | Target names must not collide with existing columns. |
| `drop_columns` | Removes specified columns from output. | `columns: list[str]` | Cannot drop all columns; must leave $\ge 1$. |
| `filter_rows` | Retains rows matching a boolean expression. | `predicate: str` (Restricted AST) | Must evaluate to boolean; bounded AST complexity (depth $\le 10$, node count $\le 50$). |
| `deduplicate_rows` | Drops duplicate rows based on subset or all columns. | `subset: Optional[list[str]]`, `keep: "first" \| "last"` | Columns in subset must exist in dataset. |
| `handle_missing` | Drops rows with nulls or fills with specified strategy. | `columns: list[str]`, `strategy: "drop" \| "fill_literal" \| "fill_mean" \| "fill_mode"`, `value: Any` | Literal must match column data type. Mean requires numeric. |
| `cast_types` | Converts column types to target primitive. | `casts: dict[str, "int" \| "float" \| "string" \| "boolean" \| "date" \| "timestamp"]`, `error_behavior: "coerce_null" \| "fail"` | Formats must be standard ISO for dates. |
| `join_datasets` | Relational join of two tabular streams. | `left_on: list[str]`, `right_on: list[str]`, `how: "inner" \| "left" \| "right" \| "outer"` | Join keys must have compatible data types. |
| `aggregate_group_by`| Groups by keys and computes aggregations. | `group_keys: list[str]`, `aggregations: list[{column, func, alias}]` (`sum, avg, min, max, count, count_distinct`) | Non-aggregated columns must be in `group_keys`. |
| `sort_rows` | Sorts dataset by one or more columns with primary key tie-breaker. | `by: list[{column, order: "asc" \| "desc"}]` | Columns must exist and support ordering. |
| `derive_column` | Computes a new column using a restricted AST expression. | `new_column: str`, `expression: str` | Bounded AST complexity (depth $\le 10$, node count $\le 50$); type-checked. |
| `data_quality_rule`| Evaluates assertions (`is_not_null`, `in_range`, `matches_regex`); flags violations without aborting. | `rule_type: str`, `column: str`, `params: dict`, `severity: "warn" \| "fail"` | Rule type must be in registered validator catalog. |

---

## 6. Mode C: Developer Mode Specification

### 6.1 Declarative Pipeline Specification
Developer Mode allows data engineers to define pipelines via declarative JSON or YAML manifests. This enables version control, programmatic CI/CD invocation, and exact pipeline serialization.

```yaml
# Example Data Rewind Declarative Pipeline Manifest (v1)
version: "1.0"
pipeline_id: "order_margin_pipeline"
name: "Order Net Margin Daily Aggregator"
description: "Ingests raw orders and returns, joins vendor catalog, and computes margin."

inputs:
  - id: "raw_orders"
    type: "csv"
    path: "fixtures/orders_2026_10.csv"
    primary_key: ["order_id"]
  - id: "raw_returns"
    type: "csv"
    path: "fixtures/returns_2026_10.csv"
    primary_key: ["return_id"]

steps:
  - id: "step_clean_orders"
    operation: "filter_rows"
    inputs: ["raw_orders"]
    params:
      predicate: "order_status == 'COMPLETED' and order_amount > 0"

  - id: "step_dedup_returns"
    operation: "deduplicate_rows"
    inputs: ["raw_returns"]
    params:
      subset: ["order_id"]
      keep: "first"

  - id: "step_join_returns"
    operation: "join_datasets"
    inputs: ["step_clean_orders", "step_dedup_returns"]
    params:
      left_on: ["order_id"]
      right_on: ["order_id"]
      how: "left"

  - id: "step_compute_net"
    operation: "derive_column"
    inputs: ["step_join_returns"]
    params:
      new_column: "net_amount"
      expression: "order_amount - coalesce(refund_amount, 0.0)"

  - id: "step_daily_summary"
    operation: "aggregate_group_by"
    inputs: ["step_compute_net"]
    params:
      group_keys: ["order_date"]
      aggregations:
        - { column: "net_amount", func: "sum", alias: "total_net_revenue" }
        - { column: "order_id", func: "count", alias: "order_count" }

outputs:
  - id: "daily_revenue_mart"
    from_step: "step_daily_summary"
    primary_key: ["order_date"]
```

### 6.2 Regression Fixture Definition
Developer Mode supports formal **Regression Test Fixtures**. A fixture pairs:
1. Baseline Input Manifest (pinned by SHA-256 hashes).
2. Pipeline Definition (pinned by version/hash).
3. Golden Output Assertions (expected row count, column schemas, aggregate bounds, or exact output hashes).
4. Dual Execution Comparison: Whenever a pipeline modification is proposed, Developer Mode executes the pipeline and evaluates differences against the golden baseline.
