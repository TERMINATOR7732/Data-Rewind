# Data Rewind — Portfolio Presentation & Technical Interview Guide

> **Project Tagline:** *Understand the past. Verify the present.*  
> **Repository:** `DataRewind` | **Architecture:** Local-First, Zero-Cloud, Zero-Operating-Cost Pipeline Forensics Engine  
> **Status:** Production Release Ready | Commit: `6dddbf5` | Verification: 251 Python Tests (90.66% Cov), 17 Vitest, 15 Playwright E2E

---

## 1. Portfolio Copy Variants

### Variant 1: Short Portfolio Card (52 words)
**Data Rewind** is an offline-first data-pipeline investigation platform that isolates root causes in corrupted analytical workflows. Combining deterministic dual-accumulator multiset hashing, AST-sandboxed step execution, in-process DuckDB analytics, and dual-axis Tri-Run fix verification, it proves whether pipeline patches resolve defects without causing regression—running entirely on local commodity hardware at strict zero operating cost.

---

### Variant 2: Full Project Page Description (228 words)
**Data Rewind** is a local-first, evidence-based data-pipeline investigation and reproducibility platform designed to diagnose silent data corruption and verify pipeline fixes before deployment. When distributed or batch analytical pipelines fail silently, data engineering teams face hours of manual SQL auditing, unrepeatable environments, and high cloud compute costs.

Data Rewind eliminates this burden through an offline, zero-cloud architecture:
- **Root-Cause Isolation:** Performs DAG-aware lineage analysis with five deterministic diagnostic rules (DR-01 to DR-05) to pinpoint the Earliest Observable Divergence (EOD) rather than conflating root causes with downstream blast radius.
- **High-Performance Parity Verification:** Employs an $O(N)$ dual-accumulator multiset hashing algorithm (`BLAKE3` + `xxHash64`) and DuckDB SQL comparisons, processing 500,000 tabular rows in 605ms under a strict 301.9 MiB peak memory footprint.
- **Tri-Run Verification:** Compares Candidate fix runs against both Baseline and Production outputs across dual axes, returning one of eight authoritative verdicts (e.g., `CLEAN_FIX`, `NEW_DEFECT_INTRODUCED`, `INEFFECTIVE_FIX`).
- **AST Sandboxing & Security:** Safeguards pipeline replay via an AST visitor prohibiting unauthorized imports, filesystem access, and network I/O, while CSV exports neutralize spreadsheet formula injection vulnerabilities (`=`, `+`, `-`, `@`, `\t`, `\r`).

Engineered with 251 passing backend tests (90.66% statement+branch coverage), 17 Vitest component tests, and 15 Playwright browser tests, Data Rewind operates with zero cloud subscriptions, zero telemetry, and complete data privacy.

---

### Variant 3: Technical Résumé Bullet Points
- **Architected Local-First Forensics Engine:** Built an offline data-pipeline investigation platform in Python (FastAPI, DuckDB, Polars, Pydantic v2) and React/TypeScript, diagnosing silent data corruption with zero external cloud dependencies and ₹0 operational cost.
- **High-Throughput Tabular Comparator:** Engineered an $O(N)$ dual-accumulator multiset hashing algorithm (`BLAKE3` + `xxHash64` modulo $2^{64}-59$) and keyless/keyed SQL row-diff engine, comparing 500,000 tabular rows in 605ms with 301.9 MiB peak RSS across 15 comparison categories (C01–C15).
- **Dual-Axis Tri-Run Verification Framework:** Implemented an automated verification system executing Candidate runs against Baseline and Production datasets, evaluating regression risk and remediation validity to emit 8 deterministic verdicts (V-01 to V-08) with signed cryptographic audit manifests.
- **Defense-in-Depth Pipeline Security:** Designed a strict AST-based Python execution sandbox restricting imports, system calls, and network I/O, complemented by RFC 4180 CSV export sanitization with formula injection neutralization for Excel and Google Sheets.
- **Exhaustive Testing & Production Verification:** Authored 251 pytest tests reaching 90.66% combined statement+branch coverage, 17 Vitest UI tests, 15 Playwright E2E browser flows, and an 8/8 automated smoke harness ensuring sub-millisecond API responses and memory boundary compliance.

---

## 2. Technical Interview Deep-Dive Notes

### Topic 1: Deterministic Multiset Hashing ($O(N)$ Dual-Accumulator) vs. Sorting

#### The Problem
Verifying whether two intermediate tabular datasets are identical across pipeline runs is fundamental to reproducibility. The naive approach sorts both tables by all columns ($O(N \log N)$ time, high memory overhead for external sorting) or sorts on disk. When tables lack unique primary keys or contain floating-point values and large text fields, sorting introduces significant latency and memory pressure.

