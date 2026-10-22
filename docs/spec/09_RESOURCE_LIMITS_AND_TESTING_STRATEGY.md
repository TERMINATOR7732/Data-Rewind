# Data Rewind — Resource Limits & Testing Strategy

**Document Version:** 1.2.0-FINAL-CLOSURE  
**Milestone:** 0.3 (Final Specification Closure & Implementation-Readiness Audit)  
**Status:** Complete Specification / Ready for Owner Review & Explicit Approval  
**Module Identifier:** `SPEC-MOD-09`

---

## 1. Exhaustive Resource-Limit Specification (8-Column Matrix)

To eliminate ambiguity across backend, engine, and UI layers, all operational thresholds are codified below with exact measurement methods, enforcement tiers, and failure semantics:

```
+---------------------------------------------------------------------------------------------------------------------------------------------------+
|                                                 COMPREHENSIVE OPERATIONAL RESOURCE-LIMIT MATRIX                                                   |
+---------------------------------------------------------------------------------------------------------------------------------------------------+
```

| 1. Resource / Operation | 2. Exact Unit & Measurement Method | 3. Hard Limit, Target, or Provisional | 4. Enforcement Location | 5. Expected Behavior When Exceeded | 6. User-Facing Error / Diagnostic | 7. Required Test / Benchmark Evidence | 8. Dependencies & Known Limitations |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Raw CSV File Size** | Decimal Megabytes ($10^6$ bytes). Measured via HTTP `Content-Length` and stream byte counter. | **Hard Limit:** 50 MB (Local) / 10 MB (Hosted Demo). | Ingestion API & streaming reader. | Immediate stream abort; unlinks partial `.tmp` upload. | `FILE_SIZE_LIMIT_EXCEEDED(size, max=50MB)` with bytes received. | `test_csv_parser.py::test_max_filesize_abort` | Uncompressed CSV only; compressed archives (`.gz`, `.zip`) rejected in v1.0. |
| **Dataset Row Cardinality** | Total data rows, strictly excluding header row and blank/whitespace records. | **Hard Limit:** 500,000 rows (Local) / 50,000 rows (Hosted). | CSV parser line iterator & DuckDB row counter. | Parsing terminates at row 500,001; unlinks partial files. | `ROW_COUNT_LIMIT_EXCEEDED(rows, max=500000)` | `test_csv_parser.py::test_row_cap` | Memory usage depends on column count and data types; narrow tables use far less RAM than wide tables. |
| **Column Count** | Count of distinct column names in parsed header record. | **Hard Limit:** 100 columns (Local) / 50 columns (Hosted). | CSV header parser. | Rejects ingestion before processing data rows. | `COLUMN_COUNT_LIMIT_EXCEEDED(cols, max=100)` | `test_csv_parser.py::test_header_width_limit` | Exceeding 100 columns increases virtual table DOM width and memory overhead. |
| **Individual Cell Length** | Character count (Unicode code points) per parsed cell. | **Hard Limit:** 4,096 characters. | CSV field parser buffer. | Parsing halts on offending field; line & column reported. | `CELL_LENGTH_LIMIT_EXCEEDED(line, col, max=4096)` | `test_csv_parser.py::test_oversized_cell_abort` | Prevents Denial-of-Service via unbounded free-text blobs. |
| **Line Byte Length** | Raw bytes between newline terminators (`\r\n` or `\n`). | **Hard Limit:** 65,536 bytes (64 KB). | CSV line reader. | Aborts parsing immediately if newline not encountered in 64 KB. | `LINE_LENGTH_EXCEEDED(line_number, max=65536)` | `test_csv_parser.py::test_runaway_line` | Protects parser from files lacking valid newline characters. |
| **Backend Process Memory Ceiling** | Binary Mebibytes (MiB, $2^{20}$ bytes). Peak Resident Set Size (RSS) via `psutil`. | **Hard Limit:** 512 MiB RSS. | OS process watcher (heartbeat loop). | Pauses admission of new tasks; if RSS reaches 512 MiB, halts run. | `OUT_OF_MEMORY_SAFEGUARD(current_rss_mib)` | `test_memory_guard.py::test_rss_threshold_trigger` | Accommodates full backend (FastAPI, cache buffers, metadata pool, and query engine). |
| **DuckDB Query Working Memory** | Binary Mebibytes (MiB). Configured via `SET max_memory = '256MB'`. | **Hard Limit:** 256 MiB. | DuckDB runtime context. | DuckDB spills query buffers to temporary directory `~/.data_rewind/tmp/`. | `QUERY_SPILL_TO_DISK` (advisory warning in telemetry). | `test_duckdb_runtime.py::test_memory_cap` | Spilling to disk prevents process OOM at the expense of temporary I/O slowdown. |
| **500k-Row Diff Memory Target** | Binary Mebibytes (MiB). Isolated query memory during relational outer join. | **Provisional Target:** $< 120$ MiB. | Benchmark runner instrumentation. | Unverified target; measured during formal benchmark protocol. | Target performance metric in benchmark dossier. | Formal Benchmark Protocol (Milestone 2.0). | Workload-dependent: affected by join cardinality, duplicate multiplicity, and width. |
| **500k-Row Diff Execution Time** | Wall-clock elapsed time measured via `time.perf_counter_ns()`. | **Provisional Target:** $< 1.5$ seconds. | Benchmark runner instrumentation. | Unverified target; measured during formal benchmark protocol. | Target performance metric in benchmark dossier. | Formal Benchmark Protocol (Milestone 2.0). | Cold execution (unwarmed disk cache) takes longer than warm in-memory cache runs. |
| **Transformation Step Timeout** | Wall-clock seconds per DAG transformation node task. | **Hard Limit:** 120 seconds (Local) / 30 seconds (Hosted). | Async execution coordinator (`asyncio.wait_for`). | Cancels active step task; downstream nodes marked `SKIPPED`. | `STEP_EXECUTION_TIMEOUT(step_id, timeout_sec=120)` | `test_executor.py::test_step_timeout_cancellation` | Prevents infinite loops or runaway joins. Temporary files unlinked cleanly. |
| **AST Expression Batch Timeout** | Wall-clock seconds per 10,000-row expression evaluation chunk. | **Hard Limit:** 1.0 second. | Vectorized AST evaluator. | Aborts active batch; marks transformation step `FAILED`. | `EXPRESSION_EVALUATION_TIMEOUT(batch_idx)` | `test_ast_security.py::test_expression_timeout` | Constrains pathological expressions that escape syntax checks. |
| **AST Complexity Bounds** | Tree depth ($\le 10$), Node count ($\le 50$), String length ($\le 1,000$). | **Hard Limit:** Depth 10, Nodes 50. | Pre-execution AST security visitor. | Rejects expression before any data evaluation begins. | `EXPRESSION_COMPLEXITY_EXCEEDED(depth, nodes)` | `test_ast_security.py::test_ast_bounds` | Protects engine from deeply nested or bloated expression trees. |
| **Disk Space Admission Check** | Decimal Megabytes ($10^6$ bytes). Free storage via `shutil.disk_usage`. | **Hard Limit:** $> 100$ MB free storage. | Pre-flight execution gate. | Blocks pipeline execution if free space $< 100$ MB. | `INSUFFICIENT_DISK_SPACE_ERROR(free_mb, required=100MB)` | `test_storage.py::test_preflight_disk_check` | **Admission check only;** does not guarantee unbounded downstream runs will fit. |

