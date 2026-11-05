# Data Rewind — Backend Failure Investigation Report (READ-ONLY)

**Product:** Data Rewind  
**Repository:** `TERMINATOR7732/Data-Rewind`  
**Expected Branch:** `main`  
**Latest Committed HEAD:** `a5c6e05a3fa20d0a3e132bb1a3fa0e8c13eee9dc`  
**Production URL:** `https://data-rewind.vercel.app`  
**Investigation Mode:** Strict READ-ONLY (Zero Code / Zero Config / Zero Dependency / Zero State Mutations)  
**Operating Budget:** Strict ₹0 (Free-tier Vercel + Pure Browser DuckDB-Wasm Engine + Local Loopback)  
**Date of Audit:** November 4, 2026  

---

## 1. Executive Verdict

$$\mathbf{EXECUTIVE\;VERDICT:}\quad \mathbf{PARTIAL\;/\;WORKING\;AS\;DESIGNED\;WITH\;UX\;GUARDRAIL\;AMBIGUITY}$$

The reported "backend failure" in Data Rewind is **not a code defect, crash, dependency breakage, or runtime exception**. Both the local FastAPI engine and the hosted Vercel serverless deployment are **100% operational and healthy**, passing **all 491 automated tests** (260 Python backend tests, 231 frontend Vitest tests).

The failure is an **architectural mismatch and user-experience friction point**:
1. In the **hosted production deployment** (`https://data-rewind.vercel.app`), the serverless backend explicitly executes under the `hosted_demo` profile.
2. In the `hosted_demo` profile, custom CSV uploads (`POST /api/v1/datasets/upload`) and ad-hoc pipeline execution (`POST /api/v1/pipelines/execute`) deliberately return **HTTP 403 Forbidden** (`FEATURE_RESTRICTED_IN_DEMO`). This was architected as an intentional security, privacy, and cost guardrail to prevent unauthenticated data storage on ephemeral serverless instances and uphold the strict ₹0 operating budget.
3. The production frontend was designed to be **100% browser-first** using DuckDB-Wasm running in client Web Workers. All CSV ingestion, schema inference, SQL queries, multiset hashing, and forensic diffs work offline in the browser without sending a single byte of data to any server.
4. When users or automated integration tests attempt to invoke the backend API directly or switch the execution engine to `"Python Backend"` on the hosted site, they encounter the `FEATURE_RESTRICTED_IN_DEMO` 403 response. While `CSVInvestigation.tsx` warns users and blocks network uploads on hosted instances, `DeveloperMode.tsx` still permits clicking `"Execute Pipeline"` in `"Python Backend"` mode, causing a raw `FEATURE_RESTRICTED_IN_DEMO` alert to surface.

---

## 2. Exact Reproduced Failure

### 2.1 Endpoint 1: Custom Dataset Upload on Hosted Serverless API
- **Endpoint:** `POST https://data-rewind.vercel.app/api/v1/datasets/upload`
- **Request Headers:** `Content-Type: multipart/form-data`, file payload `test_orders.csv`
- **HTTP Status:** `403 Forbidden`
- **Exact Response Body:**
  ```json
  {
    "error": {
      "code": "FEATURE_RESTRICTED_IN_DEMO",
      "message": "Custom CSV upload is disabled in the hosted portfolio demonstration to prevent unauthenticated data storage and maintain a zero operating cost. Please explore the preloaded scenarios in Demo Sandbox or clone the repository to run the local-first engine with full CSV upload support.",
      "details": {},
      "remediation": "Select one of the 4 demonstration scenarios from Demo Sandbox, or run Data Rewind locally.",
      "timestamp": "2026-11-03T18:59:17.382098+00:00"
    }
  }
  ```

