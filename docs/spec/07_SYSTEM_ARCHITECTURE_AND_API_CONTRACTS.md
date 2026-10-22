# Data Rewind — System Architecture & API Contracts

**Document Version:** 1.2.0-FINAL-CLOSURE  
**Milestone:** 0.3 (Final Specification Closure & Implementation-Readiness Audit)  
**Status:** Complete Specification / Ready for Owner Review & Explicit Approval  
**Module Identifier:** `SPEC-MOD-07`

---

## 1. Operating Models: Local-First Primary vs. Optional Hosted Profile

Data Rewind separates its deployment architecture into two distinct, non-conflated operating profiles:

```
+----------------------------------------------------------------------------------------------------+
|                                    OPERATING PROFILE BOUNDARIES                                    |
+----------------------------------------------------------------------------------------------------+
|  PRIMARY: LOCAL-FIRST WORKSTATION APP          |  SECONDARY: OPTIONAL HOSTED DEMO PROFILE          |
| :---                                           | :---                                              |
| • 100% local processing; zero data leaves host  | • User uploads transmitted to cloud container     |
| • Bound strictly to loopback (127.0.0.1)       | • Hosted on public free tier (Vercel / Render)    |
| • Unlimited run duration; local NVMe speeds    | • Bounded execution (30s timeout, 256 MB RAM cap) |
| • Persistent SQLite catalog & Parquet vault    | • Ephemeral container storage; wiped on restart   |
| • Zero accounts, zero API keys, 100% offline   | • Pre-loaded Demo Mode only; CSV upload restricted|
+----------------------------------------------------------------------------------------------------+
```

