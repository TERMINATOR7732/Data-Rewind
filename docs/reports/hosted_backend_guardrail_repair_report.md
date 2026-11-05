# Data Rewind — Hosted Backend Guardrail & UX Repair Report

**Project:** Data Rewind  
**Repository:** `TERMINATOR7732/Data-Rewind`  
**Branch:** `main`  
**Current HEAD:** `a5c6e05a3fa20d0a3e132bb1a3fa0e8c13eee9dc`  
**Production URL:** `https://data-rewind.vercel.app`  
**Operating Budget:** Strict ₹0 (Free-tier Vercel + In-Browser DuckDB-Wasm Engine + Local Loopback)  
**Date of Repair:** November 4, 2026  

---

## 1. Executive Summary

A targeted UX guardrail and execution repair was successfully implemented across **Data Rewind's** Developer Mode and CSV Investigation interfaces. 

On hosted deployments, users can no longer inadvertently trigger unsupported Python Backend operations (`POST /api/v1/pipelines/execute` or `POST /api/v1/datasets/upload`) that resulted in raw HTTP 403 `FEATURE_RESTRICTED_IN_DEMO` error messages. The UI now proactively marks the Python Backend engine as `Local Only`, disallows restricted execution before any network requests are dispatched, and renders clear, accessible guidance with an inline one-click action to switch to the fully supported, privacy-preserving `Browser (Recommended)` engine.

All local Python development workflows, CLI tools, and dual-engine conformance testing remain 100% operational. All quality gates passed with zero regressions:
- **TypeScript & Production Bundle:** Built successfully in 5.21s with 0 errors.
- **Frontend Vitest Suite:** 32 test files, 238 passed (100% passing; +7 new tests).
- **Playwright E2E Suite:** 35 passed (100% passing; +1 new E2E test).
- **Python Pytest Suite:** 260 passed (100% passing).

---

## 2. Root Cause Addressed

The hosted Vercel backend intentionally restricts `POST /api/v1/datasets/upload` and `POST /api/v1/pipelines/execute` with HTTP 403 `FEATURE_RESTRICTED_IN_DEMO` to uphold data isolation and a strict ₹0 operating budget on ephemeral serverless instances. 

However, in `DeveloperMode.tsx`, the execution handler `handleExecute` lacked an early client-side guard for hosted environments. When users selected `Python Backend` on the hosted site, clicking `Execute Pipeline` dispatched a network request to `/api/v1/pipelines/execute`, triggering an HTTP 403 rejection and displaying an unhelpful raw API error alert. Additionally, the engine selector lacked visual indication that the Python Backend engine is designated for local development only.

---

## 3. Files Changed and Reasons

| File Path | Nature of Changes & Justification |
| :--- | :--- |
| `frontend/src/features/developer/DeveloperMode.tsx` | 1. Added pre-request guard in `handleExecute` to immediately block unsupported execution when `isHostedEnvironment && engineMode === "backend"`.<br>2. Added defensive guard in `else` block before calling `api.executePipeline`.<br>3. Badged `Python Backend` with a visible `Local Only` tag on hosted environments.<br>4. Updated policy notice banner with exact specified user guidance.<br>5. Styled `Execute Pipeline` button as visibly disabled (`disabled:cursor-not-allowed opacity-60`) with `aria-disabled="true"` and explanatory `title`.<br>6. Added inline `"Switch to Browser (Recommended)"` button right next to the execute button and inside the error banner for immediate one-click remediation. |
| `frontend/src/features/csv/CSVInvestigation.tsx` | 1. Added `Local Only` badge to `Python Backend` button in hosted environments.<br>2. Harmonized the warning banner and upload error notice with the exact user guidance text. |
| `frontend/src/__tests__/DeveloperModeHostedGuard.test.tsx` | Added 7 comprehensive unit/component tests verifying hosted guardrails, "Local Only" badging, prevention of `api.executePipeline` calls, inline switch functionality, and uninhibited local execution. |
| `frontend/src/__tests__/hosted-csv-experience.test.ts` | Synchronized copy test assertions with the unified guidance string and verified absence of technical jargon. |
| `frontend/e2e/browser-pipeline-execution.spec.ts` | Added Playwright E2E test intercepting hosted demo environment, asserting `Local Only` badge visibility, verifying Execute button disabled state, asserting zero network requests to `/api/v1/pipelines/execute`, and verifying inline switch back to Browser mode. |
| `README.md` | Updated Section *"Hosted Demonstration & Local Development Architecture"* to accurately document browser-first DuckDB-Wasm processing on Vercel vs full Python FastAPI workflows in local development. |

---

## 4. Hosted vs Local Behavior Comparison

### 4.1 Hosted Deployment Behavior (`isHostedDemo = true` / `*.vercel.app`)

| UX Element | Before Repair | After Repair |
| :--- | :--- | :--- |
| **Engine Selector** | Labeled `Python Backend` without contextual indication. | Labeled `Python Backend` with an amber `Local Only` badge. |
| **Selecting Python Backend** | Displayed generic notice; did not clearly explain storage/privacy reasoning. | Displays exact professional guidance explaining browser privacy and zero server storage costs with inline switch link. |
| **Execute Pipeline Button** | Visually enabled or ambiguous; allowed clicking. | Visually darkened, disabled, `aria-disabled="true"`, `cursor-not-allowed` with tooltip. |
| **Execution Attempt** | Dispatched `POST /api/v1/pipelines/execute` $\to$ returned HTTP 403 `FEATURE_RESTRICTED_IN_DEMO`. | **Zero network requests issued.** Pre-request check halts immediately and displays inline guidance. |
| **Recovery Path** | User had to manually find and re-click engine switcher. | One-click `"Switch to Browser (Recommended)"` button available in notice banner, beside execute button, and in error alert. |