### 2.2 Endpoint 2: Ad-Hoc Pipeline Execution on Hosted Serverless API
- **Endpoint:** `POST https://data-rewind.vercel.app/api/v1/pipelines/execute`
- **Request Headers:** `Content-Type: application/json`
- **Payload:** `{"steps": [{"step_id": "step_1", "operation_type": "filter_rows", "parameters": {"predicate": "amount > 100"}, "input_step_ids": ["source_table"]}], "inputs": {"source_table": [{"amount": 150}]}}`
- **HTTP Status:** `403 Forbidden`
- **Exact Response Body:**
  ```json
  {
    "error": {
      "code": "FEATURE_RESTRICTED_IN_DEMO",
      "message": "Ad-hoc pipeline execution is restricted in the hosted portfolio demonstration. Use the Demo Sandbox to test full forensic investigations on synthetic datasets, or run Data Rewind locally for full Developer Mode pipeline execution.",
      "details": {},
      "remediation": "Select one of the 4 demonstration scenarios from Demo Sandbox, or run Data Rewind locally.",
      "timestamp": "2026-11-03T19:10:49.104623+00:00"
    }
  }
  ```

### 2.3 Environmental Comparison Table

| Operational Flow | Local Backend (`profile: local`) | Hosted Production (`profile: hosted_demo`) | Notes / Status |
| :--- | :--- | :--- | :--- |
| `GET /api` | `200 OK` | `200 OK` | Root metadata operational |
| `GET /api/v1/health` | `200 OK` | `200 OK` | Reports memory, disk, limits |
| `GET /api/docs` | `200 OK` | `200 OK` | Swagger UI rendered |
| `GET /api/v1/scenarios` | `200 OK` | `200 OK` | Returns 4 scenarios |
| `POST /api/v1/scenarios/scn01/run` | `200 OK` | `200 OK` | Full forensic investigation returned |
| `POST /api/v1/scenarios/scn01/verify` | `200 OK` | `200 OK` | Tri-run verification returned |
| `POST /api/v1/pipelines/validate` | `200 OK` | `200 OK` | DAG topology & AST validated |
| `POST /api/v1/datasets/upload` | **`200 OK`** | **`403 Forbidden`** | Restricted in hosted demo |
| `POST /api/v1/pipelines/execute` | **`200 OK`** | **`403 Forbidden`** | Restricted in hosted demo |
| `GET /api/v1/workspaces` | `200 OK` | `200 OK` | Storage telemetry reported |
| `DELETE /api/v1/workspaces/purge` | `200 OK` | `200 OK` | Workspace cleanup executed |

---

## 3. Root Cause with File Paths & Code References

The root cause is an intentional design boundary in the backend routing logic that guards against persistent state on Vercel's ephemeral serverless architecture:

### 3.1 Serverless Profile Configuration
- **File:** `api/index.py` (lines 30-36)
  ```python
  os.environ.setdefault("DATA_REWIND_PROFILE", "hosted_demo")
  if sys.platform != "win32":
      os.environ.setdefault("DATA_REWIND_DATA_DIR", "/tmp/data_rewind")
  ```
  Vercel serverless invocations force the active profile to `hosted_demo`.

### 3.2 Dataset Upload Restriction Guard
- **File:** `src/data_rewind/api/routers/datasets.py` (lines 42-56)
  ```python
  settings = APIDependencies.get_settings()
  if settings.profile == "hosted_demo":
      raise HTTPException(
          status_code=403,
          detail={
              "code": "FEATURE_RESTRICTED_IN_DEMO",
              "message": (
                  "Custom CSV upload is disabled in the hosted portfolio demonstration to prevent "
                  "unauthenticated data storage and maintain a zero operating cost. Please explore the "
                  "preloaded scenarios in Demo Sandbox or clone the repository to run the local-first "
                  "engine with full CSV upload support."
              ),
              "remediation": "Select one of the 4 demonstration scenarios from Demo Sandbox, or run Data Rewind locally.",
          },
      )
  ```

