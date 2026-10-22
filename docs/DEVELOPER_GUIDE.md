# Data Rewind — Developer Guide & Architecture Reference

**Document Version:** 1.1.0  
**Target Milestone:** 1.0.2 (Targeted Core Engine Remediation, Regression Testing, and Verification)  
**Author:** Data Rewind Engineering Team  
**Tagline:** *Understand the past. Verify the present.*

---

## 1. Project Architecture & Module Responsibilities

The codebase follows a clean, layered `src/`-based layout where pure domain logic remains independent from database engines, filesystem operations, and UI concerns.

```
src/data_rewind/
├── core/
│   ├── domain/               # Core domain entities, value objects, lifecycle FSM, errors
│   │   ├── models.py         # PipelineRun, StepExecution, DatasetSchema, ContentHash, etc.
│   │   ├── lifecycle.py      # RunLifecycle FSM (PENDING -> RUNNING -> COMPLETED/FAILED/...)
│   │   └── errors.py         # Structured error hierarchy with stable error codes
│   ├── dag/                  # Graph topology, Kahn's algorithm, cycle diagnostics
│   │   ├── models.py         # DAGNode, DAGEdge, DAGValidationResult
│   │   └── validator.py      # Lexicographical tie-breaking, cycle extraction, descendants BFS
│   ├── expr/                 # Sandboxed AST expression engine (Zero eval/exec)
│   │   ├── ast_sandbox.py    # Syntax allowlist, depth <= 10, node count <= 50, anti-RCE
│   │   └── evaluator.py      # Pure AST interpreter, timeout enforcement, pure functions
│   ├── db/                   # In-process DuckDB query runtime abstraction
│   │   └── duckdb_runtime.py # Controlled lifecycle, SET max_memory = '256MB', transactions
│   ├── integrity/            # Canonical serialization, multiset hashing, artifact storage
│   │   ├── serialization.py  # Canonical row normalizer S(v) and UTF-8 byte serialization C(r)
│   │   ├── hashing.py        # Row hash h(r), order-independent multiset hash H_multiset(D)
│   │   ├── manifest.py       # ReplayManifest schema, validation, canonical JSON round-trip
│   │   └── storage.py        # ArtifactStorageVault (atomic .tmp -> fsync -> os.replace)
│   └── config/               # Centralized configuration & 8-column limits matrix
│       ├── settings.py       # Pydantic Settings, Local vs Hosted Demo profiles
│       └── guards.py         # ResourceGuards (file size, rows, cols, line/cell, RSS, disk)
├── cli.py                    # Developer diagnostics and smoke-test CLI entry point
└── smoke_test.py             # 8-step end-to-end integration and determinism test workflow
```

---

## 2. Supported Runtime and Dependency Versions

- **Python Runtime:** Python 3.11.x or 3.12.x (Verified on Python 3.12.0 x86_64).
- **Tabular Engine:** DuckDB 1.1.0+ (Verified on DuckDB 2.0.0).
- **Data Validation:** Pydantic 2.6.0+ (Verified on Pydantic 2.14.1).
- **System Telemetry:** psutil 5.9.0+ (Verified on psutil 7.2.2).
- **Testing & QA Tools:**
  - `pytest` 8.0.0+ / 9.1.1
  - `pytest-cov` 4.1.0+ / 7.1.0
  - `ruff` 0.3.0+ / 0.17.1 (Linter and Formatter)
  - `mypy` 1.9.0+ / 2.4.0 (Strict mode type checker)

---

## 3. Installation & Development Commands

### Environment Setup
```powershell
# 1. Initialize virtual environment
python -m venv .venv

# 2. Activate virtual environment
.\.venv\Scripts\Activate.ps1

# 3. Install development dependencies
pip install -r requirements-dev.txt

# 4. Install data-rewind in editable mode
pip install -e .
```

### Running Quality Gates
```powershell
# Run Ruff Linter
ruff check src tests

# Run Ruff Formatter Check
ruff format --check src tests

# Run Mypy Static Type Checker (Strict Mode)
mypy src

# Run Pytest with Coverage Report (Branch Coverage >= 90%)
pytest -v --cov=data_rewind --cov-report=term-missing
```

### Running Diagnostics & Smoke Test
```powershell
# Display local environment diagnostics
python -m data_rewind.cli diagnostics

# Execute complete integration smoke test
python -m data_rewind.smoke_test
```

---

## 4. How the DAG Validator Works

Conforms to `SPEC-MOD-03` Section 1.

