# Data Rewind — Portfolio Screenshot Capture Plan

**Document Version:** 1.0.0  
**Target Release:** Data Rewind v0.1.0  
**Target Viewport:** 1920 × 1080 (1080p Desktop Full HD)  
**Color Theme:** Dark Mode (`bg-zinc-950` Terminal Aesthetic)  
**Output Directory:** `docs/assets/screenshots/`  

---

## 1. Principles for Authentic Portfolio Imagery

In strict adherence to engineering integrity standards:
- **No Synthetic or Mocked Visuals:** All portfolio screenshots must be captured directly from the live running application (`http://localhost:5173`).
- **No AI-Generated Placeholders:** Do not use Midjourney, DALL-E, or graphics editors to simulate application screens.
- **Real Engineering Data:** Use data produced by pre-loaded scenarios (`SCN-01` through `SCN-04`) or real RFC 4180 CSV uploads.
- **Zero Privacy Egress:** Ensure personal directory paths, credentials, and machine usernames are never exposed in browser address bars or terminal headers.

---

## 2. Target Screenshots Inventory

```
+----+-----------------------------+---------------------------------------+------------------------------------------+
| ID | Recommended Filename        | UI View / Tab                         | Primary Engineering Story Communicated   |
+----+-----------------------------+---------------------------------------+------------------------------------------+
| 01 | 01_workbench_demo_hub.png   | Demo Sandbox (`#demo`)                | Pre-loaded regression scenarios & status |
| 02 | 02_lineage_canvas_eod.png   | Investigation & Lineage (`#investigate`)| EOD amber beacon & animated taint flow   |
| 03 | 03_row_diff_inspector.png   | Side-by-Side Diff Table               | Granular cell delta & multiset partitions|
| 04 | 04_tri_run_verification.png | Fix Verification Hub (`#verify`)      | Dual-axis verification & VERIFIED_CLEAN  |
| 05 | 05_report_studio_export.png | Report Studio (`#reports`)            | Signed dossier & formula injection shield|
| 06 | 06_csv_ingestion_guard.png  | CSV Ingestion (`#csv`)                | 50MB/500k row validation & schema types  |
+----+-----------------------------+---------------------------------------+------------------------------------------+
```

---

## 3. Detailed Screenshot Specifications

### Screenshot 1: Main Workbench & Demo Sandbox
- **Filename:** `docs/assets/screenshots/01_workbench_demo_hub.png`
- **Route / Tab:** `http://localhost:5173` $\rightarrow$ **Demo Sandbox** tab.
- **Target State:**
  - `SCN-01: Upstream Vendor Input Data Drift` selected on the left panel.
  - Header displays `HEALTH: OK (0.1.0)` with a green indicator.
  - Scenario details card visible with Injected Fault description and Expected EOD (`ingest_orders`).
  - Action buttons **Run Investigation** and **Verify Fix Candidate** prominently visible.
- **What Must Be Visible:** Clean dark background (`zinc-950`), green accent pills, scenario list, 4 scenarios with step counts.
- **What Must NOT Be Visible:** Error banners, disconnected badges, browser bookmarks bar, dev tools console.
- **Portfolio Rationale:** Serves as the hero screenshot on project landing pages, establishing the application's visual polish and developer-centric aesthetic.
- **Placement:** Top of `README.md` and primary portfolio hero image.

---

### Screenshot 2: Interactive Lineage Canvas & EOD Localization
- **Filename:** `docs/assets/screenshots/02_lineage_canvas_eod.png`
- **Route / Tab:** **Investigation & Lineage** tab (`SCN-01` loaded).
- **Steps to Reach State:**
  1. From Demo Sandbox, select `SCN-01`.
  2. Click **Run Investigation**.
  3. Wait for automatic navigation to **Investigation & Lineage**.
  4. Ensure the canvas is centered showing nodes `ingest_orders` $\rightarrow$ `filter_completed` $\rightarrow$ `aggregate_revenue`.
- **Target State:**
  - Node `ingest_orders` displays the amber **EOD Beacon** badge (`PRIMARY EOD`).
  - Dataflow edges leading downstream display animated red taint paths.
  - Top header metrics display: `Blast Radius: 3 Affected Steps`, `1 Terminal Dataset`, `5 Impacted Rows`.
  - The **Accessible Table** toggle button is visible in the top-right of the canvas.
- **What Must NOT Be Visible:** Cluttered canvas nodes outside the scenario, cut-off labels.
- **Portfolio Rationale:** Visually demonstrates the core algorithmic innovation: Kahn topological ordering combined with bidirectional BFS taint propagation to automate root-cause isolation.
- **Placement:** Section "What Makes Data Rewind Different?" in README and architecture case studies.

---

### Screenshot 3: Granular Row-Level Diff & Partition Summary
- **Filename:** `docs/assets/screenshots/03_row_diff_inspector.png`
- **Route / Tab:** **Investigation & Lineage** tab $\rightarrow$ **Diff Table** (`SCN-01` loaded).
- **Steps to Reach State:**
  1. On the Investigation view, click step `ingest_orders` in the step selector.
  2. Scroll down to the **Diff Table**.
  3. Click the **MODIFIED** filter pill to show modified row `order_id = 1`.