### 3.3 Ad-Hoc Pipeline Execution Guard
- **File:** `src/data_rewind/api/routers/pipelines.py` (lines 79-92)
  ```python
  settings = APIDependencies.get_settings()
  if settings.profile == "hosted_demo":
      raise HTTPException(
          status_code=403,
          detail={
              "code": "FEATURE_RESTRICTED_IN_DEMO",
              "message": (
                  "Ad-hoc pipeline execution is restricted in the hosted portfolio demonstration. "
                  "Use the Demo Sandbox to test full forensic investigations on synthetic datasets, "
                  "or run Data Rewind locally for full Developer Mode pipeline execution."
              ),
              "remediation": "Select one of the 4 demonstration scenarios from Demo Sandbox, or run Data Rewind locally.",
          },
      )
  ```

### 3.4 Developer Mode Unhandled Execution Call
- **File:** `frontend/src/features/developer/DeveloperMode.tsx` (lines 302-308)
  ```typescript
  } else {
    const res = await api.executePipeline(parsedSteps as TransformationStep[], parsedInputs);
    setExecutionResult(res);
  }
  ```
  Unlike `CSVInvestigation.tsx` (which checks `if (isHostedEnvironment)` before calling `api.uploadDataset` and sets a user-friendly guidance notice), `DeveloperMode.tsx` attempts `api.executePipeline(...)` even when `isHostedEnvironment` is `true`. The serverless backend rejects the request with HTTP 403, and the raw error string is displayed in the UI:
  `FEATURE_RESTRICTED_IN_DEMO: Ad-hoc pipeline execution is restricted in the hosted portfolio demonstration...`

---

## 4. Local Backend Health Assessment

The local backend is completely healthy, rock-solid, and 100% compliant with specifications:

1. **Test Execution:**
   - Command: `.\.venv\Scripts\python.exe -m pytest tests/ -v`
   - Outcome: **260 passed, 0 failed, 1 warning (deprecation) in 22.58s**.
2. **Local Diagnostics:**
   - Command: `.\.venv\Scripts\python.exe -m data_rewind.cli diagnostics`
   - Engine Version: `0.1.0`
   - Active Profile: `local`
   - Python Runtime: `3.12.0 (win32)`
   - DuckDB Version: `2.0.0`
   - Base Workspace Root: `C:\Users\Admin\.data_rewind`
   - Disk Admission Gate: `PASS (> 100 MB free)`
   - Process RSS Ceiling: `512 MiB`
   - DuckDB Query Memory: `256 MiB`
   - Max CSV Upload Limit: `50 MB`
   - Max Dataset Rows: `500,000 rows`
   - Max Dataset Columns: `100 columns`
3. **Application Entry Point & Router Registration:**
   - Entry point: `src/data_rewind/api/main.py:create_app()`
   - All 8 routers properly registered under `/api/v1`: `health`, `scenarios`, `datasets`, `pipelines`, `comparisons`, `verifications`, `reports`, `workspaces`.
4. **CORS Configuration:**
   - Binds to loopback (`127.0.0.1`, `localhost`) ports 5173, 3000, 8000.
   - Regex allows `^https?://(localhost|127\.0\.0\.1)(:[0-9]+)?$|^https://.*\.vercel\.app$`.
5. **Database & Storage Paths:**
   - SQLite repositories (`investigations.db`, `verifications.db`) initialize dynamically in `APIDependencies.get_workspace_dir()`.
   - CSV raw preservation writes to `raw_inputs/{sha256}.csv` with read-only file mode flags (`stat.S_IREAD`).

---

## 5. Production / Vercel Integration Assessment

1. **`vercel.json` Configuration:**
   - Conforms to standard Vercel serverless specification:
     ```json
     {
       "framework": "vite",
       "buildCommand": "npm --prefix frontend install && npm --prefix frontend run build",
       "outputDirectory": "frontend/dist",
       "functions": {
         "api/index.py": {
           "includeFiles": "src/**",
           "maxDuration": 60
         }
       },
       "rewrites": [
         {"source": "/api", "destination": "/api/index.py"},
         {"source": "/api/(.*)", "destination": "/api/index.py"},
         {"source": "/((?!api/).*)", "destination": "/index.html"}
       ]
     }
     ```