#### The Data Rewind Architecture
Data Rewind implements an $O(N)$ streaming dual-accumulator multiset hash:
1. **Row Serialization:** Each row is canonicalized into a deterministic byte string:
   $$\text{canonical\_bytes} = \text{col}_1 \mathbin{\Vert} \text{DELIM} \mathbin{\Vert} \dots \mathbin{\Vert} \text{col}_k$$
   Nulls are unambiguously encoded via explicit bitmasks and sentinel tokens (`\x00NULL\x00`) to prevent delimiter collision.
2. **Dual 64-bit Accumulators:**
   For each row $i$:
   - Accumulator 1: $h_1(i) = \text{xxHash64}(\text{bytes}_i) \pmod{2^{64} - 59}$
   - Accumulator 2: $h_2(i) = \text{BLAKE3\_64}(\text{bytes}_i) \pmod{2^{64} - 59}$
3. **Additive Commutativity:**
   $$H_1 = \sum_{i=1}^N h_1(i) \pmod{2^{64}-59}, \quad H_2 = \sum_{i=1}^N h_2(i) \pmod{2^{64}-59}$$
   Because modular addition is associative and commutative, $H = (H_1, H_2)$ is completely order-independent: identical multisets yield identical fingerprints regardless of partition or row retrieval sequence.
4. **Collision Resistance:**
   Unlike simple XOR accumulation ($\bigoplus$) which suffers from self-cancellation when duplicate row pairs exist ($x \oplus x = 0$), modular addition over a large prime field ($2^{64}-59$, the largest 64-bit prime) avoids zeroing out even-multiplicity rows. The probability of two distinct multisets colliding across both independent hash functions is $< 2^{-128}$.
5. **Short-Circuit Equality:**
   If $(H_1, H_2)_A = (H_1, H_2)_B$ and row counts match, datasets are confirmed identical in $O(N)$ time with $O(1)$ auxiliary memory. If fingerprints differ, the comparator drops down to DuckDB anti-joins to isolate the exact inserted, deleted, and modified rows.

---

### Topic 2: Tri-Run Dual-Axis Fix Verification Architecture

#### The Problem
When a data engineer modifies pipeline logic to fix an upstream bug, verifying the fix typically involves re-running the pipeline on production inputs. However, this conflates two independent questions:
1. Did the code change resolve the target defect?
2. Did the code change preserve existing, correct behavior across non-defective rows?

#### The Data Rewind Architecture
Data Rewind establishes a **Tri-Run Verification Matrix** comparing three concurrent artifacts:
- **Run A (Production Run):** The historical run containing known corruption or failure.
- **Run B (Baseline / Reference Run):** The expected gold-standard output or clean historical baseline prior to data contamination.
- **Run C (Candidate Run):** The newly executed pipeline utilizing the patched code.

```
       Candidate (Run C)
        /             \
 Axis 1/               \ Axis 2
      v                 v
Baseline (Run B)     Production (Run A)
[Equivalence Check]  [Remediation Check]
```

#### Dual-Axis Evaluation
- **Axis 1: Candidate vs. Baseline ($C \leftrightarrow B$):** Evaluates equivalence to the desired ground truth. Identifies whether unexpected rows were introduced or expected rows were omitted.
- **Axis 2: Candidate vs. Production ($C \leftrightarrow A$):** Evaluates the delta against the defective run. Verifies that defective rows were modified or removed.

#### Deterministic Verdict Matrix (V-01 to V-08)
The engine evaluates the joint comparison outcome into 8 discrete verdicts:
| Verdict Code | Verdict Name | Axis 1 ($C \leftrightarrow B$) | Axis 2 ($C \leftrightarrow A$) | Engineering Meaning |
| :--- | :--- | :--- | :--- | :--- |
| **V-01** | `CLEAN_FIX` | Equal | Divergent | Candidate matches baseline exactly and diverges from defective production. Patch verified. |
| **V-02** | `INEFFECTIVE_FIX` | Divergent | Equal | Candidate matches defective production. The patch had zero effect on the output. |
| **V-03** | `PARTIAL_FIX` | Partial Match | Divergent | Some defects fixed, but output does not yet achieve full baseline parity. |
| **V-04** | `NEW_DEFECT_INTRODUCED` | Divergent | Divergent | Candidate differs from both baseline and production; patch introduced new regressions. |
| **V-05** | `REVERTED_BEHAVIOR` | Equal | Equal | Baseline and production were already identical; candidate maintained parity. |
| **V-06** | `UNEXPECTED_EQUIVALENCE` | Equal | Equal (Edge) | Candidate unexpectedly equal to both baseline and production. |
| **V-07** | `INDETERMINATE_EVIDENCE` | Unknown | Unknown | Missing intermediate artifacts or unresolvable schema mismatch. |
| **V-08** | `VALIDATION_FAILED` | Failed | Failed | Candidate execution crashed, timed out, or violated memory bounds. |

