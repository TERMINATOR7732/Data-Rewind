# Data Rewind — Milestone 1.0.1: Independent Core Engine Audit Report

**Document Version:** 1.0.0  
**Milestone:** 1.0.1 (Independent Core Engine Audit, Security Verification, and Specification Conformance)  
**Audit Role:** Independent Technical Auditor (Non-Author Perspective)  
**Date:** October 2026  
**Project Category:** Data Engineering, Pipeline Lineage, Reproducibility, Regression Investigation  
**Tagline:** *Understand the past. Verify the present.*  
**Canonical Specification:** Version `1.2.0-FINAL-CLOSURE`  

---

## 1. Executive Verdict

### **VERDICT: CONDITIONAL PASS — REMEDIATION REQUIRED BEFORE MILESTONE 2.0**

The Milestone 1.0 core engine foundations deliver a solid, disciplined, and genuinely functional baseline. The prior claims—80 passing automated tests, 93.96% true branch coverage, clean Ruff linting and formatting, strict Mypy type-safety, and working smoke test and CLI diagnostics—were **independently re-executed and verified as factual**.

Zero **P0 (Critical)** vulnerabilities were detected: the anti-RCE invariant is strictly maintained (zero occurrences of `eval`, `exec`, `compile`, or dynamic imports), filesystem operations are properly jailed to the workspace root via `is_relative_to`, and DuckDB queries strictly enforce parameter binding.

However, the independent audit discovered **two P1 (High)** and **three P2 (Medium)** architectural issues that must be remediated before building the Milestone 2.0 Tabular Comparator:
1. **[P1-01] Evaluator Batch Timeout Blindspot on Sub-100 Row Batches:** `evaluate_batch` only evaluates timeout elapsed time every 100 rows (`idx % 100 == 0 and idx > 0`). Batches containing fewer than 100 rows completely bypass the 1.0-second timeout check.
2. **[P1-02] Multiset Hash Key Derivation on Heterogeneous Keyless Records:** When `columns is None`, `compute_multiset_hash` derives keys solely from `rows[0].keys()`. If subsequent rows introduce new or differing keys, those columns are silently dropped from the hash.
3. **[P2-01] Non-Preemptive AST Interpreter Execution:** In-thread AST evaluation cannot preemptively interrupt an in-flight CPU-bound calculation mid-expression without worker process boundaries.
4. **[P2-02] Single-Connection DuckDB Concurrency Constraint:** `DuckDBRuntime` wraps a single connection without a mutex; concurrent task execution requires per-thread instantiation.
5. **[P2-03] Incomplete Hash Format Validation in ReplayManifest Inputs:** `ManifestInput` lacks 64-character hex validation on its inner `content_hash` and `multiset_hash` fields.

---

## 2. Audit Scope and Actual Files Inspected

The following files were inspected in full (line-by-line semantic analysis):

### 1. Specification & Governance Package (`docs/spec/`)
- `docs/spec/SPECIFICATION.md` (Master PRD v1.2.0-FINAL-CLOSURE)
- `docs/spec/00_INDEX_AND_EXECUTIVE_SUMMARY.md` through `10_ROADMAP_DEPLOYMENT_AND_DECISION_REGISTER.md`
- `docs/spec/milestone_0_3_final_specification_closure_report.md`
- `docs/reports/milestone_1_0_core_engine_foundations_report.md`

