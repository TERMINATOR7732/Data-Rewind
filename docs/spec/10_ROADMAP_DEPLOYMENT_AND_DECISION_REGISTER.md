# Data Rewind — Roadmap, Deployment & Decision Register

**Document Version:** 1.2.0-FINAL-CLOSURE  
**Milestone:** 0.3 (Final Specification Closure & Implementation-Readiness Audit)  
**Status:** Complete Specification / Ready for Owner Review & Explicit Approval  
**Module Identifier:** `SPEC-MOD-10`

---

## 1. Phase-by-Phase Implementation Roadmap

The implementation of Data Rewind is divided into strictly sequential, reviewable milestones. Each milestone requires 100% test verification and explicit owner sign-off before proceeding:

```
[ M 0.1: Spec Audit ] ──► [ M 0.2: Spec Hardening ] ──► [ M 0.3: Final Closure ] (CURRENT)
                                                                 │
                                                                 ▼
[ M 1.0: Core Engine & Security ] ──► [ Kahn's DAG + DuckDB Runtime + AST Sandbox ]
                                                                 │
                                                                 ▼
[ M 2.0: Comparator & Benchmarks ] ──► [ 15 Comparison Cases + EOD + Formal Benchmark ]
                                                                 │
                                                                 ▼
[ M 3.0: Lineage & Reproducibility ] ──► [ BFS Taint Tracking + Replay Manifests ]
                                                                 │
                                                                 ▼
[ M 4.0: Fix Verification & Dossier ] ──► [ Tri-Run Protocol + Type-Aware Exporter ]
                                                                 │
                                                                 ▼
[ M 5.0: Professional UI & Modes ] ──► [ Vite + React + @xyflow Canvas + 3 Modes ]
                                                                 │
                                                                 ▼
[ M 6.0: Hardening, E2E & Release ] ──► [ E2E Playwright + CI/CD + ₹0 Deployment ]
```

### Milestone Schedule & Acceptance Gates

| Phase | Milestone Name | Key Deliverables | Measurable Acceptance Criteria |
| :--- | :--- | :--- | :--- |
| **M 0.1** | **Product Specification Audit** | Initial PRD, entity model, DAG concepts, threat matrix. | Zero code written; initial audit report delivered. |
| **M 0.2** | **Specification Hardening** | Hardened 15 comparison cases, benchmark protocol, type-aware CSV export, AST runtime limits, lifecycle states. | Zero code written; contradictions resolved; decision register prepared. |
| **M 0.3** | **Final Specification Closure** *(Current)* | Resolved local-first operating model, 8-column resource table, loss-aware CSV import/export, bounded deletion, 10-point scenario specs. | Zero code written; specification package 100% internally consistent; ready for owner approval. |
| **M 1.0** | **Core Engine & Security Foundations** | Domain models, SQLite catalog, Sandboxed AST evaluator with runtime bounds, RFC 4180 CSV parser, DuckDB runtime, Kahn's DAG. | 100% unit test pass rate; zero AST security escapes in fuzzing suite; DAG cycle tests passing. |
| **M 2.0** | **Forensic Comparator & Benchmarks** | Keyed/keyless diffs, multiset bag hashing with multiplicity, float tolerances ($\epsilon$), EOD detector, 6 diagnostic rules, benchmark protocol execution. | Multiset property tests passing (100% invariant across shuffles); accurate EOD detection; benchmark results published. |
| **M 3.0** | **Lineage, Downstream Taint & Replay** | BFS graph taint propagator, intermediate artifact cache, ReplayManifest generator, historical replayer. | Deterministic historical replay yields `REPRODUCIBLE` status; downstream blast radius matches graph truth. |
| **M 4.0** | **Fix Verification & Export Dossier** | Tri-run verification orchestrator (Baseline, Faulted, Fix), dossier generators (JSON, MD, Raw/Safe CSV with type-aware escaping). | All 8 verification verdicts validated on test fixtures; formula injection test suite 100% passing. |
| **M 5.0** | **Professional Frontend & UI Modes** | Vite + React + TS setup, Tailwind tokens, `@xyflow/react` lineage canvas, virtualized diff table, Demo (`SCN-01` to `SCN-04`), CSV Mode, Developer Mode. | 60 FPS scrolling on 50k-row diffs; all 12 screens implemented with normal/empty/loading/error states. |
| **M 6.0** | **Hardening, E2E & Production Release** | Playwright E2E browser suites, memory benchmarks ($< 512$ MB peak RSS), GitHub Actions CI, ₹0 deployment guides. | CI pipeline passes 100%; zero memory leaks; local installation verified from clean clone. |

---

## 2. Zero-Cost (₹0) Deployment Strategy

Data Rewind is built under a strict ₹0 recurring cost policy. It can be run either entirely on a local developer workstation or hosted online using standard free-tier infrastructure.

