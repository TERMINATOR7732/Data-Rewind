# Data Rewind — Professional Demonstration Script

**Document Version:** 1.0.0  
**Target Release:** Data Rewind v0.1.0  
**Estimated Demo Time:** 5 to 7 minutes (Standard) / 2 minutes (Executive Variant)  
**Environment:** 100% Offline / Localhost  
**Hardware Requirements:** Standard Developer Laptop (Windows, macOS, or Linux)  

---

## 1. Demonstration Setup & Prerequisites

Before presenting to a technical interviewer, recruiter, or engineering team, ensure your local environment is initialized:

### Prerequisites
- Python 3.11+ and Node.js 20+ installed.
- Repository cloned locally.

### Startup Commands
In your terminal, run the one-click launcher:

**Windows:**
```cmd
run.bat
```

**Linux / macOS:**
```bash
./run.sh
```

### Verification Checklist Before Starting the Demo
1. Browser opens automatically to `http://localhost:5173`.
2. Header status pill in the top-right corner displays `HEALTH: OK (0.1.0)` with a green pulse dot.
3. The **Demo Sandbox** tab is active and shows 4 pre-loaded scenarios.
4. Browser developer tools are closed to maintain a clean presentation view.

---

## 2. Standard Demonstration Flow (5 to 7 Minutes)

### Part 1: Introduction & The Core Problem (30 seconds)
> **Spoken Narrative:**  
> *"In enterprise data engineering, pipelines frequently finish with an exit code of `0` while silently producing corrupted, drifted, or incomplete datasets. A schema change by an upstream vendor, an updated formula, an unmatched join, or null sentinel dropout can contaminate downstream dashboards for weeks before anyone notices.*  
>  
> *Data Rewind is an offline-first, evidence-based data engineering workbench designed to solve this entire forensic lifecycle locally—from pinpointing the exact step where divergence started, to assessing downstream blast radius, reproducing the issue, and mathematically verifying a fix across our Tri-Run evaluation matrix."*

---

### Part 2: Scenario Selection & Pipeline Execution (60 to 90 seconds)
> **Action:** In the **Demo Sandbox** tab, observe the list of pre-loaded scenarios on the left. Click on **`SCN-01: Upstream Vendor Input Data Drift`**.

> **Spoken Narrative:**  
> *"To demonstrate this, we have pre-loaded four deterministic regression scenarios. Let's look at `SCN-01`: an external source vendor changed their ingestion payload without warning, altering transaction amounts and inserting an uncontracted row.*  
>  
> *Notice the metadata panel on the right: our expected Earliest Observable Divergence is step `ingest_orders`, and our expected diagnostic rule is `DR-01_UPSTREAM_INPUT_DATA_DRIFT`.*  
>  
> *Let's click **Run Investigation**."*

> **Action:** Click the green **Run Investigation** button.
> **Observation:** The button displays a brief spinner (`Executing Pipeline...`). In under one second, the engine executes both baseline and faulted pipelines in in-process DuckDB, computes multiset hashes, isolates the fault, and automatically redirects to the **Investigation & Lineage** tab.

---

### Part 3: Earliest Observable Divergence & Lineage Tracing (60 to 90 seconds)
> **Spoken Narrative:**  
> *"We are now in the **Investigation & Lineage** view. Notice what the engine has calculated automatically:*  
>  
> *Look at the top header cards:*  
> *- **Earliest Observable Divergence (EOD):** Step `ingest_orders` has been identified as the root divergence point.*  
> *- **Blast Radius:** 3 affected steps, 1 tainted terminal dataset, and 5 contaminated downstream rows.*  
>  
> *Now look at the interactive DAG canvas powered by React Flow:*  
> *- Step `ingest_orders` is highlighted with an amber glowing **EOD Beacon**.*  
> *- Downstream edges leading to `filter_completed` and `aggregate_revenue` animate with red taint pulses, visualizing exactly how corruption propagated through the pipeline graph.*  
> *- For accessibility or screen readers, we can toggle the **Lineage Table** button to view the exact same topological data in a structured, keyboard-navigable table."*

---

### Part 4: Granular Row-Level Delta Inspection (60 to 90 seconds)
> **Action:** Under the graph canvas, click on step **`ingest_orders`** in the step selector buttons. Scroll down to the **Diff Table**.

> **Spoken Narrative:**  
> *"Now let's examine the raw evidence. Under the graph, we select the faulted step `ingest_orders`.*  
>  
> *Data Rewind evaluates 15 comparison cases using additive dual-accumulator multiset hashing. Look at the partition summary above the table:*  
> *- **3 Identical rows**.*  
> *- **1 Modified row**.*  
> *- **1 Added row**.*  
>  
> *Let's click the **MODIFIED** filter pill:*  
> *- Look at row `order_id = 1`: the baseline amount was `$100.00`, but the vendor mutated it to `$120.00`. The changed cell is highlighted in amber with the exact numeric delta.*  
>  
> *Now let's click the **ADDED** filter pill:*  
> *- Look at row `order_id = 5`: an uncontracted transaction of `$300.00` in region `WEST` was injected upstream.*  
>  
> *On the right, the **Evidence & Root-Cause Panel** segregates mathematically proven observations—like row count mismatches and multiset fingerprint inequality—from our causal hypothesis, triggering rule `DR-01_UPSTREAM_INPUT_DATA_DRIFT` with 100% determinism."*

---

