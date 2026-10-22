# Data Rewind — Milestone 1.0.2: Targeted Core Engine Remediation, Regression Testing, and Verification Report

**Document Version:** 1.0.0  
**Milestone:** 1.0.2 (Targeted Core Engine Remediation, Regression Testing, and Verification)  
**Date:** October 2026  
**Project Category:** Data Engineering, Pipeline Lineage, Reproducibility, Regression Investigation  
**Tagline:** *Understand the past. Verify the present.*  
**Canonical Specification:** Version `1.2.0-FINAL-CLOSURE`  

---

## 1. Executive Verdict

### **VERDICT: PASS**

### Basis for Verdict
All findings identified during the Milestone 1.0.1 independent audit have been rigorously addressed in strict accordance with the approved scope and the canonical specification:
1. **P1-01 (AST Batch Timeout Blindspot):** Fully resolved in `src/data_rewind/core/expr/evaluator.py`. Dynamic scaling of check intervals ($\max(1, \min(100, \lfloor N / 10 \rfloor))$) and a post-loop elapsed-time check guarantee that empty, single-row, sub-100 row, boundary, and post-interval batches strictly enforce the configured timeout.
2. **P1-02 (Heterogeneous Multiset Hash Invariance):** Fully resolved in `src/data_rewind/core/integrity/hashing.py`. When `columns is None`, schema keys are inferred as the sorted union of keys across **all** records ($\text{sorted}(\bigcup_{r \in D} \text{keys}(r))$), guaranteeing absolute permutation invariance for heterogeneous keyless records while preserving explicit schema constraints.
3. **P2-03 (ManifestInput SHA-256 Digest Validation):** Fully resolved in `src/data_rewind/core/integrity/manifest.py`. `ManifestInput` (`content_hash`, `multiset_hash`) and `ReplayManifest` (`pipeline_definition_hash`) enforce 64-character hexadecimal format validation, rejecting invalid lengths, non-hex characters, empty strings, and leading/trailing whitespace without mutating valid values.
4. **P2-01 (Non-Preemptive AST Execution Limitation):** Fully documented in `docs/DEVELOPER_GUIDE.md` Section 5 with threat model analysis, operational limitations, developer safety rules, and deferred preemption roadmap (Milestone 5.0).
5. **P2-02 (DuckDB Connection Concurrency Constraint):** Fully documented in `docs/DEVELOPER_GUIDE.md` Section 6 detailing single-connection architecture, lack of thread-safety in query/transaction execution, mandatory caller serialization, worker-isolation pattern, and single-writer file locking rules.
6. **Zero Regressions & Elevated Coverage:** Automated tests expanded from 80 to **87 passing tests** (100% pass rate in 1.34s). Branch coverage increased from 93.96% to **94.10%** (1313 statements, 348 branches), surpassing the $\ge 90.0\%$ threshold. Ruff lint, format, strict Mypy, smoke test (8/8 phases), and CLI diagnostics are 100% clean.
7. **Clean Working Tree & Zero Uncommitted Commits:** Zero commits, zero pushes, and zero external network calls.

---

## 2. Finding-by-Finding Resolution Register

