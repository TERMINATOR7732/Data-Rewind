# Data Rewind

> **Understand the past. Verify the present.**

Data Rewind is a local-first, zero-operating-cost data-engineering platform for investigating data-processing pipelines that produce changed, incorrect, or mathematically drifted outputs over time. It provides an evidence-based forensic investigation loop:

$$\text{Run} \longrightarrow \text{Detect} \longrightarrow \text{Compare} \longrightarrow \text{Trace} \longrightarrow \text{Assess Impact} \longrightarrow \text{Reproduce} \longrightarrow \text{Fix} \longrightarrow \text{Verify} \longrightarrow \text{Report}$$

Data Rewind is built as a rigorous engineering workbench—**not a generic dashboard, not an LLM wrapper, and not a chatbot**.

---

## Key Capabilities (Milestone 1.0 to 6.0)

1. **Hardening, E2E Benchmarking & Production Release (Milestone 6.0):**
   - **Playwright Browser E2E Test Suite:** Automated Chromium end-to-end user journeys across application shell navigation, offline fallback detection, SCN-01 through SCN-04 investigation & verification, lineage table fallback, CSV ingestion limits, dual-axis tri-run verification, and signed dossier export.
   - **End-to-End Performance & Memory Benchmarks:** Automated memory sampler capturing peak RSS via `psutil` at 10ms intervals, verifying $< 512$ MiB total process peak RSS, $< 120$ MiB delta RSS for 500k row comparison, $< 1,500$ ms comparison latency, and 100% partition completeness. Generates `benchmarks/output/benchmark_report.json` and `benchmark_report.md`.
   - **Resource-Limit & Security Hardening:** Strict boundaries on CSV ingestion (50 MB file, 500k rows, 100 columns, 4,096 char cells, 64 KB lines), path jail containment against traversal attacks, workspace purge confinement, cyclic DAG detection, AST expression security fuzzing, and spreadsheet formula-injection protection (`=`, `+`, `-`, `@`, `\t`, `\r`).
   - **Automated GitHub Actions CI Workflow:** Matrix builds across Ubuntu and Windows runners covering backend QA (pytest, coverage $\ge 90\%$, ruff, mypy strict, smoke tests), frontend QA (npm ci, vitest, tsc build), Playwright E2E browser tests, and automated benchmark budget gates.
   - **Release Readiness:** One-click launch scripts (`run.bat`, `run.sh`), clean clone verification, strict ₹0 budget, and production deployment checklists.

2. **Frontend Forensic Workbench (Milestone 5.0):**
   - **Interactive DAG Canvas (Decision D-02):** Powered by `@xyflow/react`, visualizing pipeline steps, dataflow edges, animated taint paths, and an amber Earliest Observable Divergence (EOD) beacon node, with a keyboard-navigable accessible table fallback.
   - **Side-by-Side Row Diff Viewer:** Deep row delta inspection across keyed, composite-keyed, and multiset datasets with pinned PKs, status filters (`ALL`, `MODIFIED`, `ADDED`, `REMOVED`, `IDENTICAL`), and highlighted cell drift.
   - **Evidence & Root-Cause Panel:** Segregates verified mathematical facts (*Proven Observations*) from *Causal Hypotheses* and diagnostic rules without arbitrary percentage scores.
   - **Tri-Run Fix Verification Hub:** Dual-axis verification matrix (Axis 1: Remediation Evaluation vs Axis 2: Baseline Equivalence) evaluating candidate patches against both faulted and baseline runs across all 8 canonical verdicts.
   - **Forensic Report Studio:** Multi-format dossier export (JSON, Markdown, and CSV) featuring Type-Aware Formula-Injection Protection (safe numeric preservation vs formula shielding).
   - **Developer Mode & Declarative DAGs:** In-browser JSON/YAML pipeline definition editor with Kahn cycle detection, AST sandbox safety checks, and DuckDB checkpoint execution.
   - **Workspace Storage & Data Privacy:** Local retention telemetry and application-managed purge with forensic sanitization disclaimers.

3. **Tri-Run Fix Verification & Reporting (Milestone 4.0):**
   - 8 canonical verification verdicts: `VERIFIED_CLEAN`, `INTENTIONAL_UPDATE`, `PARTIAL_RESTORATION`, `REGRESSION_UNRESOLVED`, `NEW_FAULT_INTRODUCED`, `BASELINE_UNAVAILABLE`, `FAULT_UNREPRODUCIBLE`, `INCONCLUSIVE_VERIFICATION`.
   - Multi-tier evidence chain: `PROVEN_OBSERVATION`, `CAUSAL_HYPOTHESIS_DIRECT_CODE_DIFF`, `CAUSAL_HYPOTHESIS_INPUT_DRIFT`, `CORRELATION_INFERENCE`, `INDETERMINATE`.

4. **Lineage, Historical Replay & Scenarios (Milestone 3.0):**
   - Downstream blast-radius computation using BFS on transposed graph $G^T$.
   - Bit-for-bit historical replay via self-contained manifests.
   - 4 deterministic demonstration scenarios (`SCN-01` to `SCN-04`).

5. **Forensic Tabular Comparator & Diagnostics (Milestone 2.0):**
   - 15 operational comparison cases with additive dual-accumulator multiset fingerprinting.
   - Automated root-cause diagnostic rules (DR-01 to DR-06).