---

## 2. Reproducible Benchmark Protocol (Target Verification)

Rather than claiming unverified performance figures, Data Rewind establishes a **Reproducible Benchmark Protocol** to measure execution performance during Milestones 2.0 and 6.0:

### 2.1 Test Environment Baseline
- **Hardware Profile:** 8-core modern x86_64 CPU (e.g. AMD Ryzen 7 or Intel Core i7), 16 GB RAM, PCIe NVMe SSD.
- **Operating Systems:** Windows 11 (PowerShell) and Ubuntu 22.04 LTS.
- **Runtimes:** Python 3.11.9, DuckDB 1.1.0+, SQLite 3.45+.

### 2.2 Benchmark Dimensions & Parameter Matrix
The benchmark harness will evaluate the matrix of:
- **Dataset Sizes:** 10,000; 50,000; 100,000; 500,000 rows.
- **Column Counts:** 10, 50, and 100 columns.
- **Data Types:** Mixed distributions (30% string, 30% float, 20% integer, 10% timestamp, 10% boolean).
- **Null Densities:** 0%, 5%, 25%, and 50% null distribution.
- **Comparison Modes:**
  1. Keyed comparison (unique integer primary key).
  2. Composite keyed comparison (string + timestamp tuple).
  3. Keyless multiset comparison (bag hash distribution).
- **Perturbation Scenarios:**
  - 10% and 50% duplicate rows.
  - Full row reordering (testing multiset invariance).
  - Schema drift (1 column added, 1 removed, 1 renamed).
  - Value drift (1%, 10%, 50% modified float values within and outside tolerance).
- **Execution Warmth:** Cold run (fresh process, empty OS disk cache) vs. Warm run (subsequent query with cached DuckDB buffers).

### 2.3 Instrumentation & Metrics Reporting
- **Timing:** `time.perf_counter_ns()` measuring exact elapsed wall-clock time.
- **Memory:** `psutil.Process().memory_info().rss` sampled at 10 ms intervals to capture true peak RSS.
- **Correctness Check:** Every benchmark run verifies that output partitions match ground-truth generated deltas:
  $$|\mathcal{I}| + |\mathcal{M}| + |\mathcal{R}| \equiv |D_A| \quad \land \quad |\mathcal{I}| + |\mathcal{M}| + |\mathcal{A}| \equiv |D_B|$$