| Finding ID | Severity | Title & Original Problem | Inspected Files | Changes Implemented | New Tests / Documentation | Remaining Limitation | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **P1-01** | **P1 (High)** | AST evaluator timeout check gated behind `idx % 100 == 0 and idx > 0`, allowing sub-100 row batches to bypass periodic checks and lacking a post-loop check. | `src/data_rewind/core/expr/evaluator.py`, `tests/test_ast_security.py` | Updated `evaluate_batch` to scale check frequency dynamically ($\max(1, \min(100, \lfloor N / 10 \rfloor))$) and added a post-loop monotonic clock elapsed-time verification. | Added 5 dedicated regression test functions in `tests/test_ast_security.py` covering 1-row, sub-100 row, boundary, post-loop, and empty batch behaviors. | Checks remain cooperative and execute between row iterations; single runaway expressions cannot be interrupted mid-row in-thread. | **RESOLVED** |
| **P1-02** | **P1 (High)** | In `compute_multiset_hash`, when `columns is None`, schema keys were derived solely from `rows[0].keys()`, dropping later keys and breaking permutation invariance for heterogeneous records. | `src/data_rewind/core/integrity/hashing.py`, `src/data_rewind/core/integrity/serialization.py`, `tests/test_integrity.py` | Modified `compute_multiset_hash` when `columns is None` to infer `all_keys = {k for r in rows for k in r.keys()}` and sort them into `resolved_cols`. Maintained explicit column argument behavior when supplied. | Added `test_multiset_hash_heterogeneous_keyless_records` in `tests/test_integrity.py` testing permutation invariance, dictionary insertion order invariance, explicit column preservation, and old failure reproduction. | If records contain millions of completely disjoint keys, the key union memory footprint grows proportionally; bounded by max columns limit (100). | **RESOLVED** |
| **P2-03** | **P2 (Medium)** | `ManifestInput` accepted arbitrary strings for `content_hash` and `multiset_hash` without length or hexadecimal format validation. | `src/data_rewind/core/integrity/manifest.py`, `tests/test_integrity.py` | Introduced `validate_sha256_hex` helper and added Pydantic `@field_validator` on `ManifestInput` (`content_hash`, `multiset_hash`) and `ReplayManifest` (`pipeline_definition_hash`). | Added `test_manifest_input_sha256_validation` covering valid lowercase, uppercase preservation, short/long lengths, non-hex characters, empty strings, whitespace rejection, and non-string types. | Validates syntactic representation only; cannot verify that the hash matches an external disk file without reading the target payload. | **RESOLVED** |
| **P2-01** | **P2 (Medium)** | In-thread AST evaluation cannot preempt or interrupt a single CPU-monopolizing expression mid-execution without process isolation. | `src/data_rewind/core/expr/evaluator.py`, `docs/DEVELOPER_GUIDE.md` | None (Architectural constraint documented; no code modification permitted in M1.0.2). | Documented extensively in `docs/DEVELOPER_GUIDE.md` Section 5: threat model, cooperative timeout limitations, anti-pattern warnings, and deferred preemption roadmap. | Unbounded single expressions could cause temporary thread stalls until process isolation is implemented in Milestone 5.0. | **DOCUMENTED / DEFERRED** |
| **P2-02** | **P2 (Medium)** | `DuckDBRuntime` manages a single connection without thread mutexes or transaction isolation locks; concurrent queries or transactions cause state corruption. | `src/data_rewind/core/db/duckdb_runtime.py`, `docs/DEVELOPER_GUIDE.md` | None (Architectural constraint documented; no concurrency redesign permitted in M1.0.2). | Documented extensively in `docs/DEVELOPER_GUIDE.md` Section 6: single connection model, lack of thread-safety in query/transaction execution, mandatory caller serialization, and worker isolation rules. | Multi-threaded callers cannot share a single runtime instance concurrently without external synchronization. | **DOCUMENTED / DEFERRED** |

---

## 3. Independent Verification Evidence

### A. Full Pytest Suite & Branch Coverage
Command executed:
```powershell
.\.venv\Scripts\pytest.exe -v --cov=data_rewind --cov-report=term-missing
```
Execution Output:
```
============================= test session starts =============================
platform win32 -- Python 3.12.0, pytest-9.1.1, pluggy-1.7.0
rootdir: E:\MHT CET REGISTRATION\BE\Task\DataRewind
configfile: pyproject.toml
testpaths: tests
plugins: cov-7.1.0
collected 87 items

tests\test_ast_security.py .....................................         [ 42%]
tests\test_cli_and_smoke.py ...                                          [ 45%]
tests\test_dag.py ...........                                            [ 58%]
tests\test_domain.py ......                                              [ 65%]
tests\test_duckdb_runtime.py ......                                      [ 72%]
tests\test_integration.py .                                              [ 73%]
tests\test_integrity.py ..........                                       [ 85%]
tests\test_lifecycle.py .....                                            [ 90%]
tests\test_resource_guards.py ........                                   [100%]

=============================== tests coverage ================================
_______________ coverage: platform win32, python 3.12.0-final-0 _______________

Name                                              Stmts   Miss Branch BrPart  Cover   Missing
---------------------------------------------------------------------------------------------
src\data_rewind\__init__.py                           2      0      0      0   100%
src\data_rewind\cli.py                               51      6      6      2    86%   40-41, 48-50, 81->exit, 86
src\data_rewind\core\__init__.py                      1      0      0      0   100%
src\data_rewind\core\config\__init__.py               3      0      0      0   100%
src\data_rewind\core\config\guards.py                61      5     16      1    92%   47, 51-53, 79-80
src\data_rewind\core\config\settings.py              37      0      2      0   100%
src\data_rewind\core\dag\__init__.py                  3      0      0      0   100%
src\data_rewind\core\dag\models.py                   25      0      0      0   100%
src\data_rewind\core\dag\validator.py                96      5     60      7    92%   173, 178->171, 180->171, 183-185, 188->187, 190->187, 194
src\data_rewind\core\db\__init__.py                   2      0      0      0   100%
src\data_rewind\core\db\duckdb_runtime.py           100      5     16      4    92%   72-73, 80->exit, 97, 126, 145
src\data_rewind\core\domain\__init__.py               4      0      0      0   100%
src\data_rewind\core\domain\errors.py                54      0      0      0   100%
src\data_rewind\core\domain\lifecycle.py             44      1     14      2    95%   72->78, 104
src\data_rewind\core\domain\models.py               202      0     14      0   100%
src\data_rewind\core\expr\__init__.py                 3      0      0      0   100%
src\data_rewind\core\expr\ast_sandbox.py             70      3     26      2    95%   136, 142, 219
src\data_rewind\core\expr\evaluator.py              211     18    144     20    89%   39, 73, 93, 95, 210, 216, 217->224, 234->241, 258, 262, 266, 285, 288, 297, 309, 320, 330-332, 346, 354
src\data_rewind\core\integrity\__init__.py            5      0      0      0   100%
src\data_rewind\core\integrity\hashing.py            43      1     16      1    97%   72
src\data_rewind\core\integrity\manifest.py           74      0      6      0   100%
src\data_rewind\core\integrity\serialization.py      40      1     22      1    97%   58
src\data_rewind\core\integrity\storage.py            55      6      4      0    90%   40-46
src\data_rewind\smoke_test.py                       127      6      2      1    95%   266-271, 275
---------------------------------------------------------------------------------------------
TOTAL                                              1313     57    348     41    94%
Required test coverage of 90.0% reached. Total coverage: 94.10%
============================= 87 passed in 1.34s ==============================
```

