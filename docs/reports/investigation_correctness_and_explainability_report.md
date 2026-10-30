# Data Rewind — Investigation Correctness & Explainability Overhaul Report

**Project:** Data Rewind  
**Tagline:** Understand the past. Verify the present.  
**Repository:** `TERMINATOR7732/Data-Rewind`  
**Milestone:** Investigation Correctness & Explainability Overhaul  
**Operating Cost:** ₹0 (Local-First Browser Engine + DuckDB-Wasm)  
**Date:** October 31, 2026  

---

## 1. Executive Summary

A critical issue was observed in Data Rewind where different CSV files appeared to produce identical investigation results. Following a systematic forensic audit of the entire execution path (from file selection, CSV parsing, fingerprinting, DuckDB-Wasm table creation, pipeline execution, to EOD detection and React state hydration), the root causes were isolated, reproduced empirically with automated tests, and completely remediated.

In addition, the entire forensic investigation user experience was overhauled to answer the **Five Core Questions** that every developer needs to understand when an anomaly occurs:
1. **What went wrong?** (Direct, plain-language description with zero jargon)
2. **Where did it go wrong?** (Exact pipeline step, dataset, transformation, and affected columns)
3. **What is the evidence?** (Exact measured values, row counts, deltas, sample before/after values, and hashes)
4. **Why does it matter?** (Downstream blast radius, tainted steps, affected terminal sinks, and risk level)
5. **How can I fix and verify it?** (Actionable recommendation, why it helps, and measurable verification conditions)

Technical diagnostic codes (`DR-01` to `DR-06`) and cryptographic hashes remain fully accessible in an expandable developer panel, preserving deep auditability without cluttering the primary user interface.

---

## 2. Root Cause Analysis: Why Different CSVs Produced Identical Results