1. **Cycle Detection & Kahn's Algorithm:**
   - Computes in-degrees for all step nodes based on step-to-step dependency edges.
   - Nodes with an in-degree of 0 are added to a **lexicographical min-heap** (`heapq`).
   - Tie-Breaking: Whenever multiple nodes are simultaneously eligible for execution, the node with the lexicographically smallest `step_id` is popped next. This guarantees stable, deterministic execution order regardless of input dictionary order.
   - If the processed node count is less than the total node count, Kahn's algorithm detects a cycle.
2. **Cycle Path Extraction:**
   - When a cycle is detected, a deterministic Depth-First Search (DFS) traverses the unresolved subgraph (nodes with `in_degree > 0`).
   - Identifies the exact participating cycle (e.g., `["step_a", "step_b", "step_c", "step_a"]`) and raises a `CyclicDependencyError`.
3. **Cardinality Verification:**
   - `join_datasets` operations must have exactly 2 input dependencies.
   - Single-input operations (`filter_rows`, `derive_column`, `aggregate_group_by`, `deduplicate_rows`, `cast_columns`) must have exactly 1 input dependency.
4. **Dangling References:**
   - Any dependency that does not exist in registered external inputs or preceding step identifiers raises `DanglingReferenceError`.

---

## 5. Allowed Expression Language & Security Sandbox

Conforms to `SPEC-MOD-06` Section 3.

### Anti-RCE Rule
> [!IMPORTANT]
> The Python primitives `eval()`, `exec()`, `compile()`, and `__import__()` are **strictly prohibited** anywhere in the Data Rewind codebase. Expressions are evaluated via a custom recursive AST interpreter without code generation.

### Allowed Syntax
- **Literals:** Numbers (`10`, `3.14`), Strings (`'COMPLETED'`), Booleans (`True`, `False`, `true`, `false`), Null (`None`, `null`, `NULL`).
- **Operators:**
  - Arithmetic: `+`, `-`, `*`, `/`, `%`
  - Unary: `+x`, `-x`, `not x`
  - Comparisons: `==`, `!=`, `<`, `<=`, `>`, `>=`
  - Boolean logic: `and`, `or`
  - Conditional: `value if condition else alternative`
- **Whitelisted Pure Functions:**
  - `abs(x)`: Absolute value
  - `round(x, n)`: Numeric rounding to $n$ decimal places
  - `upper(s)`: Convert string to uppercase
  - `lower(s)`: Convert string to lowercase
  - `trim(s)`: Strip leading and trailing whitespace
  - `coalesce(*args)`: Return first non-null argument
  - `if_else(condition, true_val, false_val)`: Functional conditional
  - `date_diff(d1, d2)`: Difference in days between ISO dates
  - `len(s)`: Character length of string

### Prohibited Syntax (Immediate Rejection)
- **Attribute Access:** `x.attribute`, `x.__class__` (Blocks dunder exploitation).
- **Subscripts:** `x[0]`, `x['key']`.
- **Imports:** `__import__`, `import os`.
- **String Multiplication:** `'A' * 1000` (Blocks memory exhaustion).
- **Exponentiation:** `2 ** 1000000` (Blocks CPU freeze).
- **Lambdas & Comprehensions:** `lambda x: x`, `[x for x in y]`.
- **Container Displays:** `[1, 2]`, `{'a': 1}`.

### Complexity Bounds & Batch Timeout Strategy
- Maximum Expression Length: $\le 1,000$ characters.
- Maximum AST Tree Depth: $\le 10$.
- Maximum AST Node Count: $\le 50$.
- Batch Evaluation Timeout: $1.0$ second default per row batch (`evaluate_batch`).
- **Dynamic Check Interval (P1-01):** In-loop timeout checks are evaluated dynamically at an interval of:
  $$\text{check\_interval} = \max(1, \min(100, \lfloor N / 10 \rfloor))$$
  This ensures small batches ($N < 100$) check timeout status frequently (every 1 to 9 rows) while large batches ($N \ge 1,000$) check every 100 rows with negligible overhead.
- **Post-Loop Verification:** A post-loop elapsed-time check prevents returning results if the batch duration crossed the threshold between the final periodic interval and completion.

### Non-Preemptive Execution Limitation & Threat Model (P2-01)
> [!WARNING]
> **Architectural Boundary:** The AST expression engine operates strictly in-thread and non-preemptively.