### B. Ruff Linter & Formatter Verification
Commands executed:
```powershell
.\.venv\Scripts\ruff.exe check src tests
.\.venv\Scripts\ruff.exe format --check src tests
```
Execution Output:
```
All checks passed!
34 files already formatted
```

### C. Mypy Strict Static Type Verification
Command executed:
```powershell
.\.venv\Scripts\mypy.exe src
```
Execution Output:
```
Success: no issues found in 24 source files
```

### D. End-to-End Integration Smoke Test
Command executed:
```powershell
.\.venv\Scripts\python.exe -m data_rewind.smoke_test
```
Execution Output:
```
======================================================================
DATA REWIND -- CORE ENGINE FOUNDATIONS SMOKE TEST
Tagline: Understand the past. Verify the present.
======================================================================

[1/8] Loading centralized settings and diagnostics...
  - App: Data Rewind v0.1.0
  - Profile: local
  - Python: 3.12.0
  - DuckDB: 2.0.0
  [OK] Settings loaded successfully.

[2/8] Verifying domain models & lifecycle FSM...
  [OK] Domain models & FSM transitions verified.

[3/8] Verifying DAG validation & Kahn's deterministic ordering...
  [OK] Deterministic topological order: step_clean -> step_augment -> step_summary

[4/8] Verifying sandboxed AST expression engine...
  [OK] AST expressions safely evaluated with zero eval/exec.

[5/8] Verifying DuckDB runtime abstraction & transactions...
  [OK] DuckDB runtime queries and transactional rollback verified.

[6/8] Verifying canonical serialization & multiset hashing...
  [OK] Multiset hash invariant under permutation: f7dfbdfc1b8810d1...

[7/8] Verifying atomic artifact vault & path jail...
  [OK] Atomic artifact publication & path jail verified.

[8/8] Verifying ReplayManifest creation & integrity...
  [OK] ReplayManifest canonical serialization round-trip verified.

======================================================================
ALL CORE ENGINE FOUNDATION SMOKE TESTS PASSED [100% OK]
======================================================================
```

### E. CLI Local System Diagnostics
Command executed:
```powershell
.\.venv\Scripts\python.exe -m data_rewind.cli diagnostics
```
Execution Output:
```
============================================================
DATA REWIND -- LOCAL SYSTEM DIAGNOSTICS
============================================================
Engine Version:         0.1.0
Active Profile:         local
Python Runtime:         3.12.0 (win32)
DuckDB Version:         2.0.0
Base Workspace Root:    C:\Users\Admin\.data_rewind
Workspace Accessible:   YES
Disk Admission Gate:    PASS (> 100 MB free)
Process RSS Ceiling:    512 MiB
DuckDB Query Memory:    256 MiB
Max CSV Upload Limit:   50 MB
Max Dataset Rows:       500,000 rows
Max Dataset Columns:    100 columns
============================================================
```

### F. Git Diff Hygiene Check
Command executed:
```powershell
git diff --check
```
Execution Output:
*(Clean exit code 0; zero whitespace or line ending errors)*

---

## 4. Change Inventory

The changes made during Milestone 1.0.2 were strictly bounded to the remediation items:

1. **`src/data_rewind/core/expr/evaluator.py` (+14, -2 lines):**  
   Dynamically scaled periodic batch check interval to `max(1, min(100, len(rows) // 10))` and added a post-loop elapsed-time check.
2. **`src/data_rewind/core/integrity/hashing.py` (+8, -2 lines):**  
   Updated `compute_multiset_hash` to infer canonical columns across all rows (`sorted({k for r in rows for k in r.keys()})`) when `columns is None`.
