# Data Rewind — UI/UX Design & Screen Inventory

**Document Version:** 1.2.0-FINAL-CLOSURE  
**Milestone:** 0.3 (Final Specification Closure & Implementation-Readiness Audit)  
**Status:** Complete Specification / Ready for Owner Review & Explicit Approval  
**Module Identifier:** `SPEC-MOD-08`

---

## 1. Design Philosophy & Engineering Rationale

Data Rewind is designed as an **engineering-grade forensic workbench** created for data professionals. It strictly rejects consumer AI landing-page tropes:
- **No excessive neon glowing borders or glassmorphism.**
- **No decorative floating cards, animated blobs, or marketing carousels.**
- **No emoji used as substitutes for an intentional icon system** (use Lucide SVG icons).
- **No fake terminal simulators, fabricated metrics, or placeholder dummy buttons.**
- **High data density with generous padding, strict hierarchy, and instant clarity.**

### 1.1 Rationale for Visual & Architectural Choices
- **Dark Neutral Palette (Zinc / Slate):** Long investigative sessions require minimal eye strain. High-contrast neutral surfaces allow unambiguous semantic color alerts (Rose for errors, Amber for divergence, Emerald for verified clean) to stand out immediately.
- **Offline System Typography:** Relying on system-native font stacks eliminates external network font loading (supporting ₹0 budget and offline operation), guarantees zero layout shifts, and ensures rapid rendering.
- **Tabular Numerals (`font-variant-numeric: tabular-nums`):** Applied across all row counts, financial amounts, durations, and timestamps to ensure decimal points and digits align vertically, enabling instant visual comparison.
- **Purposeful Motion:** Motion is restricted to functional transitions: expanding diff drawers, layout recalculation in the DAG canvas, and gentle pulsing on active or divergent nodes. Decorative or looping ambient animations are prohibited.

---

## 2. Typography & Semantic Color Tokens

### 2.1 Restrained Typography System
- **Primary Interface Font:** System UI Stack (`system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`) with fallback to Inter. Highly legible at 11px–14px data grid sizes.
- **Monospaced Technical Font:** JetBrains Mono / SFMono-Regular / Menlo / Consolas / monospace. Used strictly for:
  - SHA-256 hashes and UUIDs.
  - Dataset row counts and byte sizes.
  - SQL / AST transformation expressions.
  - Schema column identifiers.
- **Tabular Numerals:** All numerical values, metrics, row counts, and timestamps strictly utilize `font-variant-numeric: tabular-nums` to ensure stable vertical alignment in diff columns.

### 2.2 Semantic Color Tokens

```
+----------------------------------------------------------------------------------------------------+
|                                    SEMANTIC COLOR ROLES (DARK / LIGHT)                             |
+----------------------------------------------------------------------------------------------------+
|  Role             | Dark Token (Default)   | Light Token          | Semantic Meaning               |
| :---              | :---                   | :---                 | :---                           |
| **Background**    | `bg-zinc-950` (#09090b)| `bg-zinc-50` (#fafafa) | Application background         |
| **Surface**       | `bg-zinc-900` (#18181b)| `bg-white` (#ffffff) | Card / Panel background        |
| **Border**        | `border-zinc-800`      | `border-zinc-200`    | Structural dividers            |
| **Text Primary**  | `text-zinc-100`        | `text-zinc-900`      | High-contrast titles & values  |
| **Text Secondary**| `text-zinc-400`        | `text-zinc-500`      | Labels, timestamps, metadata   |
| **Success / Safe**| `emerald-400` / `950`  | `emerald-600` / `50` | Baseline, Identical, Verified  |
| **Divergence/Warn**| `amber-400` / `950`   | `amber-600` / `50`   | Earliest Divergence, Warning   |
| **Error / Fault** | `rose-400` / `950`     | `rose-600` / `50`    | Failed Step, Row Deletion      |
| **Info / Running**| `sky-400` / `950`      | `sky-600` / `50`     | Running Execution, Active Node |
+----------------------------------------------------------------------------------------------------+
```

---

## 3. Comprehensive Screen Inventory (12 Screens with 5 States)