Each verdict produces an immutable JSON audit manifest containing cryptographic run hashes, diff summary statistics, and exact column-level deltas.

---

### Topic 3: AST Sandboxing Architecture vs. Unsafe Python `eval()`

#### The Problem
Data Rewind allows data engineers to define and test transformation steps dynamically during historical replays. In Python-based data platforms, executing user-submitted step scripts frequently relies on `exec()` or `eval()`, creating critical remote code execution (RCE) vectors where malicious or buggy scripts can access `os.system()`, inspect environment secrets, or initiate unauthorized outbound socket connections.

#### The Data Rewind Architecture
Data Rewind implements an AST (Abstract Syntax Tree) Static Analysis and Sandboxed Execution Gate (`ast_sandbox.py`):
1. **Static AST Inspection:**
   Prior to execution, the script source is parsed into an abstract syntax tree using Python's `ast` module. The `PipelineASTVisitor` traverses all nodes and enforces a strict deny-list:
   - **Forbidden Nodes:** `ast.Import`, `ast.ImportFrom` (preventing any external module importation).
   - **Forbidden Calls:** `eval`, `exec`, `compile`, `open`, `__import__`, `globals`, `locals`, `getattr`, `setattr`, `delattr`.
   - **Forbidden Namespaces:** `os`, `sys`, `subprocess`, `socket`, `shutil`, `pathlib`, `requests`, `urllib`.
   - **Forbidden Attributes:** Dunder attributes (`__class__`, `__bases__`, `__subclasses__`, `__mro__`, `__code__`) to prevent Python sandbox-escape exploits.
2. **Safe Scope Injection:**
   If the AST analysis passes with zero violations, the code is executed in an isolated namespace containing strictly whitelisted execution primitives:
   - Immutable builtins: `len`, `range`, `min`, `max`, `abs`, `round`, `enumerate`, `zip`, `isinstance`.
   - Analytical packages: pre-instantiated, thread-safe references to `polars` and `duckdb`.
   - The upstream step DataFrame passed as a read-only parameter.
3. **Execution Resource Boundaries:**
   Replays execute with thread-level timeout limits and memory ceiling monitors to prevent infinite loops (`while True`) or memory exhaustion attacks.

---

### Topic 4: Embedded In-Process DuckDB Architecture vs. Postgres / Spark

#### The Architectural Decision
Many data investigation platforms require provisioning external infrastructure—either a dedicated relational database (PostgreSQL/MySQL) or a distributed cluster (Apache Spark/Databricks). 

Data Rewind rejected this pattern in favor of an **in-process DuckDB engine**:
```
+-------------------------------------------------------------+
|                      Host Process                           |
|  +--------------------+     Zero-IPC     +---------------+  |
|  | Python Backend API | <--------------> | In-Process    |  |
|  | (FastAPI, Polars)  |   Direct Memory  | DuckDB Engine |  |
|  +--------------------+                  +---------------+  |
+-------------------------------------------------------------+
```

#### Why DuckDB Over Spark
- **Operational Complexity:** Spark requires a JVM daemon, cluster manager (YARN/K8s), driver/worker coordination, and minutes of cluster spin-up time. Data Rewind boots in under 1.5 seconds.
- **Latency & Overhead:** Spark's query planning and shuffle overhead make sub-second tabular comparisons impossible for datasets under 10 million rows. DuckDB executes columnar vectorised scans with zero network shuffle latency.
- **Strict ₹0 Budget:** Zero cloud instances, zero cluster management fees, zero ingress/egress costs.

#### Why DuckDB Over PostgreSQL
- **Row vs. Columnar Storage:** PostgreSQL is an OLTP row-store optimized for point lookups and transactions. Tabular diffing requires multi-column scans, aggregations, and large hash joins—workloads where DuckDB's vectorized columnar execution is 10x–50x faster.
- **Zero-Copy Interoperability:** DuckDB natively integrates with Apache Arrow and Polars in memory. Polars DataFrames are queried by DuckDB via pointer exchange without serializing to disk or converting between data formats.
- **Memory Ceiling Enforcement:** DuckDB is initialized with explicit memory parameters (`SET max_memory = '1GB'`), guaranteeing the investigative process will never trigger the host operating system's Out-Of-Memory (OOM) killer.

---

### Topic 5: Earliest Observable Divergence (EOD) vs. Downstream Blast Radius

#### The Problem
In a complex Directed Acyclic Graph (DAG) with 20 pipeline steps, a single upstream logic error at Step 3 (e.g., incorrect currency conversion) propagates through all downstream aggregations, joins, and reporting marts (Steps 4 through 20). 
Naive monitoring tools flag all 17 downstream steps as "failed" or "divergent," creating massive alert fatigue and obscuring the root cause under a large "blast radius."