### 2.1 Primary Distribution: Local-First Desktop Execution (Recommended)
- **Zero Cloud Dependencies:** The application runs locally via a lightweight Python virtual environment and Node static bundle.
- **Commands:**
  ```bash
  # Windows
  .\run.bat
  # Linux / macOS
  ./run.sh
  ```
- **Advantages:** Unlimited execution duration, full access to local disk speed, absolute data privacy (no network transmission), zero cloud bills.

### 2.2 Optional Secondary: Hosted Web Demo (Evaluation Only)
If an online interactive demo is desired for portfolio reviewers:
- **Frontend Hosting:** **Vercel** or **GitHub Pages** (₹0 Free Tier): Deploys the static Vite production bundle (`dist/`). Vercel is strictly an optional candidate, not an architectural dependency.
- **Backend Hosting:** **Render** / **Fly.io** / **HuggingFace Spaces** (₹0 Free Tier Docker Container): Runs FastAPI + DuckDB with a 512 MB memory limit and 30-second execution timeout.
- **Hosted Constraints Handled:** In web mode, ephemeral storage is used; uploads are capped at 10 MB and 50,000 rows. Free-tier backend containers may experience cold starts (20–40s spin-up).

---

## 3. GitHub Repository & Governance Blueprint

Upon owner authorization to proceed to Milestone 1.0, a new clean GitHub repository will be established:
- **Repository Name:** `Data-Rewind`
- **License:** MIT License (permissive open-source).
- **Structure:**
  ```
  Data-Rewind/
  ├── .github/workflows/ci.yml    # Automated CI (lint, types, tests, build)
  ├── backend/                    # Python 3.11+ FastAPI + DuckDB engine
  ├── frontend/                   # Vite + React 18/19 + TypeScript + Tailwind
  ├── docs/                       # Architecture & user documentation
  │   └── spec/                   # Canonical specification suite (Milestone 0.3)
  ├── fixtures/                   # Synthetic regression datasets (SCN-01 to SCN-04)
  ├── .gitignore                  # Strict exclusion of .env, artifacts, databases
  ├── LICENSE
  ├── README.md
  ├── run.bat                     # Windows local launch script
  └── run.sh                      # Unix local launch script
  ```
- **Strict Privacy Rule:** The `.gitignore` must strictly exclude `.data_rewind/`, `*.parquet`, `*.db`, `*.sqlite`, `.env`, and user-uploaded CSVs. No user data or credentials will ever be committed.

---

## 4. Scope Matrix: In-Scope, Deferred & Excluded

```
+----------------------------------------------------------------------------------------------------+
|                                      DATA REWIND SCOPE BOUNDARIES                                  |
+----------------------------------------------------------------------------------------------------+
|  IN-SCOPE (Milestones 0.1 - 6.0)     | DEFERRED (Milestone 2.0+)       | STRICTLY EXCLUDED (Never) |
| :---                                 | :---                            | :---                      |
| • 3 Operating Modes (Demo, CSV, Dev) | • Excel (.xlsx, .xls) ingestion | • General job scheduler   |
| • 4 Curated Demo Scenarios (SCN 1-4) | • Parquet upload via Web UI     |   (Airflow/Prefect clone) |
| • Declarative YAML/JSON DAG pipelines| • Standalone DuckDB-Wasm in     | • Real-time stream engine |
| • Kahn's DAG cycle detection         |   browser (zero-backend mode)   |   (Kafka/Flink engine)    |
| • Sandboxed AST math/string language | • Git-backed pipeline repository| • Arbitrary Python / bash |
| • 15 Comparison Cases & Diffs        |   synchronization               |   execution in host OS    |
| • IEEE-754 Float Tolerance Diffing   | • Advanced fuzzy string matching| • Paid cloud databases    |
| • Earliest Observable Divergence(EOD)| • Multi-user team collaboration | • External LLM / AI calls |
| • BFS Downstream Lineage Taint       |   and SSO authentication        | • Telemetry / analytics   |
| • Tri-Run Fix Verification Protocol  |                                 |   tracking scripts        |
| • JSON, Markdown, Raw/Safe CSV Export|                                |                           |
+----------------------------------------------------------------------------------------------------+
```

---

## 5. Outstanding Decisions Register (D-01 through D-05)

The following five key architectural decisions have been thoroughly evaluated and are currently marked **`RECOMMENDED — PENDING OWNER APPROVAL`**. None are pre-approved on the owner's behalf:

