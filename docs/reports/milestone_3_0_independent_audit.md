# Data Rewind — Independent Post-Implementation Audit Report
# Milestone 3.0: Pipeline Engine, Lineage, Replay, Orchestration, and Scenarios

**Audit Verdict:** **CONDITIONAL PASS — REMEDIATION REQUIRED BEFORE MILESTONE 4.0**  
**Audited Git Commit:** `bdead763febc2e743ba8dcff01220c2b259de66f` (`bdead76`)  
**Repository Working Tree:** Clean baseline prior to report generation  
**Audit Date:** 2026-10-27  
**Auditor:** Independent Systems & Security Auditor (Pair Programmer)  
**Target Specification:** `docs/spec/SPECIFICATION.md` and modules `SPEC-MOD-00` through `SPEC-MOD-10`

---

## 1. Executive Summary

Milestone 3.0 represents the primary functional milestone of the Data Rewind platform, transitioning the system from a static tabular forensic comparator into a fully integrated execution, lineage tracing, replay, and forensic investigation engine.

An independent engineering audit of the codebase at commit `bdead76` was conducted covering:
1. **Verification of Quality Gates:** Independent execution of Pytest test suite (154 tests), Ruff linter, Ruff formatting check, strict Mypy type-checking, smoke tests, CLI memory diagnostics, and CLI benchmark protocols.
2. **Mathematical Reconciliation of Test Coverage:** Resolution of the discrepancy between reported "branch coverage" (93.58%) and the actual breakdown across statement, branch, and combined metrics.
3. **Specification Conformance Audit:** Deep code inspection of DAG lineage tracing (`LineageEngine`), pipeline step execution (`PipelineExecutor`), replay verification (`HistoricalReplayer`), forensic investigation orchestration (`InvestigationOrchestrator`), persistence (`InvestigationRepository`), scenario harnesses (`SCN-01` to `SCN-04`), and developer CLI commands.
4. **Milestone 2.0.2 Regression Audit:** Verification that additive dual-accumulator multiset hashing, JSON-based keyless diffing, DR-05 DuckDB query evidence sampling, and EOD linear fallback remain strictly preserved without degradation.
5. **Security & Guardrail Verification:** Verification of AST evaluation boundaries, memory limits, SQL injection risks, and local-first data boundaries.

### Overall Audit Verdict

**CONDITIONAL PASS — REMEDIATION REQUIRED BEFORE MILESTONE 4.0**

The core architectural implementation of Milestone 3.0 is exceptionally robust: 154 unit and integration tests pass cleanly, static analysis (Mypy strict, Ruff) reports zero defects, all 4 deterministic demonstration scenarios execute with exact diagnostic rule isolation, and CLI diagnostics verify memory and runtime compliance. 

However, acceptance for Milestone 4.0 is conditional upon resolving **two P1 findings** and **two P2 findings** identified during audit:
- **`M3-AUDIT-P1-01`**: `ReplayOutcome.PARTIALLY_REPRODUCIBLE` is dead code (never returned by `HistoricalReplayer.replay_run`, bypassing numeric tolerance and reordering logic).
- **`M3-AUDIT-P1-02`**: False positive `REPRODUCIBLE` verdict when replaying from a `RunManifest` alone because historical step output hashes are not preserved in `ManifestStepSnapshot` and the replayer defaults unrecorded hashes to matching.
- **`M3-AUDIT-P2-01`**: `HistoricalReplayer` fails to assert that the reconstructed pipeline definition hash matches `manifest.pipeline_definition_hash`.
- **`M3-AUDIT-P2-02`**: Parameter interpolation in `PipelineExecutor` (`join_datasets`, `cast_columns`, `aggregate_group_by`) lacks whitelist and identifier token sanitization.

---

## 2. Audited Repository Baseline