3. **`src/data_rewind/core/integrity/manifest.py` (+32, -2 lines):**  
   Added `validate_sha256_hex` helper and attached `@field_validator` to `ManifestInput` (`content_hash`, `multiset_hash`) and `ReplayManifest` (`pipeline_definition_hash`).
4. **`tests/test_ast_security.py` (+124, -1 lines):**  
   Added 5 regression test cases for single-row batches, sub-100 row batches, check interval boundaries, normal completion, and post-loop expiration.
5. **`tests/test_integrity.py` (+188, -0 lines):**  
   Added 2 regression test suites testing heterogeneous multiset permutation invariance, dictionary insertion independence, explicit column schema adherence, old failure demonstration, and comprehensive SHA-256 string validation.
6. **`docs/DEVELOPER_GUIDE.md` (+50, -11 lines):**  
   Updated metadata to v1.1.0 (Milestone 1.0.2), documented non-preemptive AST execution and practical guidelines (P2-01), documented DuckDB connection ownership and lack of thread-safety (P2-02), and updated multiset inference and manifest validation references.
7. **`docs/reports/milestone_1_0_2_remediation_report.md` (New):**  
   Authored the comprehensive Milestone 1.0.2 remediation verification report.

---

## 5. Specification Conformance Review

- **Expression Limits & Safety (`SPEC-MOD-06` Section 3):** All syntactic and security constraints remain untouched. The dynamic check interval and post-loop verification align with the 1.0-second timeout guarantee without introducing dynamic execution or unsafe primitives.
- **Multiset Hashing Invariant (`SPEC-MOD-02` Section 2):** Conforms precisely to $H_{\text{multiset}}(D) = (\sum_{r \in D} \text{int}(h(r))) \pmod{2^{256}}$. Inferring the schema across all records restores the mathematical invariant of row-order permutation invariance for heterogeneous datasets.
- **Replay Manifest Integrity (`SPEC-MOD-03` Section 3.3):** Format validation for SHA-256 strings prevents corrupt or malformed replay manifest payloads from propagating through storage or replay verification.
- **₹0 Cost & Local-First Invariant (`SPEC-MOD-01` Section 1):** The entire remediation operates completely locally on loopback `127.0.0.1` with zero telemetry, zero cloud dependencies, and ₹0 recurring cost.

---

## 6. Security and Resource-Limit Review

### What the Fixes Improve
1. **No Timeout Bypass on Small Batches:** Small inputs (e.g., 10 to 99 rows) or single-row executions can no longer bypass batch timeout enforcement.
2. **Deterministic Cryptographic Fingerprints:** Keyless heterogeneous datasets cannot produce divergent multiset hashes depending on which record appears first.
3. **Strict Input Sanitization on Manifests:** Manifest bindings are protected against malformed or truncated hash payloads, preventing ingestion of corrupted manifest records.

### What Remains Bounded & Deferred (Threat Model Reality)
1. **Periodic vs. Preemptive Timeout Detection (P2-01):** The AST evaluator remains cooperative and in-thread. If a single evaluation inside a row hangs in a C extension or deep recursion, the in-thread timeout cannot preempt it until control returns to Python. Hard preemptive isolation is deferred to Milestone 5.0.
2. **Single-Connection Thread Safety (P2-02):** `DuckDBRuntime` is strictly not thread-safe. Concurrent pipeline step execution across threads in future milestones must instantiate separate runtime instances per thread or serialize query access.

---

## 7. Git State

- **Active Branch:** `main`
- **Pre-Existing Untracked Files:** Preserved cleanly (`.github/`, `.gitignore`, `README.md`, `docs/`, `pyproject.toml`, `requirements*.txt`, `src/`, `tests/`).
- **Commits Executed:** **0 commits executed.**
- **Remote Pushes:** **0 pushes executed.**
- **Working Tree State:** All files remain in a reviewable, non-committed working tree state.

---

## 8. Next Milestone Recommendation

With all P1 and P2 audit findings resolved or comprehensively documented, 87 automated tests passing, 94.10% genuine branch coverage, and zero lint or type errors:

**The Data Rewind core engine foundation is formally ready for Milestone 2.0 (Forensic Tabular Comparator & Benchmark Protocol).**

Execution of Milestone 2.0 will implement:
- The 15 forensic tabular comparison cases (PK, composite keys, keyless multiset, null keys, duplicate keys, float $\epsilon$ tolerance, NaN vs Null).
- Earliest Observable Divergence (EOD) detection.
- The 6 automated diagnostic rules.
- The formal Reproducible Benchmark Protocol across 10k, 50k, 100k, and 500k-row datasets under cold and warm cache conditions.