#### The Data Rewind Architecture
Data Rewind formalizes the distinction between **divergence origin** and **divergence propagation** using topological DAG traversal and five Diagnostic Rules (DR-01 to DR-05):

```
Step 1 [Parity]
   |
   v
Step 2 [Parity]
   |
   v
Step 3 [DIVERGENT]  <=== EARLIEST OBSERVABLE DIVERGENCE (EOD Beacon)
   |
   +-------------------+
   |                   |
   v                   v
Step 4 [Divergent]   Step 5 [Divergent]  <=== Downstream Blast Radius
   |                   |                      (Propagated Taint)
   v                   v
Step 6 [Divergent]   Step 7 [Divergent]
```

#### Diagnostic Rules Framework
1. **DR-01 (Topological Sequencing):** Steps are evaluated strictly according to DAG dependency order. No step can be declared an EOD candidate until all its upstream parents have been evaluated.
2. **DR-02 (Parent Parity Invariant):** A step $S_i$ is classified as the **Earliest Observable Divergence (EOD)** if and only if:
   $$\text{Status}(S_i) = \text{Divergent} \quad \land \quad \forall P \in \text{Parents}(S_i), \text{Status}(P) = \text{Parity}$$
3. **DR-03 (Taint Propagation):** If any parent $P \in \text{Parents}(S_i)$ is already marked as divergent, step $S_i$'s divergence is categorized as **Downstream Blast Radius (Tainted)**, preventing false-positive root cause alarms.
4. **DR-04 (Schema vs Data Divergence):** Distinguishes structural schema changes (column additions, deletions, type mutations) from value-level row modifications. A schema mutation immediately isolates structural breaking changes.
5. **DR-05 (DuckDB Forensic Evidence Binding):** An EOD claim is rejected unless backed by cryptographic multiset fingerprint inequality and DuckDB row-level anti-join evidence isolating the exact primary keys or row values that diverged.

This guarantees that an engineer opening Data Rewind immediately sees an active visual beacon on Step 3, with Steps 4–20 clearly designated as secondary propagated impact.

---

## 3. Verified Metrics & Performance Benchmarks

All metrics documented below were directly measured on local development hardware and verified in test suites:

| Benchmark / Quality Gate | Measured Result | Benchmark Target / Specification Standard | Status |
| :--- | :--- | :--- | :--- |
| **500,000-Row Comparison Latency** | **605 ms** | Sub-second ($< 1,000 \text{ ms}$) | **PASS** |
| **Peak Resident Set Size (RSS)** | **301.9 MiB** | Controlled host memory footprint ($< 1 \text{ GB}$) | **PASS** |
| **Backend Test Suite (Pytest)** | **251 / 251 passing (100%)** | 100% pass rate across 15 test suites | **PASS** |
| **Code Coverage (Statement + Branch)** | **90.66%** ($5,939 / 6,542$ elements) | $\ge 85.00\%$ production standard | **PASS** |
| **Branch Coverage (Pure Branch)** | **81.69%** ($1,111 / 1,360$ branches) | Rigorous conditional coverage | **PASS** |
| **Frontend Unit / Component Tests** | **17 / 17 passing (100%)** | 100% pass rate (Vitest + Testing Library) | **PASS** |
| **End-to-End Browser Tests (Playwright)**| **15 / 15 passing (100%)** | 100% pass rate across 4 browser specs | **PASS** |
| **Automated Smoke Test Verification** | **8 / 8 passing (100%)** | End-to-end API & scenario health check | **PASS** |
| **Static Type Checking (Mypy)** | **0 errors** (strict mode) | Complete type safety across core engine | **PASS** |
| **Code Linter & Formatter (Ruff)** | **0 errors, 0 warnings** | Full PEP 8 and linting adherence | **PASS** |
| **Operational & Cloud Infrastructure Cost**| **₹0 / $0** | Offline-first, embedded DuckDB/SQLite | **PASS** |

---

## 4. Key Limitations & Design Boundaries

To maintain technical credibility in engineering discussions, these honest boundaries should be explicitly acknowledged:

1. **Single-Node Scale Ceiling:** Designed for single-node local execution (up to $\sim 10$–$50$ million rows depending on host RAM). It is not a distributed computing engine like Spark or Flink.
2. **In-Memory Buffer Ceiling:** Relies on local RAM and DuckDB's managed disk spillage. Datasets exceeding available local disk capacity cannot be ingested.
3. **No Hosted Multi-Tenant Authentication:** As an offline-first investigative tool, authentication is boundary-free on localhost; it does not implement OAuth2/SAML multi-tenancy.
4. **Local Git Workspace Dependency:** Verification of pipeline revisions requires a clean local Git repository containing the target pipeline commit history.