- **Statistical Aggregation:** Minimum 10 iterations per scenario. Reports full distribution: **Min, p50, p95, Max, and Standard Deviation**.

---

## 3. Comprehensive Testing Pyramid

```
                                  ▲
                                 / \
                                /   \
                               / E2E \   (Playwright Browser Flows)
                              /-------\
                             /  Integ  \  (FastAPI TestClient + DuckDB Engine)
                            /-----------\
                           /  Property   \ (Hypothesis: Multiset Commutativity)
                          /---------------\
                         /   Unit Tests    \ (AST Sandbox, Diffs, DAG Cycles, Parsing)
                        /-------------------\
```

### 3.1 Unit Testing Matrix (`pytest`)
1. **DAG Cycle & Graph Semantics (`test_dag.py`):**
   - Kahn’s algorithm on linear, branch, diamond, and disconnected DAGs.
   - Cycle detection: direct ($A \rightarrow A$) and transitive cycles ($A \rightarrow B \rightarrow C \rightarrow A$).
2. **Security & Sandboxed AST Evaluator (`test_ast_security.py`):**
   - Fuzzing against injection vectors: `__import__`, `__class__`, `os.system`, `getattr`, `eval`, `exec`.
   - AST complexity rejection: expressions with depth $> 10$, nodes $> 50$, or string length $> 1,000$.
   - Bounded exponentiation and string multiplication rejection.
   - Runtime timeout: expressions that exceed 1.0s batch execution timeout.
3. **Ingestion & CSV Hardening (`test_csv_parser.py`):**
   - RFC 4180 parsing, delimiter sniffing, UTF-8 with BOM (`utf-8-sig`), and Latin-1 fallback.
   - Rejection of null bytes (`\x00`), duplicate headers, and empty headers.
   - Cell length limit (4,096 chars) and line length limit (64 KB) enforcement.
4. **Forensic Tabular Comparator (`test_comparator.py`):**
   - Verification of all 15 comparison cases specified in `SPEC-MOD-04`.
   - Primary key, composite key, null key rejection, duplicate key fallback.
   - Float tolerance ($|a - b| \le \text{atol} + \text{rtol} \times |b|$).
   - NaN vs. Null distinction.
5. **Type-Aware Formula Injection Defense (`test_export_security.py`):**
   - Verification that negative numbers (`-42`, `-3.14`) are preserved as numbers.
   - Verification that formula vectors (`=SUM`, `  =1+1`, `-cmd|...`, `@calc`) are escaped with `'`.
   - Verification of Raw Export vs. Spreadsheet-Safe Export contracts.
6. **Tri-Run Fix Verifier (`test_verifier.py`):**
   - Verification of all verdict codes (`VERIFIED_CLEAN`, `INTENTIONAL_UPDATE`, `PARTIAL_RESTORATION`, `REGRESSION_UNRESOLVED`, `NEW_FAULT_INTRODUCED`, `BASELINE_UNAVAILABLE`).

### 3.2 Property-Based Testing (`hypothesis`)
- **Multiset Hash Invariance:**
  $$H_{\text{multiset}}(\text{shuffle}(D)) \equiv H_{\text{multiset}}(D)$$
- **Diff Set Completeness:**
  $$|\mathcal{I}| + |\mathcal{M}| + |\mathcal{R}| \equiv |D_A| \quad \land \quad |\mathcal{I}| + |\mathcal{M}| + |\mathcal{A}| \equiv |D_B|$$

---

## 4. Automated CI/CD Workflow Specification

All future pull requests must pass an automated GitHub Actions pipeline executing the following mandatory checks:

```yaml
# Proposed GitHub Actions Workflow: ci.yml
name: Continuous Integration

on:
  push:
    branches: [ main ]
  pull_request:
    branches: [ main ]

jobs:
  backend-qa:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Set up Python 3.11
        uses: actions/setup-python@v5
        with:
          python-version: "3.11"
      - name: Install dependencies
        run: |
          python -m pip install --upgrade pip
          pip install -r backend/requirements.txt
          pip install -r backend/requirements-dev.txt
      - name: Code Formatting & Linting (Ruff)
        run: ruff check backend/
      - name: Type Checking (mypy)
        run: mypy --strict backend/app
      - name: Test Suite with Coverage
        run: |
          pytest backend/tests --cov=app --cov-report=xml --cov-report=term-missing --cov-fail-under=90

  frontend-qa:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Set up Node.js 20
        uses: actions/setup-node@v4
        with:
          node-version: "20"
      - name: Install dependencies
        run: npm --prefix frontend ci
      - name: Linting (ESLint)
        run: npm --prefix frontend run lint
      - name: Type Checking (tsc)
        run: npm --prefix frontend run typecheck
      - name: Unit Tests (Vitest)
        run: npm --prefix frontend run test
      - name: Build Verification (Vite)
        run: npm --prefix frontend run build
```