- **Repository Root:** `E:\MHT CET REGISTRATION\BE\Task\DataRewind\`
- **Branch:** `main`
- **Audited Commit SHA:** `bdead763febc2e743ba8dcff01220c2b259de66f`
- **Commit Message:** `feat: implement pipeline engine, lineage, replay, orchestration, and scenarios`
- **Author / Timestamp:** Developer / 2026-10-22
- **Pre-Audit Working Tree:** Clean (`git status` reports nothing to commit, working tree clean).
- **Python Runtime:** Python 3.12.0 (virtual environment: `.venv`).

### Changed Footprint at Audited Commit (`bdead76`)
- **Total Files Changed:** 29 files (5 modified, 24 untracked/created).
- **Insertions:** 4,510 lines.
- **Deletions:** 22 lines.
- **Key Modules Audited:**
  - `src/data_rewind/lineage/` (`models.py`, `engine.py`, `__init__.py`)
  - `src/data_rewind/execution/` (`models.py`, `engine.py`, `__init__.py`)
  - `src/data_rewind/replay/` (`models.py`, `replayer.py`, `__init__.py`)
  - `src/data_rewind/investigation/` (`models.py`, `orchestrator.py`, `persistence.py`, `__init__.py`)
  - `src/data_rewind/scenarios/` (`scn_01_upstream_corruption.py`, `scn_02_silent_schema_drift.py`, `scn_03_join_fanout.py`, `scn_04_floating_point_drift.py`, `__init__.py`)
  - `src/data_rewind/cli.py`
  - `tests/` (`test_lineage.py`, `test_execution.py`, `test_replay.py`, `test_investigation.py`, `test_scenarios.py`)

---

## 3. Independent Quality Gate Verification

All quality gates were independently executed by the auditor using `.venv\Scripts\python.exe`.

### 3.1 Test Suite Execution (Pytest)
```
Command: .venv\Scripts\pytest -v
Result: 154 passed in 19.50s
Failures: 0
Errors: 0
Warnings: 0
```
- Core engine tests: 22 passed (`test_ast.py`, `test_dag.py`, `test_hashing.py`, `test_manifest.py`, etc.)
- Comparator tests: 58 passed (`test_comparator.py`, `test_diagnostics.py`, `test_eod.py`, `test_benchmark.py`, etc.)
- Milestone 3.0 tests: 74 passed
  - `tests/test_lineage.py`: 12 passed
  - `tests/test_execution.py`: 16 passed
  - `tests/test_replay.py`: 15 passed
  - `tests/test_investigation.py`: 15 passed
  - `tests/test_scenarios.py`: 16 passed

### 3.2 Static Analysis & Formatting
- **Ruff Lint:**
  ```
  Command: .venv\Scripts\ruff.exe check src tests
  Output: All checks passed!
  ```
- **Ruff Formatting Check:**
  ```
  Command: .venv\Scripts\ruff.exe format --check src tests
  Output: 72 files already formatted.
  ```
- **Strict Mypy Type Checking:**
  ```
  Command: .venv\Scripts\mypy.exe src
  Output: Success: no issues found in 54 source files
  ```

### 3.3 Smoke Test & CLI Verification
- **Smoke Test:**
  ```
  Command: .venv\Scripts\python.exe -m data_rewind.smoke_test
  Output: 8/8 OK - ALL CORE ENGINE FOUNDATION SMOKE TESTS PASSED [100% OK]
  ```
- **CLI Diagnostics:**
  ```
  Command: .venv\Scripts\python.exe -m data_rewind.cli diagnose
  Output: PASS (Available memory > 100 MB free, 512 MiB RSS ceiling enforced)
  ```
- **CLI Benchmark:**
  ```
  Command: .venv\Scripts\python.exe -m data_rewind.cli benchmark
  Output: PASS (5 scenarios evaluated, partition completeness verified)
  ```

---

## 4. Coverage Metric Reconciliation

The Milestone 3.0 completion report claimed `93.58% branch coverage`. Independent verification using `coverage.py` and analysis of `Numbers` data revealed the exact mathematical structure of this metric:

```
Name                                       Stmts   Miss Branch BrPart   Cover
-----------------------------------------------------------------------------
TOTAL                                       3390    152    924    115     94%
```

### Mathematical Breakdown
1. **Statement / Line Coverage:**
   $$\text{Statement Coverage} = \frac{3,390 - 152}{3,390} = \frac{3,238}{3,390} = \mathbf{95.52\%}$$
2. **Pure Branch Coverage:**
   $$\text{Pure Branch Coverage} = \frac{924 - (115 + 10)}{924} = \frac{799}{924} = \mathbf{86.47\%}$$
   *(Note: 924 total branches; 115 partial branches executed one branch arm; 10 completely unexecuted branch instructions).*
3. **Combined Statement + Branch Coverage (`pc_covered`):**
   $$\text{Combined Coverage} = \frac{(3,390 - 152) + 799}{3,390 + 924} = \frac{3,238 + 799}{4,314} = \frac{4,037}{4,314} = \mathbf{93.58\%}$$

### Finding on Coverage Metric
The 93.58% figure reported in the completion report is **combined statement + branch coverage** (`pc_covered`), not pure branch coverage (which is 86.47%). In `pyproject.toml`, `fail_under = 90` applies to `pc_covered`, meaning the automated test gate passed legitimately. However, pure branch coverage falls below the 90% threshold.

---

## 5. Specification Conformance Matrix

| Specification | Requirement | Status | Evidence / Audit Notes |
|---|---|---|---|
| **SPEC-MOD-05 §1** | Forward/Backward DAG Lineage & Taint Propagation | **CONFORMANT** | `LineageEngine` computes complete ancestors, descendants, and multi-root taint cascades. Bidirectional graph traversal verified. |
| **SPEC-MOD-05 §2** | Impact Assessment & Blast Radius | **CONFORMANT** | `compute_blast_radius` computes cumulative impacted downstream nodes, downstream terminal datasets, and estimated downstream row volume. |
| **SPEC-MOD-06 §1** | Safe DuckDB Step Execution Engine | **CONFORMANT** | In-memory DuckDB runtime executes filter, derive, join, aggregate, cast, drop, and rename steps safely. Resource monitor limits memory. |
| **SPEC-MOD-03 §3** | Historical Replay & Replay Manifests | **PARTIAL** | Core execution replay succeeds. However, `PARTIALLY_REPRODUCIBLE` is dead code (`M3-AUDIT-P1-01`), and replaying from manifest defaults unrecorded hashes to matching (`M3-AUDIT-P1-02`). |
| **SPEC-MOD-07 §1** | Forensic Investigation Orchestration | **CONFORMANT** | `InvestigationOrchestrator` integrates step comparisons, lineage blast radius, EOD localization, and diagnostic rule evaluation into `ForensicInvestigationReport`. |
| **SPEC-MOD-07 §1.1** | Investigation Persistence (SQLite) | **CONFORMANT** | Full JSON-serialized persistence of reports and replay manifests into SQLite catalog with search and query capabilities. |
| **SPEC-MOD-08 §1-4** | Deterministic Demonstration Scenarios | **CONFORMANT** | SCN-01 (Null surge), SCN-02 (Schema drift), SCN-03 (Join fanout), and SCN-04 (Float drift) reliably isolate exact diagnostic rules and EOD nodes. |
| **SPEC-MOD-09 §1** | Developer CLI Commands | **CONFORMANT** | CLI provides `run-scenario`, `investigate`, `replay`, `diagnose`, `benchmark`, and `lineage` commands with structured terminal formatting. |

---

## 6. Milestone 2.0.2 Regression Verification

The auditor verified that the four critical remediation fixes implemented in Milestone 2.0.2 were not degraded or reverted during Milestone 3.0:

1. **Dual-Accumulator Multiset Hashing (P1-01):**
   - **File:** `src/data_rewind/comparator/engine.py:679-700`
   - **Verification:** `_compute_duckdb_multiset_hash` computes two independent `HUGEINT` sum accumulators with salt `__dr_salt__` and row multiplicity `cnt`. SHA-256 over `f"{h1}:{h2}:{cnt}"` is strictly preserved.
2. **Keyless SQL NULL-Sentinel & Delimiter Isolation (P2-01):**
   - **File:** `src/data_rewind/comparator/engine.py:1033-1049`
   - **Verification:** Keyless SQL matching uses `md5(json_object(...))` over sorted common columns, eliminating delimiter and NULL string collision vulnerabilities.
3. **DR-05 DuckDB Query Evidence Sampling (P2-02):**
   - **File:** `src/data_rewind/comparator/engine.py:925-960`
   - **Verification:** When modified rows are detected in DuckDB keyed comparisons, rows are sampled via SQL outer join and individual `ValueDiff` items are populated for diagnostic rules.
4. **EOD Sequence Fallback Without Dependencies (P2-03):**
   - **File:** `src/data_rewind/diagnostics/eod.py:35-43`
   - **Verification:** When `step_dependencies` is omitted, `dependencies` infers a linear sequence from `topological_order`, preventing false simultaneous EOD classifications.

---

## 7. Audit Findings by Severity

### 7.1 P1 Findings (High Severity)

#### Finding `M3-AUDIT-P1-01`: Dead / Unreachable Replay Outcome `PARTIALLY_REPRODUCIBLE`
- **Severity:** P1 (High)
- **Category:** Specification Non-Conformance / Dead Code
- **File and Line:** `src/data_rewind/replay/replayer.py:141-187`
- **Specification Requirement:** `SPEC-MOD-03` §3.4 and `SPECIFICATION.md` §2 define five canonical replay outcomes: `REPRODUCIBLE`, `PARTIALLY_REPRODUCIBLE`, `DIVERGENT`, `FAILED`, and `ENVIRONMENT_MISMATCH`. `PARTIALLY_REPRODUCIBLE` is defined as reproduction within defined tolerance thresholds ($\epsilon \le 10^{-6}$) or row reordering without content divergence.
- **Expected Behavior:** If all step outputs match historical outputs within float tolerance or have identical multiset contents despite sequence drift, `replayer.replay_run` must return `ReplayOutcome.PARTIALLY_REPRODUCIBLE`.
- **Actual Behavior:** In `HistoricalReplayer.replay_run`, `ReplayOutcome.PARTIALLY_REPRODUCIBLE` is imported and listed in docstrings, but is **never returned anywhere in the code**:
  ```python
  if diff_res is not None and not diff_res.is_equal:
      is_matched = False
      has_divergence = True
  ```
  Any divergence in multiset hash or comparison triggers `has_divergence = True`, which immediately results in `ReplayOutcome.DIVERGENT`. `tests/test_replay.py` tests four outcomes (`REPRODUCIBLE`, `DIVERGENT`, `FAILED`, `ENVIRONMENT_MISMATCH`) but completely omits testing `PARTIALLY_REPRODUCIBLE`.
- **Impact:** Legitimate pipeline executions with minor floating-point rounding within tolerance or row reordering are incorrectly classified as `DIVERGENT`, violating the spec's tolerance guarantees.
- **Why Missed by Existing Tests:** Test cases only asserted the other four enum variants; no test verified that fuzzy numeric matches or Case 6 reordered matches return `PARTIALLY_REPRODUCIBLE`.
- **Required Remediation:** Implement branch logic in `HistoricalReplayer.replay_run` to inspect `diff_res.case_classifications` and numeric tolerance; if divergences are strictly limited to acceptable float variance or row reordering, classify as `PARTIALLY_REPRODUCIBLE`.

---

#### Finding `M3-AUDIT-P1-02`: False Positive `REPRODUCIBLE` Verdict When Replayed From Manifest Alone
- **Severity:** P1 (High)
- **Category:** Data Integrity / False Positive Verification
- **File and Line:** `src/data_rewind/replay/replayer.py:158-164` and `src/data_rewind/core/integrity/manifest.py:75-84`
- **Specification Requirement:** `SPEC-MOD-03` §3.4 (Requirement 3: "Output multiset hashes match historical records 100%"). Replay verification must mathematically prove that replayed tables match historical outputs.
- **Expected Behavior:** When replaying from a `RunManifest` (`cli replay --manifest <path>`), the replayer must compare replayed output hashes against historical step output hashes recorded in the manifest. If historical hashes are unavailable, it must indicate that verification is unverifiable or incomplete.
- **Actual Behavior:** `ManifestStepSnapshot` does not record historical output multiset hashes (only `step_id`, `step_type`, `input_tables`, `output_table`, `status`, `duration_ms`, `row_count`). When `replay_run(definition, manifest=manifest, historical_step_hashes=None)` is called:
  ```python
  hist_hash = historical_step_hashes.get(step.step_id) if historical_step_hashes else None
  if hist_hash is not None:
      is_matched = (output_hash == hist_hash)
  ```
  If `historical_step_hashes` is `None` (which is always the case when replaying from a manifest file via CLI), `hist_hash` is `None`, so `is_matched` remains `True` and `has_divergence` remains `False`. The replayer returns `ReplayOutcome.REPRODUCIBLE` with message `"Historical run successfully reproduced with 100% mathematical equivalence"` without actually verifying any output hash!
- **Impact:** An operator running `cli replay --manifest manifest.json` will be told the run reproduced with 100% mathematical equivalence even if the pipeline output was completely empty or corrupt.
- **Why Missed by Existing Tests:** `tests/test_replay.py` passed explicit `historical_step_hashes` dictionaries in its unit tests, masking the missing field in `ManifestStepSnapshot`.
- **Required Remediation:** Add `output_multiset_hash: str | None = None` to `ManifestStepSnapshot`. In `HistoricalReplayer`, extract historical hashes from `manifest.steps_snapshot`. If neither `historical_step_hashes` nor snapshot hashes are present, refuse to return `REPRODUCIBLE`.

---

### 7.2 P2 Findings (Medium Severity)

#### Finding `M3-AUDIT-P2-01`: Unchecked `pipeline_definition_hash` in `HistoricalReplayer`
- **Severity:** P2 (Medium)
- **Category:** Tamper Resistance / Hash Verification
- **File and Line:** `src/data_rewind/replay/replayer.py:76-102`
- **Specification Requirement:** `SPEC-MOD-03` §3.4 (Requirement 2: "Pipeline configuration matches definition hash 100%").
- **Expected Behavior:** In `HistoricalReplayer.replay_from_manifest`, after reconstructing the `PipelineDefinition` from `manifest.steps_snapshot`, the replayer must compute `compute_pipeline_definition_hash(definition)` and assert that it matches `manifest.pipeline_definition_hash`.
- **Actual Behavior:** The replayer reconstructs the definition and immediately executes it without validating that its computed hash matches `manifest.pipeline_definition_hash`.
- **Impact:** A tampered manifest where `steps_snapshot` was modified would be executed without detecting that it no longer matches the historical definition hash recorded at runtime.
- **Why Missed by Existing Tests:** Tests used valid manifests where hashes matched and did not execute negative tamper tests.
- **Required Remediation:** In `replay_from_manifest`, verify that the reconstructed definition's hash matches `manifest.pipeline_definition_hash`. If mismatched, abort with `ReplayOutcome.ENVIRONMENT_MISMATCH` or raise `ReplayError`.

---

#### Finding `M3-AUDIT-P2-02`: Parameter Interpolation & Grammar Gaps in `PipelineExecutor`
- **Severity:** P2 (Medium)
- **Category:** Security / SQL Injection Defense-in-Depth
- **File and Line:** `src/data_rewind/execution/engine.py:275-351`
- **Specification Requirement:** `SPEC-MOD-06` §1 and `SPEC-MOD-03` §1.2 mandate strict expression validation and defense-in-depth against malicious SQL expressions.
- **Expected Behavior:** All step parameters interpolated into DuckDB SQL statements (e.g. `join_type`, `on`, `target_types`, `aggregations`) must be validated against strict whitelists or syntax grammars.
- **Actual Behavior:** While `filter_rows` and `derive_column` properly sanitize expressions using `ASTSecurityValidator`, other step handlers interpolate parameters directly:
  - `join_datasets`: `f"SELECT * FROM ... {step.join_type} JOIN ... ON {join_on}"` without asserting `join_type` is in `{'INNER', 'LEFT', 'RIGHT', 'FULL'}`.
  - `cast_columns`: `f"CAST({_quote_ident(col)} AS {target_type})"` without validating `target_type` against allowed DuckDB types.
  - `aggregate_group_by`: `f"{expr} AS {_quote_ident(alias)}"` without passing aggregate expressions through AST validation.
- **Impact:** Malicious configuration inputs in step parameters could execute arbitrary DuckDB SQL constructs or subqueries.
- **Why Missed by Existing Tests:** Tests used standard, benign configuration values like `"INNER"` and `"VARCHAR"`.
- **Required Remediation:** Whitelist `join_type`, validate `target_types` against allowed DuckDB types, and sanitize SQL expressions in `join_on` and `aggregations` using `ASTSecurityValidator`.

---

### 7.3 P3 Findings (Low Severity)

#### Finding `M3-AUDIT-P3-01`: SQLite Catalog Does Not Enable WAL Journal Mode
- **Severity:** P3 (Low)
- **Category:** Concurrency & Durability
- **File and Line:** `src/data_rewind/investigation/persistence.py:31-50`
- **Specification Requirement:** `SPEC-MOD-07` §1.1 states: "Storage: SQLite 3 catalog (WAL mode)".
- **Expected Behavior:** `InvestigationRepository` initializes SQLite database connection with `PRAGMA journal_mode=WAL;` and `PRAGMA busy_timeout=5000;`.
- **Actual Behavior:** Standard sqlite3 connection is opened without issuing `PRAGMA journal_mode=WAL;`. On Windows, SQLite defaults to standard rollback journal mode.
- **Impact:** Multi-process concurrent reads during active investigations may encounter database lock contention.
- **Why Missed by Existing Tests:** Test suites ran sequentially in a single process.
- **Required Remediation:** Execute `PRAGMA journal_mode=WAL;` and `PRAGMA busy_timeout=5000;` immediately upon establishing connection in `InvestigationRepository`.

---

## 8. Subsystem Evaluation

### 8.1 Lineage & Taint Propagation (`LineageEngine`)
- **Rating:** **EXCELLENT (100% SPEC COMPLIANCE)**
- **Evaluation:** Built upon topological sorting and DAG structure. Graph traversal correctly supports forward lineage (descendants), backward lineage (ancestors), multi-node taint propagation, and blast radius calculation.
- **Blast Radius Metrics:** Accurately computes affected step count, affected dataset count, affected terminal datasets, and cumulative impacted row count.

### 8.2 Pipeline Step Execution (`PipelineExecutor`)
- **Rating:** **VERY GOOD (ROBUST EXECUTION, NARROW SANITIZATION GAPS)**
- **Evaluation:** Executes all 7 core step types (`FILTER`, `DERIVE`, `JOIN`, `AGGREGATE`, `CAST`, `DROP`, `RENAME`) inside DuckDB. Correctly computes row count and execution duration. AST validation effectively sanitizes expressions in `FILTER` and `DERIVE`. Narrow gaps identified in `M3-AUDIT-P2-02`.

### 8.3 Historical Replay (`HistoricalReplayer`)
- **Rating:** **NEEDS TARGETED REMEDIATION**
- **Evaluation:** Capable of running pipeline replays from in-memory definitions or serialized manifests. Generates `ReplayManifest` capturing environment fingerprint, platform, Python version, and execution duration.
- **Remediation Needed:** Fix `M3-AUDIT-P1-01` (`PARTIALLY_REPRODUCIBLE`), `M3-AUDIT-P1-02` (missing output hashes in snapshot), and `M3-AUDIT-P2-01` (unchecked definition hash).

### 8.4 Forensic Investigation Orchestration & Persistence
- **Rating:** **EXCELLENT**
- **Evaluation:** `InvestigationOrchestrator` wires together step comparison, DAG lineage, EOD root-cause localization, and diagnostic rules into a comprehensive `ForensicInvestigationReport`.
- **Persistence:** `InvestigationRepository` cleanly serializes and queries reports and replay manifests via SQLite.

### 8.5 Deterministic Demonstration Scenarios (`SCN-01` to `SCN-04`)
- **Rating:** **EXCELLENT (100% DETERMINISTIC AND VERIFIED)**
- **Scenario Verification:**
  - `SCN-01` (Upstream Null Surge): Correctly triggers `DR-01_UNEXPECTED_NULL_SURGE` at `step_clean`. Blast radius: 3 steps, 1 terminal dataset (`final_transactions`).
  - `SCN-02` (Silent Schema Drift): Correctly triggers `DR-04_SILENT_SCHEMA_DRIFT` at `step_transform`. Blast radius: 2 steps, 1 terminal dataset (`final_accounts`).
  - `SCN-03` (Join Fanout Ingestion): Correctly triggers `DR-03_JOIN_FANOUT_EXPLOSION` at `step_join`. Blast radius: 2 steps, 1 terminal dataset (`final_summary`).
  - `SCN-04` (Floating-Point Drift): Correctly triggers `DR-05_SYSTEMATIC_NUMERIC_DRIFT` at `step_normalize`. Blast radius: 2 steps, 1 terminal dataset (`final_scores`).

### 8.6 Developer CLI Commands
- **Rating:** **EXCELLENT**
- **Evaluation:** Commands `run-scenario`, `investigate`, `replay`, `diagnose`, `benchmark`, and `lineage` work seamlessly with rich terminal output, proper exit codes, and JSON serialization support.

---

## 9. Git Working Tree & Audit Safety

In accordance with strict audit rules:
- **No production code was modified.**
- **No test files were modified.**
- **No configuration or specification files were modified.**
- **No Git commits were created.**
- The only file introduced in the repository is this independent audit report at `docs/reports/milestone_3_0_independent_audit.md`.

---

## 10. Required Remediation Conditions for Acceptance

Before declaring Milestone 3.0 fully accepted and authorizing Milestone 4.0 implementation, the following remediation tasks must be completed in a targeted remediation phase (Milestone 3.0.1):

1. **Resolve `M3-AUDIT-P1-01`:** Implement logic in `HistoricalReplayer.replay_run` to check `diff_res` cases and tolerance thresholds to return `ReplayOutcome.PARTIALLY_REPRODUCIBLE` when divergence is confined to float tolerances ($\epsilon \le 10^{-6}$) or row order drift. Add unit tests asserting all 5 outcomes.
2. **Resolve `M3-AUDIT-P1-02`:** Add `output_multiset_hash` to `ManifestStepSnapshot`. In `replayer.py`, populate historical hashes from `manifest.steps_snapshot` and fail or refuse `REPRODUCIBLE` if hashes cannot be verified.
3. **Resolve `M3-AUDIT-P2-01`:** In `replay_from_manifest`, assert that the reconstructed pipeline definition hash matches `manifest.pipeline_definition_hash`.
4. **Resolve `M3-AUDIT-P2-02`:** Sanitize step parameters in `PipelineExecutor` (`join_type` whitelist, DuckDB cast type validation, AST check on aggregation expressions).
5. **Resolve `M3-AUDIT-P3-01`:** Add `PRAGMA journal_mode=WAL;` and `PRAGMA busy_timeout=5000;` to `InvestigationRepository._init_db`.
6. **Increase Pure Branch Coverage:** Add targeted branch tests to raise pure branch coverage from 86.47% to $\ge 90\%$.

---
*Report independently compiled and verified on commit `bdead76`.*