### 4.2 Local Development Behavior (`isHostedDemo = false` / `localhost` / `127.0.0.1`)

| UX Element | Behavior | Status |
| :--- | :--- | :--- |
| **Engine Selector** | Displays clean `Browser (Recommended)` and `Python Backend` buttons without `Local Only` badge. | **PRESERVED** |
| **Python Backend Selection** | Seamlessly switches to Python backend without displaying hosted restriction banners. | **PRESERVED** |
| **Execution via Python** | Dispatches `POST /api/v1/pipelines/execute` to local FastAPI on `127.0.0.1:8000`, materializing Parquet checkpoints. | **PRESERVED** |
| **Browser Engine Execution** | Executes arbitrary DAGs in browser DuckDB-Wasm worker with full topological staging. | **PRESERVED** |

---

## 5. API Request Verification

Network traffic verification conducted across Vitest component mocks and Playwright route interception confirms:

1. **`POST /api/v1/datasets/upload`:** Exactly **0 calls** issued in hosted mode.
2. **`POST /api/v1/pipelines/execute`:** Exactly **0 calls** issued in hosted mode.
3. **Unrelated Supported Endpoints:** Health checks (`/api/v1/health`), scenario discovery (`/api/v1/scenarios`), scenario investigations (`/api/v1/scenarios/*/run`), scenario verifications (`/api/v1/scenarios/*/verify`), pipeline topology validation (`/api/v1/pipelines/validate`), and workspace telemetry (`/api/v1/workspaces`) remain fully accessible and functional.

---

## 6. Test Commands & Exact Execution Results

### 6.1 TypeScript Typecheck & Production Build
```cmd
npm.cmd --prefix frontend run build
```
- **Exit Code:** `0`
- **Output:**
  ```text
  > tsc -b && vite build
  vite v6.4.5 building for production...
  ✓ 1812 modules transformed.
  rendering chunks...
  computing gzip size...
  dist/index.html                          0.97 kB │ gzip:   0.54 kB
  dist/assets/duckdb.worker-DeVADl4D.js  241.11 kB
  dist/assets/index-BeuHxQYw.css          51.00 kB │ gzip:   9.25 kB
  dist/assets/vendor-BUCenJ1a.js          29.38 kB │ gzip:   7.27 kB
  dist/assets/xyflow-D_VivfV5.js         322.09 kB │ gzip: 104.20 kB
  dist/assets/index-C1d7vDWN.js          337.13 kB │ gzip:  84.80 kB
  ✓ built in 5.21s
  ```

### 6.2 Frontend Vitest Suite
```cmd
npm.cmd --prefix frontend test
```
- **Exit Code:** `0`
- **Test Files:** **32 passed (32)**
- **Tests:** **238 passed (238)** *(Baseline: 231 passed + 7 new tests in `DeveloperModeHostedGuard.test.tsx`)*
- **Duration:** 17.14s

### 6.3 Playwright E2E Suite
```cmd
npm.cmd --prefix frontend run test:e2e
```
- **Exit Code:** `0`
- **Tests:** **35 passed (35)** *(Baseline: 34 passed + 1 new test in `browser-pipeline-execution.spec.ts`)*
- **Duration:** 2.1m

### 6.4 Python Pytest Suite
```cmd
.\.venv\Scripts\python.exe -m pytest tests/ -v
```
- **Exit Code:** `0`
- **Tests:** **260 passed (260)** *(Baseline: 260 passed)*
- **Duration:** 16.92s

---

## 7. Remaining Architectural Boundaries

1. **Serverless Ephemeral Storage:** The Vercel deployment intentionally enforces `hosted_demo` profile. Custom CSV ingestion and ad-hoc DAG execution remain restricted on the public Python serverless backend by design to maintain ₹0 cloud costs.
2. **Local Workflows:** Users wanting unrestricted 50 MB / 500k-row CSV ingestion with local Parquet checkpoints and SQLite catalogs run the local engine via `python -m data_rewind.cli serve`.

---

## 8. Git Safety Record

- **Current Branch:** `main`
- **Current HEAD:** `a5c6e05a3fa20d0a3e132bb1a3fa0e8c13eee9dc`
- **Git Commit Action:** **NONE (Strictly uncommitted and unpushed as instructed).**
- **Git Status:**
  ```text
  On branch main
  Your branch is up to date with 'origin/main'.

  Changes not staged for commit:
    modified:   README.md
    modified:   benchmarks/output/benchmark_report.json
    modified:   benchmarks/output/benchmark_report.md
    modified:   frontend/e2e/browser-pipeline-execution.spec.ts
    modified:   frontend/src/__tests__/hosted-csv-experience.test.ts
    modified:   frontend/src/features/csv/CSVInvestigation.tsx
    modified:   frontend/src/features/developer/DeveloperMode.tsx

  Untracked files:
    docs/reports/backend_failure_investigation.md
    docs/reports/final_commit_and_push_report.md
    docs/reports/hosted_backend_guardrail_repair_report.md
    frontend/src/__tests__/DeveloperModeHostedGuard.test.tsx
  ```