- **How It Works:** AST validation (`ASTSecurityValidator`) and the recursive node evaluator (`ASTEvaluator`) restrict syntax to allowlisted safe operations, blocking code execution (`eval`/`exec`), imports, dunders, attribute lookups, string multiplication, and exponentiation.
- **The Limitation:** Timeout checks occur cooperatively between row evaluations (`idx % check_interval == 0`) and post-loop. If a single malicious or pathological expression monopolizes the CPU during evaluation of a single row, the current in-thread mechanism cannot interrupt it until control returns to the loop.
- **Threat Model Reality:** Expression syntax allowlisting and cooperative timeout checks significantly reduce attack surface, but they do **not** constitute a hard OS-level sandbox against CPU starvation or execution freezing.
- **Preemptive Sandboxing Roadmap:** Hard execution preemption (such as worker process isolation, OS-level cgroup/job object limits, or separate execution subprocesses) is explicitly deferred to Milestone 5.0 subject to security and architecture review.
- **Practical Developer Guidelines:**
  1. *Preserve complexity limits:* Never weaken or remove AST depth ($\le 10$), node count ($\le 50$), or literal length bounds.
  2. *Avoid CPU-heavy primitives:* Do not add pure functions with unbounded looping, heavy regex evaluation, or recursive algorithms.
  3. *Maintain adversarial tests:* Keep all adversarial security test vectors active in `tests/test_ast_security.py`.
  4. *Do not raise timeouts arbitrarily:* Maintain the 1.0-second default batch timeout; evaluate threat implications before altering resource limits.

---

## 6. DuckDB Runtime & Connection Lifecycle

Conforms to [docs/spec/07_SYSTEM_ARCHITECTURE_AND_API_CONTRACTS.md](docs/spec/07_SYSTEM_ARCHITECTURE_AND_API_CONTRACTS.md) Section 1 and Decision `D-01`.

### Connection Lifecycle Management
- **Controlled Connection:** Wrapped in `DuckDBRuntime`.
- **Resource Limits:** Configured at connection initialization:
  - `SET max_memory = '256MB'`
  - `SET threads = 4`
  - `SET temp_directory = '~/.data_rewind/tmp/'`
- **Parameter Binding:** All queries use `?` parameter placeholders to guarantee SQL injection defense.
- **Transactions:** Supports `with runtime.transaction():` context manager. Automatically commits on successful exit and issues `conn.rollback()` on exceptions. Flat transaction nesting is enforced (`_in_transaction` check).
- **Error Wrapping:** Translates native `duckdb.Error` into `DuckDBRuntimeError` with SQL sanitization.
- **Cleanup:** Explicit `close()` closes the native connection and resets state; context manager `with DuckDBRuntime(cfg) as rt:` ensures deterministic cleanup on exit.

### Connection Concurrency & Thread-Safety Limitations (P2-02)
> [!WARNING]
> **Concurrency Invariant:** A `DuckDBRuntime` instance and its underlying connection are **NOT thread-safe**.

- **Single Connection Architecture:** Each `DuckDBRuntime` instance owns exactly one connection (`self._connection`). It does not implement a connection pool or connection multiplexing.
- **No Concurrent Querying:** The underlying `duckdb.DuckDBPyConnection` and the runtime's internal transaction state (`self._in_transaction`) lack synchronization primitives (locks/mutexes). Executing concurrent queries or statements across threads on a shared instance will corrupt transaction states or cause undefined native behavior.
- **Access Serialization:** Callers that must share a `DuckDBRuntime` across multiple threads must serialize access using an external synchronization primitive (such as `threading.Lock`).
- **Worker Isolation Pattern:** When concurrent or parallel task execution is needed (e.g., parallel DAG node evaluation in future milestones), each worker thread or process must instantiate its own separate `DuckDBRuntime` instance with an independent connection.
- **File Database Locking:** For file-backed databases, DuckDB supports multiple concurrent read-only connections, but strictly allows only one writer connection per file. Concurrent write transactions across separate instances pointing to the same file path will fail.
- **Future Concurrency Roadmap:** Dedicated thread pooling, worker connection pooling, and multi-tenant database concurrency are out of scope for Milestone 1.x and will be designed alongside parallel execution engines in future milestones with dedicated concurrency stress test suites.

---

## 7. Canonical Serialization, Hashing & Storage Vault

Conforms to [docs/spec/02_SHARED_DOMAIN_MODEL_AND_LIFECYCLE.md](docs/spec/02_SHARED_DOMAIN_MODEL_AND_LIFECYCLE.md) Section 2 & 3.