### 2. Core Implementation Source Code (`src/data_rewind/`)
- `src/data_rewind/core/domain/models.py` (Domain entities, value objects, schemas, enums)
- `src/data_rewind/core/domain/lifecycle.py` (Finite state machine, terminal locks, heartbeat checks)
- `src/data_rewind/core/domain/errors.py` (Structured exception hierarchy & diagnostic codes)
- `src/data_rewind/core/dag/models.py` (DAG node, edge, and result definitions)
- `src/data_rewind/core/dag/validator.py` (Kahn's algorithm, cycle DFS, tie-breaking, descendants BFS)
- `src/data_rewind/core/expr/ast_sandbox.py` (AST visitor, syntax allowlist, complexity bounds)
- `src/data_rewind/core/expr/evaluator.py` (Pure recursive AST evaluator, batch evaluator, pure functions)
- `src/data_rewind/core/db/duckdb_runtime.py` (DuckDB connection lifecycle, limits, transactions)
- `src/data_rewind/core/integrity/serialization.py` (Canonical row normalizer $S(v)$ & byte serializer $C(r)$)
- `src/data_rewind/core/integrity/hashing.py` (Row SHA-256 $h(r)$, multiset hash $H_{\text{multiset}}(D)$)
- `src/data_rewind/core/integrity/manifest.py` (ReplayManifest bundle & JSON codec)
- `src/data_rewind/core/integrity/storage.py` (ArtifactStorageVault, path jail `validate_safe_path`)
- `src/data_rewind/core/config/settings.py` (Settings, ResourceLimits, profile loader)
- `src/data_rewind/core/config/guards.py` (ResourceGuards for 8-column limits matrix)
- `src/data_rewind/cli.py` (Diagnostic CLI)
- `src/data_rewind/smoke_test.py` (8-step integration smoke test)

### 3. Test Suites & Environment (`tests/`)
- `tests/conftest.py`, `test_domain.py`, `test_lifecycle.py`, `test_dag.py`, `test_ast_security.py`
- `tests/test_duckdb_runtime.py`, `tests/test_integrity.py`, `tests/test_resource_guards.py`
- `tests/test_integration.py`, `tests/test_cli_and_smoke.py`
- `pyproject.toml`, `requirements.txt`, `requirements-dev.txt`, `.gitignore`, `.github/workflows/ci.yml`

---

## 3. Environment and Baseline Verification

All quality gates and baseline claims were independently executed in PowerShell under `.venv` (`Python 3.12.0` on Windows 11 Enterprise x86_64).

| Quality Gate | Command Executed | Claimed Result | Independently Verified Result | Exit Code |
| :--- | :--- | :--- | :--- | :--- |
| **Python Version** | `.venv\Scripts\python.exe --version` | Python 3.12.0 | `Python 3.12.0` | `0` |
| **Installed Packages** | `.venv\Scripts\pip.exe list` | duckdb 2.0.0, pydantic 2.14.1, psutil 7.2.2 | Verified matching pinned versions | `0` |
| **Unit & Integration Tests** | `pytest -v --cov=data_rewind` | 80 passed | **80 passed in 1.21s** | `0` |
| **Branch Coverage** | `pytest-cov --cov-report=term-missing` | 93.96% branch coverage | **93.96% verified** (1287 stmts, 336 branches) | `0` |
| **Ruff Linter** | `ruff check src tests` | All checks passed | **All checks passed!** (0 errors) | `0` |
| **Ruff Formatter** | `ruff format --check src tests` | 34 files formatted | **34 files already formatted** | `0` |
| **Mypy Type Check** | `mypy src` (Strict mode) | 0 errors in 24 files | **Success: no issues found in 24 source files** | `0` |
| **Smoke Test** | `python -m data_rewind.smoke_test` | 8 phases passed (Exit 0) | **All 8 phases passed [100% OK]** | `0` |
| **CLI Diagnostics** | `python -m data_rewind.cli diagnostics` | Workspace & disk pass | **Base workspace & disk pass verified** | `0` |

---

## 4. Specification-Conformance Matrix

| Spec Requirement | Expected Specification Behavior | Implemented Component | Existing Tests | Audit Evidence | Conformance Verdict |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Domain Entities** (`SPEC-MOD-02` §1) | Explicit types for Runs, Steps, Artifacts, Schemas, Columns. | `core.domain.models` | `test_domain.py` | Validated field types, immutability, unique columns. | **PASS** |
| **Lifecycle FSM** (`SPEC-MOD-02` §3.1) | Strict state transitions (`PENDING` $\rightarrow$ `RUNNING` $\rightarrow$ terminal); terminal states immutable. | `core.domain.lifecycle` | `test_lifecycle.py` | Illegal jumps and re-runs raise `InvalidLifecycleTransitionError`. | **PASS** |
| **Heartbeat Tracking** (`SPEC-MOD-02` §3.1) | Heartbeat updates every 5s; timeout $> 60$s triggers `INTERRUPTED`. | `core.domain.lifecycle` | `test_lifecycle.py` | `is_heartbeat_lost` passes fresh heartbeats, flags stale runs $> 60$s. | **PASS** |
| **Kahn's DAG Ordering** (`SPEC-MOD-03` §1.1) | Deterministic topological sort with lexicographical tie-breaking. | `core.dag.validator` | `test_dag.py` | Tested 20 random input shuffles; all yielded identical order. | **PASS** |
| **DAG Cycle Diagnostics** (`SPEC-MOD-03` §1.1) | Cycle detection with exact path extraction. | `core.dag.validator` | `test_dag.py` | DFS path extraction verified on transitive cycle ($A \rightarrow B \rightarrow C \rightarrow A$). | **PASS** |
| **AST Anti-RCE Rule** (`SPEC-MOD-06` §3) | Zero occurrences of `eval`, `exec`, `compile`, dynamic imports. | `core.expr.ast_sandbox` | `test_ast_security.py` | Codebase text search and AST visitor reject 18 hostile payloads. | **PASS** |
| **AST Complexity Bounds** (`SPEC-MOD-06` §3.2) | Depth $\le 10$, nodes $\le 50$, string length $\le 1,000$. | `core.expr.ast_sandbox` | `test_ast_security.py` | Boundaries tested immediately at and above limits. | **PASS** |
| **Batch Timeout** (`SPEC-MOD-06` §3.2) | 1.0s timeout per row batch. | `core.expr.evaluator` | `test_ast_security.py` | Works when `len(rows) >= 100`, **bypassed when $< 100$ rows**. | **PARTIAL (P1-01)** |
| **Path Traversal Jail** (`SPEC-MOD-06` §4) | Canonical resolution and workspace containment. | `core.integrity.storage` | `test_integrity.py` | Resolves canonical paths; blocks directory traversal (`../`). | **PASS** |
| **Atomic Checkpoints** (`SPEC-MOD-02` §3.2) | Write `.tmp` $\rightarrow$ `fsync` $\rightarrow$ SHA-256 $\rightarrow$ `os.replace`. | `core.integrity.storage` | `test_integrity.py` | Durability sequence verified; unlinks orphan `.tmp` on failure. | **PASS** |
| **Canonical Bytes $C(r)$** (`SPEC-MOD-02` §2.1) | Normalizer $S(v)$ sorting columns, normalizing IEEE-754 floats to 6 decimals. | `core.integrity.serialization` | `test_integrity.py` | Verified on null, bool, int, float, float NaN/inf/-0.0, strings, dates. | **PASS** |
| **Multiset Hash $H_{\text{multiset}}$** (`SPEC-MOD-02` §2.2) | Order-independent row multiset digest modulo $2^{256}$. | `core.integrity.hashing` | `test_integrity.py` | Invariant under 10 shuffles; sensitive to duplicate multiplicity. | **PARTIAL (P1-02)** |
| **DuckDB Connection & Limits** (`SPEC-MOD-07` §1) | In-process engine, parameter binding, memory capped at 256 MiB. | `core.db.duckdb_runtime` | `test_duckdb_runtime.py` | Verified parameter binding (`?`), rollback on error, query isolation. | **PASS** |
| **Resource Limits Matrix** (`SPEC-MOD-09` §1) | 50 MB raw upload, 500k rows, 100 cols, 512 MiB RSS, $>100$ MB disk. | `core.config.guards` | `test_resource_guards.py` | Tested at, below, and above hard limits without silent truncation. | **PASS** |

---

### Reconciliation: The "8-Column Matrix" vs. 100-Column Dataset Limit

The prompt directed an explicit audit of the phrase *"8-column matrix limit"* to resolve potential confusion with the 100-column dataset limit:
- **Clarification:** The *"8-column matrix"* refers strictly to the **documentation format of the specification table** in `SPEC-MOD-09` Section 1, which defines 8 metadata attributes for every operational limit (Resource, Unit, Tier, Location, Behavior, Diagnostic, Evidence, Limitations).
- **Dataset Capacity Limit:** The actual dataset width constraint is **100 columns** (`ResourceLimits.max_column_count = 100`), verified in `settings.py`, `guards.py`, `cli.py`, and `test_resource_guards.py`.
- **Verdict:** There is zero architectural contradiction; the 100-column dataset limit is faithfully implemented.

---

## 5. AST Sandbox Security Findings (Audit C)

### C1. Prohibited Execution Capabilities
- **Verification:** An exhaustive AST search of `src/data_rewind/` proves that `eval()`, `exec()`, `compile()`, and `__import__()` are completely absent.
- **Dispatch Mechanism:** `ASTEvaluator` evaluates expressions through a pure recursive Python function (`_eval_node`), dispatching solely to verified arithmetic operators and an allowlist of 9 pure functions (`abs`, `round`, `upper`, `lower`, `trim`, `coalesce`, `if_else`, `date_diff`, `len`).
- **Forbidden AST Types:** `ast.Attribute` (blocking `.__class__`), `ast.Subscript` (blocking indexing), `ast.Lambda`, `ast.Import`, `ast.ImportFrom`, and container displays (`List`, `Dict`, `Set`, `Tuple`) are rejected at parse time.

### C2. Static Complexity Bounds
Boundary tests confirmed:
- Raw expression string length $> 1,000$ characters triggers `ExpressionComplexityError`.
- AST depth $> 10$ levels triggers `ExpressionComplexityError`.
- AST node count $> 50$ nodes triggers `ExpressionComplexityError`.
- String multiplication (`'A' * 1000`) is blocked with `STRING_MULTIPLICATION_BLOCKED`.
- Exponentiation (`**` / `Pow`) is unconditionally rejected with `EXPRESSION_SECURITY_ERROR`.

### C3. Defect Analysis: Batch Timeout Check Interval (Finding P1-01)
- **Vulnerability Location:** `src/data_rewind/core/expr/evaluator.py`, lines 145–153.
- **Defect:** `elapsed` time is checked only when `idx % 100 == 0 and idx > 0`.
- **Consequence:** For any dataset batch where `len(rows) < 100` (e.g. 1 to 99 rows), the timeout check is **never reached**. If evaluating 99 rows requires 10 seconds, the batch executes without interruption. Furthermore, if a single row computation takes 5 seconds, it blocks the thread without cooperative interruption.

---

## 6. Filesystem and Artifact-Storage Findings (Audit D)

### D1. Path Jail and Symlink Containment
- **Mechanism:** `validate_safe_path` resolves paths via `target_path.resolve(strict=False)` and checks containment against `workspace_root.resolve(strict=True)` using `is_relative_to`.
- **Traversal Defense:** Paths containing `../` or pointing outside the workspace directory raise `PathTraversalError`.
- **Limitation:** On NTFS (Windows), Alternate Data Streams (`file.parquet:stream`) resolve within the folder hierarchy, but standard open operations could target alternate streams if an attacker controlled filename extensions. In Data Rewind, artifact filenames are strictly generated by the backend (`f"{content_hash}.parquet"`), neutralizing user extension injection.

### D2. Atomicity & Durability Sequence
The publication sequence conforms to ACID principles:
1. Write payload to unique temporary file (`tmp/{uuid}_{prefix}.tmp`).
2. `f.flush()` followed by `os.fsync(f.fileno())` flushes OS dirty pages to hardware storage.
3. Compute SHA-256 content hash on the flushed file.
4. Atomic replacement via `os.replace(temp_path, target_path)`.
5. In `finally` block: unlinks `.tmp` if replacement did not occur.

---

## 7. Canonical Serialization and Hashing Findings (Audit E)

### E1. Type Normalizer Invariants
- `bool` vs `int`: Handled correctly (`isinstance(value, bool)` checked before `int`).
- `datetime` vs `date`: Handled correctly (`datetime` checked before `date`).
- Floats: Normalized to 6 decimal places (`f"{value:.6f}"`); `-0.0` normalized to `"0.000000"`; `NaN` normalized to `"\x00_NAN_\x00"`.
- Unicode: Normalized to NFC form via `unicodedata.normalize("NFC", value)`.

### E2. Defect Analysis: Key Derivation in Multiset Hashing (Finding P1-02)
- **Vulnerability Location:** `src/data_rewind/core/integrity/hashing.py`, line 48:
  ```python
  resolved_cols = columns if columns is not None else sorted(rows[0].keys())
  ```
- **Defect:** When `columns` is omitted, `resolved_cols` is derived exclusively from `rows[0]`.
- **Consequence:** If subsequent rows contain keys not present in `rows[0]`, those columns are completely omitted from $C(r)$ and excluded from the multiset digest. While tabular pipelines usually have uniform schemas, passing heterogeneous dictionaries causes silent data loss in fingerprinting.

### E3. Cryptographic Analysis of Modular Addition Multiset Hashing
- **Mathematical Form:** $H_{\text{multiset}}(D) = \left( \sum_{r \in D} \text{int}(h(r)) \right) \pmod{2^{256}}$
- **Commutativity & Multiplicity:** The additive group $\mathbb{Z}_{2^{256}}$ is strictly commutative and associative, proving order-independence while preserving duplicate multiplicity ($k \cdot h(r)$).
- **Collision Resistance Assessment:** Because SHA-256 is modeled as a random oracle, finding two distinct multisets summing to the same 256-bit integer without preimage knowledge corresponds to the Generalized Birthday Problem ($k$-sum problem). While sub-exponential algorithms (e.g. Wagner's algorithm) exist for large $k$, finding colliding multiset sums for realistic dataset cardinalities remains computationally infeasible ($> 2^{128}$ operations).
- **Conclusion:** Modular sum multiset hashing is mathematically valid and appropriate for integrity verification, provided it is not treated as a physical recovery mechanism for deleted files (as disclaimed in `SPEC-MOD-02` §2.2).

---

## 8. DuckDB and Resource-Enforcement Findings (Audit F)

### F1. What `SET max_memory = '256MB'` Constrains vs. Does Not Constrain
- **What it constrains:** DuckDB's in-process buffer manager (intermediate query hash tables, sort buffers, join partitions). When query requirements exceed 256 MiB, DuckDB automatically spills partitions to disk (`tmp_directory`).
- **What it does NOT constrain:**
  1. Python runtime heap memory (Pydantic models, in-memory dictionaries, AST nodes).
  2. Operating system page cache.
  3. Resident Set Size (RSS) of the host Python process.
- **Enforcement Architecture:** Data Rewind correctly does not claim DuckDB alone constrains process memory; process RSS is governed separately by `ResourceGuards.check_process_memory` sampling `psutil` against the 512 MiB process ceiling.

---

## 9. Domain and Lifecycle Findings (Audit G)

- **Immutability:** Domain entities inherit from `pydantic.BaseModel` with `model_config = ConfigDict(frozen=True)`. Attempting to mutate fields raises `ValidationError`.
- **Terminal State Lock:** Once a run enters `COMPLETED`, `FAILED`, `CANCELLED`, or `INTERRUPTED`, `LifecycleStateMachine.validate_transition` raises `InvalidLifecycleTransitionError` on any further transition attempt.
- **Heartbeat Expiration:** `is_heartbeat_lost` correctly detects missing heartbeats beyond the 60-second window, enabling startup recovery of interrupted runs.

---

## 10. DAG Correctness and Determinism Findings (Audit H)

- **Kahn's Ordering:** In-degree zero nodes are managed via `heapq`, using lexicographical string sorting of `step_id` as the deterministic tie-breaker.
- **Cycles:** Direct self-dependencies ($A \rightarrow A$) are detected immediately; transitive multi-node cycles ($A \rightarrow B \rightarrow C \rightarrow A$) are extracted via DFS and reported with full path diagnostics.
- **Cardinality Validation:** `join_datasets` is strictly enforced to receive exactly 2 input edges; single-input operations (`filter_rows`, `derive_column`, etc.) are enforced to receive exactly 1 input edge.

---

## 11. Test Quality and Coverage Findings (Audit I)

- **Test Suite Metrics:** 80 tests passing in 1.21s.
- **Coverage Configuration:** `branch = true` is enabled in `pyproject.toml`. The reported **93.96% coverage is genuine branch coverage**, not statement-only coverage.
- **Assertion Rigor:** Tests assert specific error codes (`CYCLIC_DEPENDENCY_ERROR`, `PATH_TRAVERSAL_BLOCKED`, `EXPRESSION_SECURITY_ERROR`), exact output values, and deterministic permutation invariants. No mock-heavy hollow assertions were found.

---

## 12. Packaging, Documentation, and CI Findings (Audit J)

- **Clean Installation:** `pip install -e .` completes cleanly with PEP 621 build backend (`setuptools.build_meta`).
- **Zero Secrets / Absolute Paths:** Codebase search confirmed zero hardcoded developer directories (`C:\Users\...`) or API keys.
- **CI Configuration:** `.github/workflows/ci.yml` properly tests across an OS matrix (`ubuntu-latest`, `windows-latest`) and Python matrix (`3.11`, `3.12`) with strict coverage thresholds (`--cov-fail-under=90`).
- **Remote CI State:** The workflow file exists and syntax is verified, but **no remote GitHub Actions run has executed** because the project has not yet been pushed to a remote repository.

---

## 13. Comprehensive Defect Register (Grouped by Severity)

### Priority P0 — Critical (0 Defects Found)
*No critical vulnerabilities or remote code execution risks found.*

---

### Priority P1 — High (Must Remediate Before Milestone 2.0)

#### [P1-01] Evaluator Batch Timeout Blindspot on Batches Under 100 Rows
- **Affected File:** `src/data_rewind/core/expr/evaluator.py`, lines 145–153.
- **Exact Code:**
  ```python
  if idx % check_interval == 0 and idx > 0:
      elapsed = time.perf_counter() - start_time
      if elapsed > timeout_seconds:
          raise ExpressionTimeoutError(...)
  ```
- **Reproduction:** Call `ASTEvaluator.evaluate_batch` with 99 rows where each row takes 0.05 seconds. The total elapsed time is 4.95 seconds ($> 1.0$s budget), but `ExpressionTimeoutError` is never raised.
- **Consequence:** Short batches can monopolize CPU execution without triggering the timeout boundary.
- **Recommended Remediation:** Use a dynamic check interval: `interval = max(1, min(100, len(rows) // 10))`, and add a post-batch elapsed time check.

#### [P1-02] Multiset Hash Key Derivation Drops Columns When Schema Is Omitted
- **Affected File:** `src/data_rewind/core/integrity/hashing.py`, line 48.
- **Exact Code:**
  ```python
  resolved_cols = columns if columns is not None else sorted(rows[0].keys())
  ```
- **Reproduction:** Call `compute_multiset_hash([{"a": 1}, {"a": 1, "b": 2}])` without passing `columns`. The resulting hash for the second row evaluates only column `"a"`, silently ignoring `"b"`.
- **Consequence:** Keyless datasets with differing dictionary keys produce inaccurate multiset hashes.
- **Recommended Remediation:** If `columns is None`, derive the sorted union of all keys across all records: `sorted({k for r in rows for k in r.keys()})`.

---

### Priority P2 — Medium (Remediate Before Dependent Components Use It)

#### [P2-01] In-Thread AST Evaluation Cannot Preemptively Abort Hung Computations
- **Affected File:** `src/data_rewind/core/expr/evaluator.py`.
- **Finding:** AST evaluation executes synchronously in the host thread. A single pathologically complex expression can only be caught if the timeout check is reached; it cannot be preemptively interrupted mid-row.
- **Recommended Remediation:** Document that preemptive worker process isolation is scheduled for the Milestone 5.0 execution coordinator.

#### [P2-02] Single-Connection `DuckDBRuntime` Lacks Concurrency Protection
- **Affected File:** `src/data_rewind/core/db/duckdb_runtime.py`.
- **Finding:** A single `DuckDBRuntime` instance wraps one connection without a threading lock. If shared across async threads, native DuckDB concurrency errors could occur.
- **Recommended Remediation:** Add a threading lock or document that each concurrent execution task must instantiate its own isolated `DuckDBRuntime`.

#### [P2-03] `ManifestInput` Schema Does Not Validate Hash String Formats
- **Affected File:** `src/data_rewind/core/integrity/manifest.py`, lines 34–43.
- **Finding:** `ManifestInput` declares `content_hash: str` and `multiset_hash: str` without validating that they are valid 64-character hex digests.
- **Recommended Remediation:** Add Pydantic field validators to `ManifestInput` ensuring input hashes conform to SHA-256 hex format.

---

### Priority P3 — Low (Minor Cleanup)

#### [P3-01] Missing Ingestion-Time Binding for Resource Guards
- **Affected File:** `src/data_rewind/core/config/guards.py`.
- **Finding:** `ResourceGuards` contains unit-tested methods (`validate_file_size`, `validate_row_count`, etc.), but CSV ingestion streaming integration is deferred to Milestone 2.0.
- **Remediation:** Wire `ResourceGuards` directly into the streaming CSV parser in Milestone 2.0.

#### [P3-02] `descendants` BFS Traversal on Cyclic Graphs Can Self-Include
- **Affected File:** `src/data_rewind/core/dag/validator.py`, lines 185–205.
- **Finding:** If `get_descendants` is invoked on an unvalidated graph with a cycle back to `root_step_id`, the root node is added to its own descendants set.
- **Remediation:** Filter `root_step_id` out of the final returned descendants set.

---

## 14. Exact Commands Executed & Verified Outputs

```powershell
# 1. Environment & Package Verification
.venv\Scripts\python.exe --version
# Output: Python 3.12.0 [Exit 0]

# 2. Automated Test Suite & True Branch Coverage
.venv\Scripts\python.exe -m pytest -v --cov=data_rewind --cov-report=term-missing
# Output: 80 passed in 1.21s, Total coverage: 93.96% [Exit 0]

# 3. Linter Check
.venv\Scripts\ruff.exe check src tests
# Output: All checks passed! [Exit 0]

# 4. Formatter Check
.venv\Scripts\ruff.exe format --check src tests
# Output: 34 files already formatted [Exit 0]

# 5. Strict Type Check
.venv\Scripts\mypy.exe src
# Output: Success: no issues found in 24 source files [Exit 0]

# 6. Foundations Smoke Test
.venv\Scripts\python.exe -m data_rewind.smoke_test
# Output: ALL CORE ENGINE FOUNDATION SMOKE TESTS PASSED [100% OK] [Exit 0]

# 7. Local Diagnostics CLI
.venv\Scripts\python.exe -m data_rewind.cli diagnostics
# Output: Workspace Accessible: YES, Disk Admission Gate: PASS (> 100 MB free) [Exit 0]
```

---

## 15. Remaining Unverified Claims

1. **500k-Row Diff Benchmarks:** The performance figures ($< 1.5$s execution time, $< 120$ MiB diff memory) remain **unverified provisional targets**. Full measurement will occur under the formal Reproducible Benchmark Protocol in Milestone 2.0.
2. **Remote CI Pipeline:** While `.github/workflows/ci.yml` is syntactically valid and all checks pass locally on Windows, execution on GitHub Actions cloud infrastructure (Ubuntu runner) is unverified until a remote repository is authorized and pushed.

---

## 16. Prioritized Remediation Recommendations

Before beginning feature implementation for Milestone 2.0, complete this minimal 5-point remediation:

1. **Remediate P1-01 (Batch Timeout Interval):** In `evaluator.py`, calculate `check_interval = max(1, min(100, len(rows) // 10))` and check elapsed time after the loop to ensure sub-100 row batches enforce the 1.0s limit.
2. **Remediate P1-02 (Multiset Hash Column Union):** In `hashing.py`, when `columns is None`, compute `resolved_cols = sorted({k for r in rows for k in r.keys()})` to prevent key omission.
3. **Remediate P2-03 (Manifest Hash Validation):** In `manifest.py`, enforce 64-character hex validation on `ManifestInput.content_hash` and `multiset_hash`.
4. **Document P2-01 and P2-02 (Concurrency & Isolation):** Document in `DEVELOPER_GUIDE.md` that multi-threaded task coordinators require independent `DuckDBRuntime` connections.
5. **Re-run Quality Gates:** Execute `pytest`, `ruff`, and `mypy` to verify that all 80+ tests pass with zero regressions.

---

## 17. Decision on Readiness for Milestone 2.0

### **DECISION: READY FOR MILESTONE 2.0 UPON RESOLUTION OF P1-01 AND P1-02**

The architectural foundation is sound, strictly typed, modular, and fully aligned with the canonical specification. Resolving the two P1 defects is a focused, low-risk remediation (~15 lines of code) that guarantees complete robustness for the upcoming Milestone 2.0 Tabular Comparator.

---

## 18. Mandatory Boundary Confirmations

I formally confirm:
- [x] **Zero application source code was modified during this audit.**
- [x] **Zero existing tests were modified or weakened.**
- [x] **Zero packages or dependencies were installed or altered.**
- [x] **Zero Git commits or remote pushes were executed.**
- [x] **Sister projects (`Integris`, `CodeShip`, `Opwise`, `PathForge`) remain 100% untouched.**
- [x] **All findings are backed by actual command output and code inspection.**

---

*End of Milestone 1.0.1 Independent Audit Report.*