### Decision D-01: In-Process Tabular Execution Engine
- **Options:** (A) DuckDB; (B) Polars; (C) Pure Pandas; (D) SQLite.
- **Analysis:** DuckDB provides standard SQL syntax, vectorized execution, native Parquet streaming, and low RAM consumption during outer-join diffs. Polars is fast but introduces platform-dependent binary risks. Pandas is memory-heavy; SQLite is row-oriented and inefficient for large analytical column scans.
- **Status:** **`RECOMMENDED — PENDING OWNER APPROVAL` (Option A: DuckDB)**.

### Decision D-02: Lineage DAG Visualization Library
- **Options:** (A) `@xyflow/react` (React Flow); (B) D3-DAG; (C) Cytoscape.js.
- **Analysis:** React Flow provides native React component rendering for custom nodes (status badges, row counters, EOD pulse animations), out-of-the-box keyboard/accessibility support, and smooth viewport panning. D3 requires imperative DOM manipulation; Cytoscape has larger bundle overhead.
- **Status:** **`RECOMMENDED — PENDING OWNER APPROVAL` (Option A: `@xyflow/react`)**.

### Decision D-03: Initial File Ingestion Scope (CSV vs. Excel)
- **Options:** (A) Strict CSV only for v1.0; (B) Dual CSV + Excel (.xlsx) support.
- **Analysis:** Excel files introduce major security vulnerabilities (XML Entity Expansion, ZIP bombs, formula exploits) and require heavy dependencies (`openpyxl`, `xlrd`). In contrast, RFC 4180 CSV has a minimal attack surface and handles 99% of data engineering tabular exchanges.
- **Status:** **`RECOMMENDED — PENDING OWNER APPROVAL` (Option A: CSV only in v1.0; defer Excel to M2.0)**.

### Decision D-04: Demo Mode Scenario Breadth vs. Depth
- **Options:** (A) 4 deeply engineered scenarios (`SCN-01` to `SCN-04`); (B) 10 shallow scenarios.
- **Analysis:** Shallow scenarios only demonstrate trivial row filters. Four deeply engineered scenarios allow complete demonstration of arithmetic/logic bugs, schema drift, duplicate cardinality explosion, and null sentinel propagation, each backed by full tri-run fix verification.
- **Status:** **`RECOMMENDED — PENDING OWNER APPROVAL` (Option A: 4 Curated Scenarios)**.

### Decision D-05: Deployment Topology Target
- **Options:** (A) Local-First Desktop primary, optional free-tier web demo; (B) Cloud-First Web App.
- **Analysis:** Cloud-first hosting introduces cloud bills, cold starts, and container RAM limits. Local-first adheres strictly to the ₹0 budget and provides maximum performance and complete privacy.
- **Status:** **`RECOMMENDED — PENDING OWNER APPROVAL` (Option A: Local-First Desktop primary, optional static Vercel demo)**.

---

## 6. Final Milestone 0.3 Implementation-Readiness Checklist

The following audit checklist verifies that all requirements for Milestone 0.3 have been comprehensively fulfilled:

- [x] **Local-First Operating Model Defined:** Clean launch experience, loopback binding (`127.0.0.1`), origin restriction, offline capability, and desktop framework evaluation documented.
- [x] **Optional Hosted Profile Bounded:** Separate profile documented with explicit data transmission disclosure, ephemeral storage, and resource caps.
- [x] **8-Column Resource Limit Table Established:** Exact units, hard limits vs provisional targets, measurement methods, and failure behaviors codified.
- [x] **Resource Ambiguities Resolved:** Decimal MB vs binary MiB, raw uncompressed CSV limits, line caps (64 KB), cell caps (4,096 chars), and process RSS vs query memory reconciled.
- [x] **Loss-Aware CSV Import/Export Formalized:** Raw Export preserves exact logical data for round-tripping; Spreadsheet-Safe Export applies type-aware escaping preserving negative numbers.
- [x] **Reproducibility Inputs & Edge Cases Codified:** Pinned input hashes, pipeline definition hashes, parameters, frozen time, and 5 replay outcomes specified.
- [x] **Application-Managed Deletion Bounded:** Physical erasure claims corrected to state operating-system file unlinking and document physical SSD wear-leveling / journaling limits.
- [x] **AST Sandbox Runtime Bounds Codified:** Tree depth $\le 10$, node count $\le 50$, batch timeout 1.0s, exponentiation bounds, and no `eval`/`exec`.
- [x] **10-Point Demo Scenario Specifications Formalized:** Scenarios `SCN-01` through `SCN-04` documented with expected outputs, tri-run verdicts, and negative tests.
- [x] **Decision Register D-01 to D-05 Preserved:** Clearly labeled as `RECOMMENDED — PENDING OWNER APPROVAL`.
- [x] **Master Specification Synchronized:** `SPECIFICATION.md` remains the unified canonical source of truth.
- [x] **Zero Code Execution Boundary Respected:** Confirmed zero backend/frontend code generated, zero packages installed, zero git repos created.