- **Target State:**
  - Partition count pills visible: `3 Identical`, `1 Modified`, `1 Added`, `0 Removed`.
  - Diff table shows pinned column `order_id` with value `1`.
  - Cell `amount` highlights the baseline value `100.00` and target mutated value `120.00` with an amber delta badge.
  - Right-hand **Evidence & Root-Cause Panel** shows proven observation and rule `DR-01_UPSTREAM_INPUT_DATA_DRIFT`.
- **What Must NOT Be Visible:** Empty table states, unformatted raw JSON.
- **Portfolio Rationale:** Proves that Data Rewind performs deep, row-level delta inspection rather than superficial table hash checking.
- **Placement:** Feature showcase in README and interactive portfolio demo gallery.

---

### Screenshot 4: Tri-Run Fix Verification Hub
- **Filename:** `docs/assets/screenshots/04_tri_run_verification.png`
- **Route / Tab:** **Fix Verification** tab (`SCN-01` with `Clean Fix` verified).
- **Steps to Reach State:**
  1. From Demo Sandbox, select `SCN-01`.
  2. Set Remediation Mode to `Clean Fix (Restores Baseline Equivalence)`.
  3. Click **Verify Fix Candidate**.
  4. Workbench navigates to **Fix Verification Hub**.
- **Target State:**
  - Large green status badge: **`VERIFIED_CLEAN`**.
  - Subtitle: *"Candidate run R2 successfully resolved the fault while restoring 100% equivalence to baseline R0."*
  - Dual-Axis cards displayed:
    - **Axis 1 (Remediation vs Faulted R1):** Shows fault resolved with checkmarks.
    - **Axis 2 (Baseline Equivalence vs Baseline R0):** Shows 100% multiset hash match.
  - Multi-tier evidence chain listed under the cards.
- **What Must NOT Be Visible:** `REGRESSION_UNRESOLVED` or error banners when capturing the clean fix state.
- **Portfolio Rationale:** Highlights the most distinctive engineering contribution: simultaneous dual-axis evaluation ensuring that a patch fixes a regression without introducing collateral side effects.
- **Placement:** "Key Capabilities" and "Fix Verification" sections.

---

### Screenshot 5: Forensic Report Studio & Export
- **Filename:** `docs/assets/screenshots/05_report_studio_export.png`
- **Route / Tab:** **Report Studio** tab (`SCN-01` dossier loaded).
- **Steps to Reach State:**
  1. From Fix Verification Hub, click **Export Signed Dossier** (or navigate to **Report Studio**).
  2. Select format **Markdown** or **Spreadsheet-Safe CSV**.
  3. Ensure the signed preview card is rendered.
- **Target State:**
  - Header: `Forensic Report Studio (SPEC-MOD-05)`.
  - Export format radio selector showing `Markdown`, `JSON`, and `Spreadsheet-Safe CSV`.
  - Info callout explaining **Type-Aware Formula Injection Protection** (`=`, `+`, `-`, `@`, `\t`, `\r`).
  - Pre-formatted dossier preview showing SHA-256 digests and audit metadata.
- **What Must NOT Be Visible:** Incomplete loading spinners or raw unparsed error traces.
- **Portfolio Rationale:** Demonstrates end-to-end enterprise utility: investigations culminate in actionable, compliance-ready documentation.
- **Placement:** Report generation section in documentation and portfolio case study.

---

### Screenshot 6: CSV Ingestion Guardrails & Developer Mode
- **Filename:** `docs/assets/screenshots/06_csv_ingestion_guard.png`
- **Route / Tab:** **CSV Ingestion** tab (`#csv`).
- **Steps to Reach State:**
  1. Navigate to **CSV Ingestion** tab in main header.
  2. Upload a sample CSV (e.g. `tests/fixtures/sample_orders.csv` or drag and drop).
- **Target State:**
  - Drag-and-drop file upload zone showing 50 MB / 500k row admission limits.
  - Uploaded dataset metadata card showing row count, column count, byte size, and inferred schema data types (`INTEGER`, `VARCHAR`, `DOUBLE`).
  - Ingestion guardrail badges displayed along the top.
- **What Must NOT Be Visible:** Corrupted formatting, unhandled upload exceptions.
- **Portfolio Rationale:** Shows that Data Rewind handles real user-provided datasets with robust input validation.
- **Placement:** Data ingestion and security guardrails sections.

---

## 4. How to Capture These Screenshots

### Option A: Using Browser Developer Tools (Interactive)
1. Start the application:
   ```cmd
   run.bat
   ```
2. Open Chrome or Chromium to `http://localhost:5173`.
3. Press `F12` to open Developer Tools $\rightarrow$ Toggle Device Toolbar (`Ctrl + Shift + M`).
4. Set dimensions to `1920 × 1080` (DPR: `1.0`).
5. Follow the exact steps for each screenshot above.
6. Press `Ctrl + Shift + P` $\rightarrow$ Type `Capture screenshot` $\rightarrow$ Save to `docs/assets/screenshots/<filename>.png`.

### Option B: Automated Headless Capture Script (Playwright)
To capture all 6 screenshots automatically in one command without manual cropping:

Create and run a capture script using the existing Playwright test harness:
```powershell
# From repository root:
.\.venv\Scripts\python.exe -c "
import subprocess
print('Run npm.cmd --prefix frontend run test:e2e to generate full test artifacts.')
"
```
Or execute Playwright with screenshot retention enabled:
```powershell
cd frontend
npm.cmd run test:e2e
```
Captured failure and journey screenshots are saved to `frontend/test-results/`.