2. **Serverless Execution Constraints:**
   - Vercel functions execute in AWS Lambda containers with read-only filesystems except for `/tmp`.
   - Invocations are stateless and cold-started dynamically; instances shut down after inactivity.
   - Files stored in `/tmp` are ephemeral and not shared across concurrent Lambda instances.
   - Disabling unauthenticated disk writes and multi-step pipeline persistence on Vercel is the correct production engineering decision to prevent resource exhaustion, state divergence across Lambda containers, and billing risks.
3. **Frontend API URL Handling:**
   - `frontend/src/lib/api.ts` defines:
     ```typescript
     const rawApiBase = import.meta.env.VITE_API_URL || "/api/v1";
     ```
   - On the hosted site, requests resolve to `https://data-rewind.vercel.app/api/v1/*`, routing cleanly through the Vercel rewrite to `api/index.py`. Zero `localhost` or broken hardcoded URLs exist in production assets.

---

## 6. Browser Runtime Independence Assessment

Data Rewind’s primary operating model is **browser-first**. Hosted CSV analysis does not require FastAPI:

1. **Frontend Automated Test Results:**
   - Command: `npm --prefix frontend test`
   - Outcome: **31 test files passed, 231 tests passed (100%) in 28.96s**.
2. **DuckDB-Wasm In-Browser Engine:**
   - Handled via `frontend/src/runtime/browser-runtime.ts` and `duckdb.worker.ts`.
   - Uses WebAssembly and virtual memory to ingest CSV files, run analytical queries, execute DAG transformations, and compute multiset hashes.
3. **Client-Side Storage:**
   - Datasets, schemas, RunManifests, investigations, and dossiers are persisted in browser IndexedDB (`frontend/src/runtime/storage/indexeddb.ts`) and OPFS (`frontend/src/runtime/storage/opfs.ts`).
4. **Network Privacy:**
   - When users upload CSVs in `Browser (Recommended)` mode, exactly **0 CSV data bytes** leave the user's browser.
   - The entire forensic investigation pipeline runs locally on client hardware, achieving true zero-cost infrastructure and maximum data security.

---

## 7. Python / Browser Conformance Results

The Python reference engine and TypeScript browser runtime have been audited for behavioral consistency:

| Conformance Aspect | Python Engine (`src/data_rewind/`) | Browser Runtime (`frontend/src/runtime/`) | Conformance Status |
| :--- | :--- | :--- | :--- |
| **Execution Contract Version** | `1.0.0` | `1.0.0` | **MATCH (100%)** |
| **Atomic Transformations** | 10 canonical operations | 10 canonical operations + aliases | **MATCH (100%)** |
| **Multi-Set Hashing** | Commutative SHA-256 sum | Commutative BigInt SHA-256 sum | **MATCH (100%)** |
| **Canonical Normalizer $S(v)$** | Float fixed 6 decimals, null `\x00` | Float fixed 6 decimals, null `\x00` | **MATCH (100%)** |
| **Canonical Demo Scenarios** | SCN-01 to SCN-04 identical inputs | SCN-01 to SCN-04 identical inputs | **MATCH (100%)** |
| **EOD Diagnosis** | Ingest orders, compute fee, join drop | Ingest orders, compute fee, join drop | **MATCH (100%)** |
| **Tri-Run Verifications** | `VERIFIED_CLEAN`, `REGRESSION_UNRESOLVED` | `VERIFIED_CLEAN`, `REGRESSION_UNRESOLVED` | **MATCH (100%)** |
| **Formula Injection Defense** | Cell prefix escaping (`=`, `+`, `-`, `@`) | Cell prefix escaping (`=`, `+`, `-`, `@`) | **MATCH (100%)** |

---

## 8. Security & Data-Leakage Assessment

- **Data Isolation:** User CSV data is strictly isolated inside the browser runtime on hosted environments.
- **AST Sandbox Security:** `src/data_rewind/core/expr/ast_sandbox.py` enforces strict AST validation on all predicate and derive expressions, blocking built-ins, dunder methods (`__subclasses__`, `__import__`), system calls, and unauthorized function invocations.
- **Formula Injection Defense:** Spreadsheets exported in CSV formats are sanitized via type-aware prefix escaping to prevent formula injection attacks in Excel / Google Sheets.
- **Secrets & Credentials:** No API keys, credentials, tokens, or environment secrets are exposed in client bundles or public repository history.
- **Cost Discipline:** ₹0 operational cost is strictly preserved.

