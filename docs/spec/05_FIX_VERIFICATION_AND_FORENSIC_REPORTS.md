# Data Rewind — Fix Verification & Forensic Reports

**Document Version:** 1.2.0-FINAL-CLOSURE  
**Milestone:** 0.3 (Final Specification Closure & Implementation-Readiness Audit)  
**Status:** Complete Specification / Ready for Owner Review & Explicit Approval  
**Module Identifier:** `SPEC-MOD-05`

---

## 1. Tri-Run Fix Verification Methodology

In traditional data engineering, verifying a bug fix often relies on re-running the pipeline and checking that it didn't throw an exception. This is dangerously inadequate: a fix may eliminate the original crash while silently introducing a secondary regression or corrupting another column.

Data Rewind establishes a formal **Tri-Run Verification Protocol**:

```
      [ R0: Baseline Run ] ──────────────┐ (Healthy Reference)
               │                         │
               ▼                         ▼
      [ R1: Faulted Run ]       [ Dual-Axis Comparison ]
      (Defect Detected)                  │
               │                         │
               ▼                         │
   [ Patch Step or Input ]               │
               │                         │
               ▼                         ▼
      [ R2: Fix Run ] ───────────────────┘ (Candidate Remediation)
```

### 1.1 Ordering and Purpose of Runs
1. **$R_0$ (Baseline Run):** Establishes the historical golden truth and output equivalence target.
2. **$R_1$ (Faulted Run):** Reproduces the defect, confirming that the regression or data corruption exists at the Earliest Observable Divergence (EOD) node.
3. **$R_2$ (Candidate Fix Run):** Executes the pipeline incorporating the proposed patch or remediated input.

### 1.2 Dual-Axis Evaluation Matrix
Data Rewind evaluates the candidate Fix Run ($R_2$) across two simultaneous comparison axes:
- **Axis 1: Remediation Evaluation ($R_2 \text{ vs } R_1$):** Proves that the specific error, schema drift, or value drift observed at the EOD step was eliminated.
- **Axis 2: Baseline Equivalence ($R_2 \text{ vs } R_0$):** Proves that the fix introduced zero collateral regressions at non-targeted steps and downstream sinks.

---

### 1.3 Verification Verdict Taxonomy & Edge Cases

The engine synthesizes the dual comparisons into an unambiguous verdict. Under no circumstances is a fix labeled verified merely because the application ran without throwing an exception:

| Verdict Code | Condition | Meaning & UI Display |
| :--- | :--- | :--- |
| `VERIFIED_CLEAN` | $R_2$ remediates $R_1$ fault AND $R_2 \equiv R_0$ across all downstream sinks. | **VERIFIED CLEAN:** Baseline equivalence restored 100%. Zero secondary regressions detected. |
| `INTENTIONAL_UPDATE` | $R_2$ remediates $R_1$ fault; $R_2$ differs from $R_0$ strictly in columns/rows explicitly declared in the fix contract. | **INTENTIONAL DRIFT VERIFIED:** Pipeline logic updated as intended. Expected changes confirmed. |
| `PARTIAL_RESTORATION` | EOD fault severity reduced, but residual differences remain against $R_0$. | **PARTIAL RESTORATION:** Primary defect mitigated, but outputs remain divergent from baseline. |
| `REGRESSION_UNRESOLVED` | $R_2$ produces identical divergent outputs to $R_1$ at the EOD step. | **FIX FAILED:** Proposed modification did not eliminate the defect. |
| `NEW_FAULT_INTRODUCED` | EOD fault resolved, but a new divergence or runtime error appeared at a different step. | **CRITICAL WARNING:** Fix introduced secondary regression at Step $X$. Deployment blocked. |
| `BASELINE_UNAVAILABLE` | $R_0$ is missing; $R_2$ remediates $R_1$, but baseline equivalence cannot be established. | **REMEDIATION ONLY:** Defect eliminated, but baseline equivalence unverified due to missing $R_0$. |
| `FAULT_UNREPRODUCIBLE` | The defect in $R_1$ could not be reproduced under test conditions. | **VERIFICATION BLOCKED:** Faulted behavior is unverified; cannot prove remediation. |
| `INCONCLUSIVE_VERIFICATION` | Ambiguous keyless data correspondence or non-deterministic transformations present. | **INCONCLUSIVE:** Verification cannot be proven with mathematical certainty. |

---

## 2. Forensic Investigation Dossier & Type-Aware Export Specification

Data Rewind compiles every completed investigation into an immutable **Forensic Investigation Dossier**.