6. **Core Foundations & Security (Milestone 1.0):**
   - Vectorized in-process DuckDB query runtime (`max_memory = '256MB'`).
   - Anti-RCE Sandboxed AST engine (depth $\le 10$, nodes $\le 50$, batch timeout).
   - Strict loopback isolation (`127.0.0.1`), zero external APIs, zero cloud subscriptions (strict ₹0 budget).

---

## Quickstart & Launch Experience

### 1. One-Click Clean Launch (Recommended)

- **Windows:** Double-click `run.bat` or run:
  ```cmd
  run.bat
  ```
- **Linux / macOS:** Run:
  ```bash
  chmod +x run.sh
  ./run.sh
  ```

This checks prerequisites, activates the virtual environment, starts the Python API backend on `http://127.0.0.1:8000`, launches the Vite frontend on `http://localhost:5173`, and opens your default browser.

### 2. Manual Developer Startup

**Terminal 1 — Backend API:**
```powershell
.\.venv\Scripts\Activate.ps1
python -m data_rewind.cli serve --port 8000
```

**Terminal 2 — Frontend Workbench:**
```powershell
cd frontend
npm.cmd run dev
```

Visit `http://localhost:5173` in your browser. API documentation is available at `http://127.0.0.1:8000/api/docs`.

---

## Quality Gates & Verification

Run all established verification suites before declaring production readiness:

```powershell
# 1. Python Unit, Integration & API Tests with Coverage (>= 90% threshold)
pytest -v --cov=data_rewind --cov-fail-under=90

# 2. Ruff Linter & Formatting Checks
ruff check src tests
ruff format --check src tests

# 3. Mypy Strict Static Type Checking
mypy src

# 4. Core Engine Foundations Smoke Test
python -m data_rewind.smoke_test

# 5. Resource Guards & Diagnostics Check
python -m data_rewind.cli diagnostics

# 6. Frontend Unit & Component Tests (Vitest)
cd frontend && npm.cmd run test

# 7. Frontend Production Type-Check & Bundle Build
cd frontend && npm.cmd run build

# 8. Playwright Browser E2E Integration Suite (7 User Journeys)
cd frontend && npm.cmd run test:e2e

# 9. End-to-End Performance & Memory Benchmark Suite (Budget Gates)
python -m data_rewind.cli benchmark
# Or fast CI smoke benchmark:
python -m data_rewind.cli benchmark --quick
```

---

## Resource Limits & Security Guardrails

| Constraint | Limit | Failure Response / Policy | Conformance |
| :--- | :--- | :--- | :--- |
| **Raw CSV File Size** | 50 MB | `413 FILE_SIZE_LIMIT_EXCEEDED` | SPEC-MOD-01, SPEC-MOD-06 §2 |
| **Max Dataset Rows** | 500,000 | `413 ROW_COUNT_LIMIT_EXCEEDED` | SPEC-MOD-01, SPEC-MOD-09 §1 |
| **Max Dataset Columns**| 100 | `400 COLUMN_COUNT_LIMIT_EXCEEDED`| SPEC-MOD-01, SPEC-MOD-09 §1 |
| **Max Cell Length** | 4,096 chars | `400 CELL_LENGTH_LIMIT_EXCEEDED` | SPEC-MOD-01, SPEC-MOD-06 §2 |
| **Max Line Length** | 64 KB | `400 LINE_LENGTH_EXCEEDED` | SPEC-MOD-01, SPEC-MOD-06 §2 |
| **AST Expression Depth** | $\le 10$ | `ExpressionComplexityError` | SPEC-MOD-06 §3 |
| **AST Node Count** | $\le 50$ | `ExpressionComplexityError` | SPEC-MOD-06 §3 |
| **AST Expression Length** | $\le 1,000$ chars | `ExpressionComplexityError` | SPEC-MOD-06 §3 |
| **Total Process RSS** | $< 512$ MiB | Enforced during benchmark & load | SPEC-MOD-09 §2 |
| **Loopback Binding** | `127.0.0.1` only | `localhost` & `127.0.0.1` CORS guard | SPEC-MOD-07 §1.1 |
| **Formula Protection** | Type-Aware | Prepend `'` to `=`, `+`, `-`, `@`, `\t`, `\r` | SPEC-MOD-05 §2 |

---

## Approved Architectural Decisions Traceability

| Decision ID | Summary | Implementation Status |
| :--- | :--- | :--- |
| **D-01** | Tabular Execution Engine: DuckDB | **Implemented in M1.0** (`DuckDBRuntime`, memory limits, transactions). |
| **D-02** | Lineage Canvas: `@xyflow/react` | **Implemented in M5.0** (`LineageGraph` with EOD beacon and animated taint flow). |
| **D-03** | Ingestion File Scope: CSV Only in v1.0 | **Implemented in M5.0** (RFC 4180 ingestion, 50 MB / 500k row guardrails). |
| **D-04** | Demo Scenarios: 4 Deep Scenarios | **Implemented in M3.0 & M5.0** (`SCN-01` to `SCN-04` with 1-click execution & verification). |
| **D-05** | Topology: Local-First Desktop Primary | **Implemented in M1.0 & M5.0** (100% offline, loopback `127.0.0.1`, ₹0 recurring cost). |

---

## License

MIT License. See LICENSE file for details.