### Part 5: Tri-Run Fix Verification ($R_0, R_1, R_2$) (60 to 90 seconds)
> **Action:** Click back to the **Demo Sandbox** tab in the top navigation header. Under section **2. Tri-Run Fix Verification**, ensure the Remediation Mode dropdown is set to **`Clean Fix (Restores Baseline Equivalence)`**.

> **Spoken Narrative:**  
> *"Now suppose an engineer deploys a candidate fix ($R_2$). In standard workflows, engineers just re-run the pipeline and eyeball the result. But how do you know the fix didn't introduce collateral damage elsewhere?*  
>  
> *Data Rewind uses a **Tri-Run Fix Verification Matrix**: it evaluates candidate run $R_2$ simultaneously against faulted run $R_1$ to confirm remediation, and against baseline run $R_0$ to confirm baseline parity.*  
>  
> *Let's click **Verify Fix Candidate**."*

> **Action:** Click the **Verify Fix Candidate** button.
> **Observation:** The workbench navigates to the **Fix Verification Hub**, displaying a large green **VERIFIED_CLEAN** badge.

> **Spoken Narrative:**  
> *"Look at the verification verdict: **VERIFIED_CLEAN**.*  
>  
> *Notice our dual-axis evaluation cards:*  
> *- **Axis 1 (Remediation vs Faulted $R_1$):** Confirms that the mutated records and extra row were successfully filtered out.*  
> *- **Axis 2 (Baseline Equivalence vs $R_0$):** Mathematically proves 100% multiset hash equality and zero row deltas against historical baseline $R_0$.*  
>  
> *If the patch had only partially fixed the problem, or introduced a new regression in a downstream step, the platform would have issued `PARTIAL_RESTORATION` or `NEW_FAULT_INTRODUCED`."*

---

### Part 6: Forensic Report Studio & Export (30 to 60 seconds)
> **Action:** Click the **Export Signed Dossier** button in the top-right of the Verification Hub (or click the **Report Studio** tab in the main header).

> **Spoken Narrative:**  
> *"Finally, an investigation is only as good as the audit trail it produces. Here in the **Report Studio**, we can export a signed forensic dossier in JSON, Markdown, or Spreadsheet-Safe CSV.*  
>  
> *For CSV exports, Data Rewind includes **Type-Aware Formula Injection Protection**: if an upstream malicious input or formula begins with `=`, `+`, `-`, `@`, `\t`, or `\r`, it is safely prepended with a single quote to prevent remote code execution in spreadsheet software, while preserving raw formatting for authentic numeric values.*  
>  
> *Let's select **Markdown** and click **Download Dossier**. We now have an immutable, self-contained audit report ready to attach to an engineering incident ticket or compliance review."*

---

### Part 7: Closing Summary (20 seconds)
> **Spoken Narrative:**  
> *"To summarize: Data Rewind provides an end-to-end, deterministic forensic investigation workbench. It combines in-process DuckDB performance, sandboxed expression safety, and dual-axis fix verification—running 100% locally with zero operating cost and zero data privacy exposure.*  
>  
> *Thank you! I'm happy to dive deeper into any architectural or implementation questions."*

---

## 3. Executive Variant (2-Minute Fast Demo)

When presenting in time-constrained interviews or quick portfolio walkthroughs:

1. **Problem (15s):** *"Silent data regressions slip past traditional unit tests because pipelines exit with code `0` while data drifts."*
2. **Investigation (30s):** Open **Demo Sandbox** $\rightarrow$ Click **Run Investigation** on `SCN-01`. Point out the amber **EOD Beacon** on `ingest_orders` and the animated taint edges flowing downstream.
3. **Row Diff (30s):** Click `ingest_orders` $\rightarrow$ Toggle **MODIFIED** filter to show the `$100 \rightarrow $120` amount drift; toggle **ADDED** to show the unexpected row.
4. **Fix Verification (30s):** Open **Demo Sandbox** $\rightarrow$ Click **Verify Fix Candidate** $\rightarrow$ Show the **VERIFIED_CLEAN** dual-axis card confirming both fault remediation and historical baseline equivalence.
5. **Close (15s):** *"Local-first, zero recurring cost, in-process DuckDB engine, and zero cloud lock-in."*

---

## 4. Troubleshooting & Demo Recovery

| Issue | Likely Cause | Immediate Recovery Action |
| :--- | :--- | :--- |
| **Header shows `DISCONNECTED`** | Backend API daemon not running on port 8000. | Open terminal, run `.venv\Scripts\python.exe -m data_rewind.cli serve --port 8000`. Click the refresh icon next to the status badge in the UI. |
| **Port 8000 or 5173 in use** | A previous instance is still running in background. | In PowerShell: `Get-Process python, node \| Stop-Process -Force`. Re-run `run.bat`. |
| **Scenarios fail to load** | Local catalog database locked or missing. | Open **Workspace** tab $\rightarrow$ Click **Purge Workspace** $\rightarrow$ Return to **Demo Sandbox** and reload. |
| **Browser console warnings** | Browser extensions injecting DOM scripts. | Open demo in an Incognito / Private window. |

---

## 5. Post-Demo Cleanup
To reset the demonstration state to a clean initial state:
1. Stop running processes with `Ctrl + C` in the terminals.
2. In PowerShell, execute:
   ```powershell
   python -m data_rewind.cli diagnostics
   ```
   Confirm that storage and memory admissions remain nominal.