### 2.1 Dossier Structure
1. **Header & Metadata:** Dossier ID (`UUIDv4`), Pipeline Name, Version Hash, Investigator Session, Run IDs ($R_0, R_1, R_2$).
2. **Executive Summary & Verdict:** Root-cause summary, EOD node, and Verification Verdict.
3. **Itemized Evidence Chain:** Categorical evidence tiers (`PROVEN_OBSERVATION`, `CAUSAL_HYPOTHESIS_DIRECT_CODE_DIFF`, etc.).
4. **Downstream Blast Radius:** Tainted intermediate tables and downstream marts.
5. **Tri-Run Verification Proof:** Diff statistics (Added, Removed, Modified, Identical counts).
6. **Reproducibility Signatures:** SHA-256 digests of all inputs, artifacts, and replay manifests.

---

### 2.2 Export Modes & Type-Aware Formula-Injection Protection

Data Rewind provides two distinct CSV export modes to ensure data fidelity for engineering pipelines while safeguarding spreadsheet users:

#### Mode 1: Raw Data Export (`export_mode="raw"`)
- **Target Audience:** Programmatic consumers, Python scripts, databases, data warehouses.
- **Contract:** Outputs exact logical values without spreadsheet escaping. Preserves exact string and numeric values. Re-importing a raw exported CSV under the declared schema contract yields 100% equivalence with the in-memory tabular state.

#### Mode 2: Spreadsheet-Safe Export (`export_mode="safe"`)
- **Target Audience:** Business analysts opening CSVs in Microsoft Excel, LibreOffice Calc, or Google Sheets.
- **Type-Aware Escaping Policy:**
  1. **Numeric Preservation Rule:** Columns typed as `INTEGER` or `FLOAT` are **never** prefixed with an apostrophe (`'`). Legitimate negative numbers (`-42`, `-3.1415`) and positive values (`+100`) remain untouched valid numbers.
  2. **Untrusted String Sanitization Rule:** For columns typed as `STRING` or `TEXT`:
     - Strip leading whitespace (` `, `\t`, `\r`, `\n`).
     - Check if the first character is in the dangerous set: `{ '=', '+', '-', '@', '\t', '\r' }`.
     - Attempt a strict numeric parse (`float(val)` or `int(val)`). If it parses as a valid number, output as a raw number.
     - If it does **not** parse as a valid number (e.g. `=SUM(...)`, `-cmd|...`, `+calc`, `@SUM`), prepend a single apostrophe (`'`).
  3. **Clarification on Pipe Character (`|`):** In modern spreadsheet software (Excel, Calc, Google Sheets), a standalone pipe (`|`) does not execute formulas unless preceded by `=`. Standalone pipe characters (e.g. `"A|B"`) are preserved unescaped. Formulas containing pipes (e.g. `=cmd|...`) are caught by the leading `=` rule.
  4. **Loss-Aware Modification Notice:** Prepending an apostrophe modifies the raw string representation. The UI surfaces an explicit warning: *"Spreadsheet-safe export prepended apostrophes to X text cells to prevent formula execution in Excel. Use Raw Data Export for database re-import."* Export metadata records the exact list of escaped cells.

#### Test Case Suite for Formula Injection Defense

| Raw Input Cell Value | Inferred Type | Safe Export Output | Raw Export Output | Rationale & Handling |
| :--- | :--- | :--- | :--- | :--- |
| `-42.50` | `FLOAT` | `-42.50` | `-42.50` | Valid negative number; preserved as numeric. |
| `+100` | `INTEGER` | `+100` | `+100` | Valid positive number; preserved as numeric. |
| `=SUM(A1:B10)` | `STRING` | `'=SUM(A1:B10)` | `=SUM(A1:B10)` | Formula payload; escaped with `'` in safe mode. |
| `  =1+1` | `STRING` | `'  =1+1` | `  =1+1` | Whitespace-prefixed formula; escaped with `'`. |
| `-cmd\|' /C calc'!A0` | `STRING` | `'-cmd\|' /C calc'!A0` | `-cmd\|' /C calc'!A0` | DDE execution payload; escaped with `'`. |
| `+cmd\|' /C calc'!A0` | `STRING` | `'+cmd\|' /C calc'!A0` | `+cmd\|' /C calc'!A0` | Command execution payload; escaped with `'`. |
| `@SUM(A1)` | `STRING` | `'@SUM(A1)` | `@SUM(A1)` | Google Sheets function prefix; escaped with `'`. |
| `\t=1+1` | `STRING` | `'\t=1+1` | `\t=1+1` | Tab-prefixed formula; escaped with `'`. |
| `Normal Text` | `STRING` | `Normal Text` | `Normal Text` | Safe string; preserved untouched. |
| `""` (Empty String) | `STRING` | `""` | `""` | Empty string; preserved. |
| `NULL` | Any | `""` (unquoted) | `""` (unquoted) | SQL NULL; exported as unquoted empty field. |

#### Limitations of CSV Formula Injection Defenses
- Escaping is a client-side mitigation intended for desktop spreadsheet software.
- Different spreadsheet engines exhibit minor behavioral variations; apostrophe prefixing is the industry standard for Microsoft Excel and LibreOffice Calc.
- Consumers requiring bit-for-bit logical data preservation for ETL or data warehouses must choose **Raw Data Export**.