```
                      [ Screen 1: Workspace Hub ]
                                  │
           ┌──────────────────────┼──────────────────────┐
           ▼                      ▼                      ▼
  [ Screen 2: Demo Hub ]  [ Screen 3: CSV Upload ] [ Screen 4: DAG Builder ]
           │                      │                      │
           └──────────────────────┼──────────────────────┘
                                  ▼
                     [ Screen 5: Run Console ]
                                  │
                                  ▼
                   [ Screen 6: Investigation Canvas ]
                    (Interactive DAG Lineage)
                                  │
           ┌──────────────────────┼──────────────────────┐
           ▼                      ▼                      ▼
  [ Screen 7: Row Diff ]  [ Screen 8: Evidence ] [ Screen 9: Impact Blast ]
           │                      │                      │
           └──────────────────────┼──────────────────────┘
                                  ▼
                   [ Screen 10: Fix Verification Hub ]
                                  │
                                  ▼
                   [ Screen 11: Report Export Studio ]
```

---

### Screen 1: Workspace & Scenario Entry (`/`)
- **Purpose:** Central hub for selecting operating mode (Demo, CSV Upload, Developer Mode).
- **Primary Action:** Choose a mode or load a recent local workspace.
- **Important Info:** Current workspace directory, storage usage (MB), recent runs list.
- **Empty State:** Clean introduction explaining the 3 modes with direct 1-click launch buttons.
- **Loading State:** Skeleton cards indicating local workspace discovery.
- **Error State:** Warning if local storage directory is unwritable.
- **Recovery Path:** Button to reconfigure local storage path or reset permissions.

---

### Screen 2: Demo Mode Walkthrough (`/demo`)
- **Purpose:** Guided sandbox for reviewers to explore pre-loaded regression scenarios (`SCN-01` to `SCN-04`).
- **Primary Action:** Select a scenario and click **"Run Investigation"**.
- **Important Info:** Scenario business context, injected fault description, and anticipated blast radius.
- **Empty State:** Not applicable (pre-loaded with realistic synthetic fixtures).
- **Loading State:** Step-by-step pipeline execution spinner with animated DAG node states.
- **Error State:** Clear error banner if synthetic fixture file is missing from bundle.
- **Recovery Path:** "Restore Pristine Demo Fixtures" button.

---

### Screen 3: CSV Ingestion & Schema Inspector (`/csv/upload`)
- **Purpose:** Upload raw CSV files, validate RFC 4180 compliance, and inspect inferred column schemas.
- **Primary Action:** Drag and drop CSV file or click "Select CSV".
- **Important Info:** File name, byte size, row count, detected delimiter, encoding, and inferred column types.
- **Empty State:** Bordered drop-zone with file size limit badges (50 MB limit).
- **Loading State:** Progress bar showing file upload, encoding check, and DuckDB schema inference.
- **Error State:** Descriptive validation card (e.g., `CELL_LENGTH_LIMIT_EXCEEDED` on line 412).
- **Recovery Path:** File replacement button with instructions on resolving delimiter/encoding issues.

---

### Screen 4: Visual Pipeline DAG Builder (`/pipeline/build`)
- **Purpose:** Visually construct or edit transformation steps connecting inputs to output marts.
- **Primary Action:** Add Transformation Step (`+ Step`) or connect edges.
- **Important Info:** List of steps, parameter configuration form for active step, validation status (e.g. "Missing required join key").
- **Empty State:** Canvas showing available input datasets and a prompt: *"Add your first transformation step"*.
- **Loading State:** Graph layout calculation spinner.
- **Error State:** Inline red validation badge on nodes with dangling references or cyclic edges.
- **Recovery Path:** Highlight offending edge with "Remove Cyclic Edge" action.

---

### Screen 5: Execution Console & Run Status (`/runs/:id`)
- **Purpose:** Live monitoring of pipeline execution across all DAG nodes.
- **Primary Action:** "Pause / Abort Run" or "View Completed Investigation".
- **Important Info:** Run ID, execution elapsed time, peak RAM usage, status badge per step (`PENDING`, `RUNNING`, `SUCCESS`, `FAILED`).
- **Empty State:** Display run parameters and pending queue status.
- **Loading State:** Active step pulsing with blue border; live duration counter.
- **Error State:** Failed step highlighted in rose with expand-collapse exception trace.
- **Recovery Path:** "Restart Run from Failed Step" or "Edit Step Parameters".

---

### Screen 6: Lineage & Divergence Investigation Canvas (`/investigate/:comparison_id`)
- **Purpose:** The core forensic screen. Displays interactive DAG showing exactly where Run $R_1$ diverged from $R_0$.
- **Primary Action:** Click on the **Earliest Observable Divergence (EOD)** node or tainted downstream nodes.
- **Important Info:** EOD beacon node (pulsing amber ring), divergence category badge, count of affected rows.
- **Empty State:** Message: *"Both runs produced 100% identical outputs across all nodes. Zero divergence detected."*
- **Loading State:** DAG layout initialization skeleton.
- **Error State:** Alert if artifact checkpoints for comparison run have been deleted.
- **Recovery Path:** "Re-execute Missing Pipeline Run" button.