### 1. Canonical Row Serialization $C(r)$
$$C(r) = \text{UTF-8}\left( \bigparallel_{k \in \text{sorted}(\text{columns})} \left( k \parallel \text{"="} \parallel S(r[k]) \parallel \text{"\|"} \right) \right)$$
- Null: `\x00_NULL_\x00`
- Boolean: `"TRUE"` or `"FALSE"`
- Integer: ASCII decimal string (`"42"`)
- Float: IEEE-754 normalized to 6 fixed decimal places (`f"{v:.6f}"`); `-0.0` normalized to `"0.000000"`; `NaN` $\rightarrow$ `\x00_NAN_\x00`; `+inf` $\rightarrow$ `\x00_POSINF_\x00`; `-inf` $\rightarrow$ `\x00_NEGINF_\x00`.
- String: Unicode NFC normalized, case-preserved, un-trimmed.
- Date/Timestamp: ISO-8601 UTC string.

### 2. Order-Independent Multiset Hash $H_{\text{multiset}}(D)$
$$H_{\text{multiset}}(D) = \left( \sum_{r \in D} \text{int}(h(r)) \right) \pmod{2^{256}}$$
- Permuting row order leaves $H_{\text{multiset}}(D)$ invariant.
- Duplicate rows contribute $k \times \text{int}(h(r))$, preserving exact multiplicity.
- **Unified Schema Inference (P1-02):** When `columns is None`, the column schema is inferred as the sorted union of keys across **all** records:
  $$\text{resolved\_cols} = \text{sorted}\left( \bigcup_{r \in D} \text{keys}(r) \right)$$
  This guarantees that records with heterogeneous or evolving key sets produce identical multiset hashes regardless of row ordering or dictionary key insertion order.
- **Explicit Schema Preservation:** When `columns` is explicitly supplied, only the specified columns are serialized; unlisted fields are omitted and missing fields are encoded as `\x00_NULL_\x00`.

### 3. Replay Manifest SHA-256 Validation (P2-03)
- `ManifestInput.content_hash` and `ManifestInput.multiset_hash` strictly enforce 64-character hexadecimal format validation (`validate_sha256_hex`).
- Rejects invalid lengths, non-hexadecimal characters, empty strings, and leading/trailing whitespace without silent data mutation.

### 4. Atomic Storage Vault (`ArtifactStorageVault`)
- Intermediate artifacts are written to a temporary file: `tmp/{uuid}.tmp`.
- Buffers are flushed and committed via `os.fsync()`.
- SHA-256 checksum is computed from the completed file.
- Atomically published via `os.replace` to `artifacts/{sha256}.parquet`.
- Path traversal check (`validate_safe_path`) blocks directory escapes.

---

## 8. Resource Limits & Known Limitations

Conforms to `SPEC-MOD-09` 8-Column Matrix.

| Resource | Unit & Limit | Enforcement | Failure Behavior |
| :--- | :--- | :--- | :--- |
| **Raw CSV File Size** | 50 MB (Decimal: $50 \times 10^6$ bytes) | Ingestion gate | `FILE_SIZE_LIMIT_EXCEEDED` |
| **Row Count** | 500,000 rows | Parser line iterator | `ROW_COUNT_LIMIT_EXCEEDED` |
| **Column Count** | 100 columns | Header parser | `COLUMN_COUNT_LIMIT_EXCEEDED` |
| **Cell Length** | 4,096 Unicode characters | Field buffer | `CELL_LENGTH_LIMIT_EXCEEDED` |
| **Line Byte Length** | 65,536 bytes (64 KB) | Line reader | `LINE_LENGTH_EXCEEDED` |
| **Process RSS Ceiling** | 512 MiB ($512 \times 2^{20}$ bytes) | Process watcher | `OUT_OF_MEMORY_SAFEGUARD` |
| **DuckDB Working Memory** | 256 MiB | DuckDB configuration | Buffer spill to temporary disk |
| **Step Timeout** | 120 seconds | Async coordinator | `STEP_EXECUTION_TIMEOUT` |
| **Expression Timeout** | 1.0 second per batch | Evaluator loop | `EXPRESSION_EVALUATION_TIMEOUT` |
| **Preflight Disk Check** | $> 100$ MB free storage | Preflight admission | `INSUFFICIENT_DISK_SPACE_ERROR` |

---

## 9. Milestone 2.0 Engine Architecture (Comparator, Diagnostics & Benchmarks)

### 9.1 Forensic Tabular Comparator (`data_rewind.comparator`)
The forensic comparator implements all 15 operational comparison cases specified in Section 1 of `SPEC-MOD-04`:
- **Case 1 & 2:** Keyed comparison with unique primary key or composite keys via relational outer joins.
- **Case 3 & 4:** Null key isolation into `INVALID_KEY_ROWS` and duplicate key detection with automatic fallback to Keyless Multiset comparison.
- **Case 5, 6, 7:** Keyless multiset (bag) comparison comparing hash frequency distributions $\min(f_A, f_B)$, reordered row classification (`IDENTICAL_MULTISET_REORDERED`), and multiplicity preservation.
- **Case 8:** Partition completeness invariant enforced on every comparison:
  $$|\mathcal{I}| + |\mathcal{M}| + |\mathcal{R}| == |D_A| \quad \land \quad |\mathcal{I}| + |\mathcal{M}| + |\mathcal{A}| == |D_B|$$