### 1.1 Primary Architecture: Local-First Application
- **Accurate Architectural Classification:** Data Rewind is a **local-first web application** (a React single-page frontend running in the user's browser, communicating with a locally executed Python/FastAPI backend on `127.0.0.1:8000`). It is **not** packaged with Electron or Tauri in v1.0. Avoiding a heavy desktop wrapper eliminates 150+ MB of bundle bloat, prevents cross-platform webview rendering bugs, and adheres strictly to the ₹0 budget.
- **Launch Experience (Clean Checkout):**
  - **Windows:** Double-click `run.bat` (checks Python 3.11+ / Node 20+, activates venv, launches Uvicorn on port 8000, launches Vite on port 5173, and opens default browser to `http://localhost:5173`).
  - **Linux / macOS:** Execute `./run.sh`.
  - **Developer Mode:** `cd backend && uvicorn app.main:app --port 8000` in one terminal; `cd frontend && npm run dev` in another.
- **Backend Discovery & Ports:**
  - Frontend discovers the backend via `VITE_API_URL` (default: `http://127.0.0.1:8000/api/v1`).
  - If port 8000 is occupied, the launch script prompts for an alternate port or reads `DATA_REWIND_PORT`.
  - The frontend polls `GET /api/v1/health` on startup. If the backend is unreachable or terminates, the UI displays a clean, non-intrusive **"Backend Disconnected — Reconnecting..."** banner.
- **Loopback Security & Origin Restrictions:**
  - The FastAPI backend binds **strictly to `127.0.0.1`** (loopback), **never to `0.0.0.0`**. This ensures the local API is completely inaccessible from other devices on the local network (LAN) or public internet.
  - CORS middleware is configured strictly to permit origins `http://127.0.0.1:*` and `http://localhost:*`. Malicious external websites cannot issue cross-origin requests to read user data.
- **Local Storage Hierarchy:**
  ```
  ~/.data_rewind/
  ├── config.json                     # Local application preferences
  ├── metadata.db                     # SQLite 3 catalog (WAL mode)
  ├── workspaces/
  │   └── {workspace_id}/
  │       ├── workspace.lock          # Concurrency mutex
  │       └── raw_inputs/             # Byte-for-byte preserved raw CSVs
  ├── artifacts/                      # Content-addressed Parquet vault ({sha256}.parquet)
  └── tmp/                            # Ephemeral scratch files (unlinked on completion)
  ```
- **Concurrency Control:**
  - Each workspace contains a `workspace.lock` file. If two browser tabs attempt to trigger pipeline runs on the same workspace simultaneously, the second run is queued cleanly with a `"Workspace Busy — Queued"` notification.
- **Offline Guarantee:**
  - The core workflow requires zero internet access. No external fonts, no telemetry, no CDNs, and no cloud logins.

---

### 1.2 Secondary Architecture: Optional Hosted Demonstration Profile
If hosted online for recruiter/reviewer evaluation without local installation:
- **Deployment Profile:** Activated via environment flag `DATA_REWIND_PROFILE="hosted_demo"`.
- **Privacy Disclosure:** In this mode, user uploads and pipeline commands **leave the user's computer** and are transmitted over HTTPS to the hosting provider's cloud container.
- **Storage & Retention Policy:** All uploaded files and intermediate artifacts are written to ephemeral container disk (`/tmp/data_rewind/`) and are permanently purged after 60 minutes of session inactivity or whenever the host container cycles.
- **Feature Restrictions:**
  - Demo Mode is fully enabled (using pre-bundled synthetic scenarios).
  - CSV Upload Mode is strictly constrained: 10 MB file cap, 50,000 rows max.
  - Developer Mode filesystem access is disabled.
- **Prohibited Data Notice:** The UI presents a prominent advisory: *"Hosted Demo Profile: Do not upload sensitive enterprise data or credentials. Use Local Workstation Mode for complete privacy."*

---

## 2. Backend Module Architecture & Boundaries

```
backend/
├── app/
│   ├── main.py                     # FastAPI application factory & lifespan events
│   ├── core/                       # Global configuration, settings, logging
│   ├── domain/                     # Pure domain models, enums, entity schemas
│   ├── engine/                     # Pipeline execution engine
│   │   ├── dag.py                  # DAG parser, Kahn's cycle detector, topological sorter
│   │   ├── executor.py             # Step execution coordinator
│   │   ├── duckdb_runtime.py       # DuckDB context manager & query runner
│   │   └── operations/             # Atomic transformations (filter, join, aggregate, derive)
│   ├── security/                   # Sandboxed AST visitor, path jailer, CSV parser guards
│   ├── comparator/                 # Diffing engine (keyed, keyless multiset, float tolerances)
│   ├── diagnostics/                # EOD detector, root-cause rules, lineage taint BFS
│   ├── verifier/                   # Tri-run fix verification manager
│   ├── storage/                    # Artifact vault, content-addressed files, SQLite repository
│   └── api/                        # REST API endpoint routers
│       ├── v1/
│       │   ├── workspaces.py
│       │   ├── datasets.py
│       │   ├── pipelines.py
│       │   ├── runs.py
│       │   ├── comparisons.py
│       │   ├── verifications.py
│       │   └── reports.py
```

---

## 3. REST API Specification & Endpoint Contracts

All API endpoints follow RESTful conventions under the base path `/api/v1`.

### 3.1 Endpoint Directory

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/v1/health` | Healthcheck, engine version, and operating profile (`local` vs `hosted_demo`). |
| `POST` | `/api/v1/workspaces` | Initialize a new isolated workspace. |
| `POST` | `/api/v1/datasets/upload` | Upload, preserve raw bytes, and validate a raw CSV dataset. |
| `GET` | `/api/v1/datasets/{id}/preview` | Preview schema, column types, and first 50 rows. |
| `POST` | `/api/v1/pipelines` | Register or update a declarative pipeline definition. |
| `GET` | `/api/v1/pipelines/{id}` | Retrieve pipeline definition and version history. |
| `POST` | `/api/v1/pipelines/{id}/runs` | Trigger a new pipeline execution run. |
| `GET` | `/api/v1/runs/{id}` | Retrieve run status, execution duration, and node statuses. |
| `GET` | `/api/v1/runs/{id}/dag` | Retrieve full execution graph with step telemetry and artifact hashes. |
| `GET` | `/api/v1/runs/{id}/artifacts/{step_id}` | Retrieve intermediate tabular artifact data (paginated). |
| `POST` | `/api/v1/comparisons` | Create a comparative diff between two completed runs ($R_0$ vs $R_1$). |
| `GET` | `/api/v1/comparisons/{id}` | Retrieve EOD, findings, impact blast radius, and step-level deltas. |
| `GET` | `/api/v1/comparisons/{id}/steps/{step_id}/diff` | Retrieve paginated row diffs (Added, Removed, Modified, Identical). |
| `POST` | `/api/v1/verifications` | Execute a candidate fix run ($R_2$) and run tri-run verification. |
| `GET` | `/api/v1/reports/{id}/export` | Export investigation dossier as JSON, Markdown, Raw CSV, or Safe CSV. |

---

## 4. Standardized Error Envelope

All API errors return a consistent, structured envelope with unambiguous error codes and actionable remediation guidance:

```json
{
  "error": {
    "code": "EXPRESSION_SECURITY_VIOLATION",
    "message": "The expression contains unauthorized syntax or exceeds allowed complexity bounds.",
    "details": {
      "expression": "os.system('whoami')",
      "prohibited_node": "Attribute",
      "line": 1,
      "col_offset": 0
    },
    "remediation": "Use only whitelisted mathematical operators and registered scalar functions (e.g. coalesce, abs, round). Tree depth must not exceed 10.",
    "timestamp": "2026-10-22T13:15:30Z"
  }
}
```