Through reproducible tests in [`frontend/src/__tests__/investigation-reproduction.test.ts`](file:///e:/MHT%20CET%20REGISTRATION/BE/Task/DataRewind/frontend/src/__tests__/investigation-reproduction.test.ts), five interacting defects were uncovered across the ingestion, forensic, and state-management lifecycle:

### Root Cause 1: Ingestion Classification Defect & EOD Short-Circuit
- **Location:** [`frontend/src/runtime/forensics/service/investigation-service.ts`](file:///e:/MHT%20CET%20REGISTRATION/BE/Task/DataRewind/frontend/src/runtime/forensics/service/investigation-service.ts#L178-L181) and [`frontend/src/runtime/forensics/eod/index.ts`](file:///e:/MHT%20CET%20REGISTRATION/BE/Task/DataRewind/frontend/src/runtime/forensics/eod/index.ts#L98-L115).
- **The Defect:**
  ```typescript
  // In investigation-service.ts (Before):
  const isIngestion = inputs.length === 0 || stepId === topologicalOrder[0];
  ```
  Any single-source pipeline whose entry step was an analytical transformation (such as `step_1_filter` in `CSVInvestigation.tsx`) had `is_ingestion_node` set to `true`.
  Then in `EODDetector.detectEOD`:
  ```typescript
  // In eod/index.ts (Before):
  for (const stepId of topologicalOrder) {
    const ctx = stepContexts[stepId];
    if (ctx && ctx.is_ingestion_node && this.stepDiverged(ctx)) {
      findings.push(...DiagnosticRuleEngine.evaluateStep(ctx));
      return {
        status: EODStatus.UPSTREAM_INPUT_DATA_DRIFT,
        ...
        summary: `Earliest Observable Divergence detected at ingestion step '${stepId}'. Upstream input file changed content hash.`,
        divergence_category: "UPSTREAM_INPUT_DATA_DRIFT",
      };
    }
  }
  ```
  And in `DiagnosticRuleEngine.evaluateDR01`:
  ```typescript
  // In diagnostics/index.ts (Before):
  const hashesDiffer = ... || (ctx.baseline_output_hash !== ctx.target_output_hash) || (ctx.diff_result && !ctx.diff_result.is_equal);
  ```
- **Consequence:** If a user uploaded any CSV file, created a baseline, modified a filter condition (e.g., changed `amount > 0` to `amount > 100`), and ran candidate comparison, `EODDetector` immediately short-circuited and declared:
  > *"Ingestion input 'orders_table' changed content hash; raw source payload diverged (-1 rows delta)... Root cause is external source data mutation at ingestion boundary; not caused by downstream pipeline transformation code error."*
  It did this for **every single CSV upload**!

### Root Cause 2: Unhashed Dataset Identity & DuckDB Table Collisions
- **Location:** [`frontend/src/features/csv/CSVInvestigation.tsx`](file:///e:/MHT%20CET%20REGISTRATION/BE/Task/DataRewind/frontend/src/features/csv/CSVInvestigation.tsx#L161-L168) and [`frontend/src/runtime/worker/duckdb.worker.ts`](file:///e:/MHT%20CET%20REGISTRATION/BE/Task/DataRewind/frontend/src/runtime/worker/duckdb.worker.ts#L311-L320).
- **The Defect:** Dataset IDs and DuckDB table names were computed solely from `file.name.replace(/\.csv$/i, "")`.
- **Consequence:** Re-uploading an edited `data.csv`, or uploading different files with identical names (e.g. `orders.csv` from two sources), collided in DuckDB memory and in IndexedDB storage caches, reusing previous tables or schemas.

### Root Cause 3: Stale Context Retention Across File Selections
- **Location:** [`frontend/src/features/csv/CSVInvestigation.tsx`](file:///e:/MHT%20CET%20REGISTRATION/BE/Task/DataRewind/frontend/src/features/csv/CSVInvestigation.tsx#L107-L130).
- **The Defect:** Selecting or dropping a new CSV file cleared only local preview rows, but did NOT clear `baselinePipeline`, `candidateExecution`, or `currentInvestigation` in [`InvestigationContext.tsx`](file:///e:/MHT%20CET%20REGISTRATION/BE/Task/DataRewind/frontend/src/features/context/InvestigationContext.tsx).
- **Consequence:** Navigating to the "Investigate" tab displayed the previous dataset's investigation result.

### Root Cause 4: Hardcoded Empty State Probe
- **Location:** [`frontend/src/features/investigation/InvestigationView.tsx`](file:///e:/MHT%20CET%20REGISTRATION/BE/Task/DataRewind/frontend/src/features/investigation/InvestigationView.tsx#L173-L205).
- **The Defect:** The empty-state fallback probe (`handleRunBrowserProbe`) hardcoded transactions `TX_101` through `TX_105` with fee drift (`amount * 0.05` vs `amount * 0.10`).
- **Consequence:** Whenever a user clicked the probe button, it displayed the exact same settlement rows regardless of what CSV was loaded.

### Root Cause 5: Cryptic Diagnostic Codes Over Plain Explanations
- **Location:** [`frontend/src/components/EvidencePanel.tsx`](file:///e:/MHT%20CET%20REGISTRATION/BE/Task/DataRewind/frontend/src/components/EvidencePanel.tsx).
- **The Defect:** Findings surfaced technical codes (`DR-01: UPSTREAM_INPUT_DATA_DRIFT`, `DR-02: ARITHMETIC_EXPRESSION_MUTATION`) as primary headings without answering what happened, why it matters, or how to fix it.

---

## 3. Architecture & Remediation Implementation

### 3.1 Content-Isolated Dataset Identities & DuckDB Tables
- In [`frontend/src/features/csv/CSVInvestigation.tsx`](file:///e:/MHT%20CET%20REGISTRATION/BE/Task/DataRewind/frontend/src/features/csv/CSVInvestigation.tsx#L165-L180), every upload derives a SHA-256 fingerprint from the raw file buffer via `crypto.subtle.digest("SHA-256", buffer)`.
- Table names and dataset IDs are strictly content-addressed:
  $$\text{sanitizedTableName} = \text{raw\_}\{\text{cleanBase}\}\_\{\text{sha256Hex}[0..9]\}$$
- Even if two uploaded files have the exact same filename (e.g. `orders.csv`), their DuckDB tables and IndexedDB records are completely distinct (`raw_orders_a1b2c3d4e5` vs `raw_orders_f6g7h8i9j0`).

### 3.2 Full State Reset on File Change
- When a new file is chosen or dragged into `CSVInvestigation.tsx`:
  - `setFile(newFile)`
  - `setUploadResult(null)`
  - `setPreviewData(null)`
  - `setPipelineOutcome(null)`
  - `setOutputRows([])`
  - `setOutputColumns([])`
  - `setBaselineExecution(null)`
  - `setBaselinePipeline(null)`
  - `setCandidateExecution(null)`
  - `setCurrentInvestigation(null)` (clears global investigation context)
- Zero stale state can leak across datasets or tab switches.

### 3.3 Accurate Diagnostic Ingestion vs Parameter Classification
- In [`frontend/src/runtime/forensics/service/investigation-service.ts`](file:///e:/MHT%20CET%20REGISTRATION/BE/Task/DataRewind/frontend/src/runtime/forensics/service/investigation-service.ts#L178-L188):
  Analytical transformations (`filter_rows`, `derive_column`, `aggregate_group_by`, etc.) are recognized as transformations, never raw ingestion nodes.
- In [`frontend/src/runtime/forensics/diagnostics/index.ts`](file:///e:/MHT%20CET%20REGISTRATION/BE/Task/DataRewind/frontend/src/runtime/forensics/diagnostics/index.ts#L70-L85):
  - `evaluateDR01` (Upstream Input Data Drift) verifies that `paramsDiffer === false`. If parameters mutated, it refuses to fire DR-01.
  - `evaluateDR02` was expanded to recognize filter predicate mutations (`predicate` changed) and general parameter mutations, computing exact row count deltas rather than requiring identical row counts.
- In [`frontend/src/runtime/forensics/eod/index.ts`](file:///e:/MHT%20CET%20REGISTRATION/BE/Task/DataRewind/frontend/src/runtime/forensics/eod/index.ts#L98-L115):
  `EODDetector` only flags `UPSTREAM_INPUT_DATA_DRIFT` if DR-01 genuinely confirmed that external input hashes or payloads changed without code changes.

### 3.4 The Five Core Questions Contract ([`StructuredFinding`](file:///e:/MHT%20CET%20REGISTRATION/BE/Task/DataRewind/frontend/src/runtime/forensics/contracts.ts#L200-L225))
A unified explainability interface was codified across `frontend/src/runtime/forensics/contracts.ts` and `frontend/src/types/api.ts`:
```typescript
export interface StructuredFinding {
  // 1. What went wrong? (Plain, direct, unambiguous language — zero jargon)
  what_went_wrong: string;

  // 2. Where did it go wrong? (Exact step, dataset, transformation, affected columns)
  where: {
    step_id: string;
    step_name?: string;
    dataset_name?: string;
    operation: string;
    affected_columns: string[];
  };

  // 3. What is the evidence? (Exact measured values, row counts, deltas, sample diffs, fingerprints)
  evidence: {
    baseline_row_count: number;
    target_row_count: number;
    row_delta: number;
    baseline_hash?: string;
    target_hash?: string;
    schema_changes?: {
      added: string[];
      removed: string[];
      type_changes: Record<string, [string, string]>;
    };
    sample_records?: Array<{
      key: Record<string, unknown>;
      before: Record<string, unknown>;
      after: Record<string, unknown>;
      diff_columns: string[];
    }>;
    observed_facts: string[];
  };

  // 4. Why does it matter? (Downstream impact, tainted steps, affected sinks, risk level)
  impact: {
    risk_level: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
    blast_radius_steps: string[];
    affected_terminal_sinks: string[];
    consequence: string;
  };

  // 5. How can I fix and verify it? (Actionable recommendations, why it helps, verification check)
  remediation: {
    action: string;
    explanation: string;
    verification_check: string;
  };

  // Technical diagnostic codes for expandable developer panel
  technical_details: {
    rule_id: DiagnosticRuleID | string;
    rule_name: string;
    evidence_tier: EvidenceTier;
    divergence_category?: string;
    confidence_explanation?: string;
    parameters_diff?: {
      baseline?: Record<string, unknown>;
      target?: Record<string, unknown>;
    };
  };
}
```

### 3.5 UI Overhaul: Five-Question Evidence Panel & Clean Lineage DAG
- [`frontend/src/components/EvidencePanel.tsx`](file:///e:/MHT%20CET%20REGISTRATION/BE/Task/DataRewind/frontend/src/components/EvidencePanel.tsx) was completely re-architected to display the five questions as primary sections:
  - **1. What Went Wrong?** Plain-language statement (e.g. *"The filter condition in step 'step_1_filter' was modified from 'amount > 0' to 'amount > 100', causing 1 rows to be excluded."*).
  - **2. Where Did It Go Wrong?** Structured metadata grid showing Step ID, Source Dataset, Operation, and Affected Columns.
  - **3. What Is The Evidence?** Measured metrics cards (Baseline Rows, Candidate Rows, Row Delta), Verified Observations checklist, and Sample Record differences.
  - **4. Why Does It Matter?** Risk level badge, Consequence summary, and Graph Taint Ratio with affected terminal sinks.
  - **5. How Can I Fix & Verify It?** Recommended Action, Why This Helps, and a Measurable Verification Condition.
  - **Expandable Accordion:** Technical Details (Rule ID, Evidence Tier, Parameter comparison diffs, and cryptographic content hashes).
- [`frontend/src/components/LineageGraph.tsx`](file:///e:/MHT%20CET%20REGISTRATION/BE/Task/DataRewind/frontend/src/components/LineageGraph.tsx):
  - Removed glowing shadow borders (`shadow-[0_0_12px...]`) and pulse animations to comply with engineering guidelines.
  - Added a clean status legend: **Verified Clean (Green)**, **First Divergence / EOD (Amber)**, and **Downstream Tainted (Rose)**.

---

## 4. Empirical Verification & Tested Datasets

Two completely distinct real-world CSV datasets were verified through automated tests:

### Dataset A: `valid_orders.csv` / `test_orders_a.csv`
- **Schema:** `order_id` (STRING), `customer_id` (STRING), `amount` (FLOAT), `status` (STRING)
- **Baseline Rows:** 3 rows (`101`, `102`, `103`)
- **Pipeline:** Filter predicate `amount > 0`
- **Candidate Mutation:** Filter predicate changed to `amount > 100` (excluding order `102` with amount `25.50`)
- **Result:**
  - Status: `EXACT_EOD` at `step_1_filter`
  - Diagnosis: `DR_02_ARITHMETIC_EXPRESSION_MUTATION` (Transformation Parameter Mutation)
  - What Went Wrong: *"The filter condition in step 'step_1_filter' was modified from 'amount > 0' to 'amount > 100', causing 1 rows to be excluded."*
  - Evidence: Baseline 3 rows $\to$ Candidate 2 rows ($-1$ rows delta).
  - Remediation Check: *"Confirm that step 'step_1_filter' emits exactly 3 rows matching predicate 'amount > 0'."*

### Dataset B: `test_inventory_b.csv`
- **Schema:** `sku` (STRING), `warehouse` (STRING), `quantity` (INTEGER), `unit_cost` (FLOAT)
- **Baseline Rows:** 4 rows (`SKU-99`, `SKU-100`, `SKU-101`, `SKU-102`)
- **Pipeline:** Filter predicate `quantity >= 100` (2 rows pass: `SKU-99` and `SKU-100`)
- **Candidate Mutation:** Filter predicate changed to `quantity >= 0` (4 rows pass)
- **Result:**
  - Status: `EXACT_EOD` at `step_inv_filter`
  - Diagnosis: `DR_02_ARITHMETIC_EXPRESSION_MUTATION` (Transformation Parameter Mutation)
  - What Went Wrong: *"The filter condition in step 'step_inv_filter' was modified from 'quantity >= 100' to 'quantity >= 0', causing 2 rows to be added."*
  - Evidence: Baseline 2 rows $\to$ Candidate 4 rows ($+2$ rows delta).
  - Remediation Check: *"Confirm that step 'step_inv_filter' emits exactly 2 rows matching predicate 'quantity >= 100'."*

**Verification Outcome:** Both datasets produced independently correct schemas, column names, row counts, fingerprints, and distinct diagnostic findings. Zero cross-contamination occurred.

---

## 5. Verification Gates & Test Execution Summary

All five mandatory verification gates were executed and passed 100%:

| Gate | Command | Result | Summary |
| :--- | :--- | :--- | :--- |
| **1. TypeScript Compiler** | `Push-Location frontend; .\node_modules\.bin\tsc.cmd -b; Pop-Location` | **PASS (Exit 0)** | Zero type errors across all modules. |
| **2. Vitest Test Suite** | `Push-Location frontend; .\node_modules\.bin\vitest.cmd run; Pop-Location` | **PASS (Exit 0)** | **30 test files passed (217 / 217 tests, 100%)** |
| **3. Pytest Backend Suite**| `.venv\Scripts\python.exe -m pytest tests/` | **PASS (Exit 0)** | **260 passed, 0 failures (100%)** |
| **4. Playwright E2E Suite**| `Push-Location frontend; .\node_modules\.bin\playwright.cmd test e2e/investigation-overhaul-screenshots.spec.ts` | **PASS (Exit 0)** | **2 passed (19.4s)** |
| **5. Vite Production Build**| `Push-Location frontend; npm.cmd run build; Pop-Location` | **PASS (Exit 0)** | Bundled in 10.64s, zero syntax or bundling errors. |

---

## 6. Live UI Screenshots

Live production-fidelity screenshots were captured in headless Chromium and saved in the artifact directory:

1. **Five-Question Explainability & Root Cause Panel:**  
   `screenshots/investigation_overhaul/investigation_five_questions.png`  
   Demonstrates the Five Core Questions prominently displayed in the investigation view with exact measured metrics and plain language.

2. **Technical Diagnostic Details Accordion:**  
   `screenshots/investigation_overhaul/investigation_technical_details.png`  
   Demonstrates the expandable developer panel with diagnostic rule codes (`DR-02`), evidence tier badges, parameter diffs, and SHA-256 hashes.

3. **Orders Dataset Ingestion:**  
   `screenshots/investigation_overhaul/csv_orders_dataset.png`  
   Shows `test_orders_a.csv` ingested with 4 columns (`order_id`, `customer_id`, `amount`, `status`) and 3 rows.

4. **Inventory Dataset Ingestion (State Isolation):**  
   `screenshots/investigation_overhaul/csv_inventory_dataset.png`  
   Shows consecutive upload of `test_inventory_b.csv` with 4 columns (`sku`, `warehouse`, `quantity`, `unit_cost`) and 4 rows, completely replacing prior preview data.

---

## 7. Compliance Checklist

- [x] **Investigation Correctness:** Proven root causes of identical results across CSV uploads identified and fixed.
- [x] **No Filenames Alone:** Dataset identity uses content-addressable SHA-256 hashing.
- [x] **Five Core Questions Answered:**
  - [x] 1. What went wrong?
  - [x] 2. Where did it go wrong?
  - [x] 3. What is the evidence?
  - [x] 4. Why does it matter?
  - [x] 5. How can I fix and verify it?
- [x] **Technical Codes Preserved:** DR-01 through DR-06 preserved in expandable developer panels.
- [x] **EOD Causality Separation:** Confirmed observations strictly distinguished from causal hypotheses.
- [x] **Professional Visual Identity:** No chatbot, no glowing borders, no glassmorphism, no emojis, strict ₹0 budget.
- [x] **Git Discipline:** Zero unauthorized commits or remote pushes.