---

## 9. Root-Cause Classification

$$\mathbf{Classification:}\quad \mathbf{ARCHITECTURAL\;POLICY\;\&\;UX\;AMBIGUITY}$$

The issue is neither a bug in Python nor an outage on Vercel. It stems from:
1. An intentional security and cost policy (`hosted_demo` disallowing server-side CSV storage) that returns HTTP 403.
2. Incomplete UX guardrails in `DeveloperMode.tsx`, where the UI allows the user to click "Execute Pipeline" under "Python Backend" mode on the hosted site rather than blocking the action with actionable client-side guidance.

---

## 10. Recommended Repair Plan (Ordered by Priority)

### Priority 1: Prevent 403 Calls in Developer Mode on Hosted Deployments
- In `frontend/src/features/developer/DeveloperMode.tsx`, update `handleExecute`:
  If `isHostedEnvironment && engineMode === "backend"`, do not invoke `api.executePipeline`. Instead, display an instructional notice directing the user to use `Browser (Recommended)` mode or provide an automatic one-click switch to browser execution.

### Priority 2: Clarify Engine Switcher Controls in Hosted Demo
- In both `CSVInvestigation.tsx` and `DeveloperMode.tsx`, when `isHostedEnvironment` is `true`:
  - Visually badge the `Python Backend` button with `"Local Only"` or disable the toggle with a tooltip explaining that hosted processing is performed client-side via DuckDB-Wasm for data privacy and zero server cost.
  - Default and lock execution to `Browser (Recommended)`.

### Priority 3: Public Documentation & UI Label Harmonization
- In `README.md` and top-level landing pages, explicitly emphasize the architectural distinction:
  - **Hosted Web Application:** Pure browser execution powered by DuckDB-Wasm (0 server data transfer, 100% private, ₹0 cost).
  - **Local Python Workbench / CLI:** Full FastAPI server with local Parquet checkpoints, SQLite persistence, and CLI orchestration.

---

## 11. Exact Files Likely to Require Changes

1. `frontend/src/features/developer/DeveloperMode.tsx`  
   *(Add client-side guardrail in `handleExecute` matching `CSVInvestigation.tsx` to prevent 403 network calls).*
2. `frontend/src/features/csv/CSVInvestigation.tsx`  
   *(Add "Local Only" tag to Python Backend engine button in hosted mode).*
3. `README.md`  
   *(Clarify the hosted browser runtime vs local Python FastAPI runtime architecture).*

---

## 12. Tests Required to Prove the Repair

1. **Frontend Unit Tests (`frontend/src/__tests__/hosted-csv-experience.test.ts`):**
   - Assert that when `isHostedDemo={true}`, clicking "Execute Pipeline" in `DeveloperMode.tsx` does not fire an HTTP POST request to `/api/v1/pipelines/execute`.
   - Assert that selecting `Python Backend` in hosted environments displays clear guidance to use `Browser (Recommended)`.
2. **E2E Playwright Tests (`frontend/e2e/browser-pipeline-execution.spec.ts`):**
   - Assert that navigating to Developer Mode on a hosted URL defaults to Browser mode and executes DAGs cleanly via DuckDB-Wasm without network errors.
3. **Regression Smoke Tests:**
   - Verify `pytest tests/` remains 260/260 passing.
   - Verify `npm --prefix frontend test` remains 231/231 passing.

---

## 13. Git Safety Record

- **Current Branch:** `main`
- **Current HEAD:** `a5c6e05a3fa20d0a3e132bb1a3fa0e8c13eee9dc`
- **Worktree State:** Preserved without modification, stash, or reset.
- **Investigation Boundary:** Strict READ-ONLY compliance maintained. Zero source code or configuration files were altered.