- **Case 9 & 10:** Column additions, removals (`ADDED_COLUMNS`, `REMOVED_COLUMNS`), and type coercion with breaking type drift detection.
- **Case 11 & 12:** Floating-point tolerance ($|a - b| \le \text{atol} + \text{rtol} \times |b|$) with configurable defaults ($10^{-6}, 10^{-5}$) and exact 64-bit integer/decimal preservation.
- **Case 13 & 14:** NaN vs Null vs Inf distinction (surfacing `NON_FINITE_FLOAT_WARNING` and `NUMERIC_CORRUPTION`) and NFC Unicode string normalization.
- **Case 15:** Deterministic dataset fingerprints:
  $$H_{\text{fingerprint}}(D) = \text{SHA-256}(\text{SchemaHash} \parallel H_{\text{multiset}}(D) \parallel |D|)$$
- **Dual Execution Modes:** Pure in-memory Python list comparison (`TabularComparator.compare`) and high-throughput vectorized DuckDB SQL outer joins (`TabularComparator.compare_tables`).

### 9.2 Earliest Observable Divergence (EOD) & Diagnostic Rules (`data_rewind.diagnostics`)
- **EOD Detection Engine (`EODDetector`):** Isolates the earliest topological node where outputs diverged. Handles missing intermediate checkpoints (`COARSE_GRAINED_EOD`), independent concurrent divergent branches (`CONCURRENT_DIVERGENCE_POINTS`), upstream input data drift, and non-deterministic transformations.
- **The Six Diagnostic Rules (`DiagnosticRuleEngine`):**
  - **DR-01:** `UPSTREAM_INPUT_DATA_DRIFT` (Evidence Tier: `CAUSAL_HYPOTHESIS_INPUT_DRIFT`)
  - **DR-02:** `ARITHMETIC_EXPRESSION_MUTATION` (Evidence Tier: `CAUSAL_HYPOTHESIS_DIRECT_CODE_DIFF`)
  - **DR-03:** `UNMATCHED_JOIN_DROP` (Evidence Tier: `PROVEN_OBSERVATION`)
  - **DR-04:** `DUPLICATION_CARDINALITY_BURST` (Evidence Tier: `PROVEN_OBSERVATION`)
  - **DR-05:** `NULL_SENTINEL_SURGE` (Evidence Tier: `PROVEN_OBSERVATION`)
  - **DR-06:** `NONDETERMINISTIC_TRANSFORMATION` (Evidence Tier: `PROVEN_OBSERVATION`)

### 9.3 Reproducible Benchmark Protocol (`data_rewind.benchmarks`)
- **CLI Command:** `data-rewind benchmark [--quick] [--output <path>]`
- **Instrumentation:** Wall-clock elapsed time measured via `time.perf_counter_ns()`, RSS memory sampled at 5-10ms intervals via `psutil`.
- **Target Verification:** 500,000-row relational outer joins verified at **~515 ms** (provisional target: $< 1.5$s) and **~103.7 MiB** peak $\Delta\text{RSS}$ (provisional target: $< 120$ MiB).

---

## 10. Explicit Non-Goals for Milestone 2.0

The following capabilities are governed by subsequent roadmap milestones:
- BFS graph taint propagator for lineage blast radius (Milestone 3.0).
- Historical replay orchestrator (Milestone 3.0).
- Tri-run fix verification (Milestone 4.0).
- Forensic dossier export (Milestone 4.0).
- React/Vite/Tailwind frontend & `@xyflow/react` lineage canvas (Milestone 5.0).
- Full CSV upload REST API endpoints (Milestone 5.0).

---

## 11. Next Milestone Prerequisites (Milestone 3.0)

With Milestone 2.0 completed and verified (124 passing unit/regression tests, 94.15% branch coverage, passing benchmark protocol), the project is ready for **Milestone 3.0 (Lineage Graph Blast Radius & Replay Orchestrator)**:
1. Implement breadth-first graph taint propagation to assess downstream impact of identified EOD nodes.
2. Implement isolated historical execution replay coordinator.
3. Validate deterministic node rerun checkpoints with DuckDB persistence.