---

### Screen 7: Side-by-Side Row & Value Diff Viewer (`/investigate/:comparison_id/diff/:step_id`)
- **Purpose:** Deep row-level inspection of data deltas at any selected node.
- **Primary Action:** Filter by diff status: `ALL` | `MODIFIED` | `ADDED` | `REMOVED` | `IDENTICAL`.
- **Important Info:** Primary key column (pinned left), old vs. new values for modified cells with yellow highlight.
- **Empty State:** "No rows match current filter."
- **Loading State:** Virtualized table row shimmer.
- **Error State:** "Dataset lacks primary key and exceeds 500k row multiset memory limit."
- **Recovery Path:** "Select Composite Key Columns" modal to enable keyed diffing.

---

### Screen 8: Evidence & Root-Cause Drawer (Slide-Over Panel)
- **Purpose:** Detailed diagnostic panel explaining *why* the data diverged.
- **Primary Action:** "Apply Recommended Fix" or "Export Evidence Slice".
- **Important Info:**
  - **Proven Observations:** Exact observed metrics (e.g., "1,842 rows had net_amount drift averaging -$18.40").
  - **Causal Hypothesis:** Parameter/code diff that triggered the drift.
  - **Evidence Tier:** `PROVEN_OBSERVATION`, `CAUSAL_HYPOTHESIS_DIRECT_CODE_DIFF`, etc.
- **Empty State:** "Select a node on the canvas to inspect evidence."
- **Loading State:** Diagnostic rule evaluation spinner.
- **Error State:** "Diagnostic rule engine encountered indeterminate multi-cause drift."
- **Recovery Path:** Guidance to isolate individual variable changes.

---

### Screen 9: Downstream Blast Radius & Taint Inspector
- **Purpose:** Visual and tabular breakdown of all downstream tables, marts, and reports contaminated by the EOD fault.
- **Primary Action:** "Download Taint Manifest" or "Flag Downstream Consumers".
- **Important Info:** List of affected downstream nodes, confirmed value divergence vs topological-only taint.
- **Empty State:** "The selected step has no downstream consumers."
- **Loading State:** BFS graph traversal indicator.
- **Error State:** "Cycle detected in downstream path."
- **Recovery Path:** Graph validation fixer tool.

---

### Screen 10: Tri-Run Fix Verification Hub (`/verify/:id`)
- **Purpose:** Evaluates the candidate fix run ($R_2$) against both baseline ($R_0$) and faulted run ($R_1$).
- **Primary Action:** "Approve Fix for Deployment" or "Refine Patch".
- **Important Info:** Dual-axis verification card (`VERIFIED_CLEAN` badge), baseline equivalence score (100%), secondary regression count (0).
- **Empty State:** "Submit a candidate pipeline patch to execute fix verification."
- **Loading State:** Tri-run execution and multi-way diff calculation indicator.
- **Error State:** `NEW_FAULT_INTRODUCED` alert with highlighted secondary divergence node.
- **Recovery Path:** "Inspect Secondary Regression" button navigating to offending node.

---

### Screen 11: Forensic Report & Export Studio (`/reports/:id`)
- **Purpose:** Configure and download executive and engineering investigation reports.
- **Primary Action:** "Download Signed Dossier (JSON / Markdown / Raw CSV / Safe CSV)".
- **Important Info:** Complete dossier preview, SHA-256 integrity signatures, formula-injection sanitization confirmation.
- **Empty State:** "Investigation in progress; report generated upon completion."
- **Loading State:** Document rendering spinner.
- **Error State:** "Disk error writing export file."
- **Recovery Path:** "Save to Alternate Directory" dialog.

---

### Screen 12: Workspace Settings & Data Purge (`/settings`)
- **Purpose:** Manage local workstation storage, retention policies, and data privacy.
- **Primary Action:** "Delete All Workspace Data" (Application-Managed Purge).
- **Important Info:** Total artifact cache size, SQLite catalog size, active workspaces list.
- **Empty State:** Not applicable.
- **Loading State:** Deletion in progress indicator.
- **Error State:** "Failed to delete locked file (in use by another process)."
- **Recovery Path:** Instructions to close background instances and retry.
