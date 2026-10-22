# Data Rewind

> **Understand the past. Verify the present.**

Data Rewind is an engineering platform for investigating data-processing pipelines that produce changed, incorrect, or unexpected outputs over time. It provides evidence-based forensic debugging across pipeline runs:

$$\text{Run} \longrightarrow \text{Detect} \longrightarrow \text{Compare} \longrightarrow \text{Trace} \longrightarrow \text{Assess Impact} \longrightarrow \text{Reproduce} \longrightarrow \text{Fix} \longrightarrow \text{Verify} \longrightarrow \text{Report}$$

Data Rewind is built as a rigorous engineering tool—**not a generic dashboard, not an LLM wrapper, and not a chatbot**.

---

## Key Foundations (Milestone 1.0)

- **Vectorized In-Process Runtime (D-01):** DuckDB query engine abstraction with controlled connection lifecycles, memory ceiling configuration (`SET max_memory = '256MB'`), and transactional rollback on failure.
- **Deterministic DAG Orchestration:** Directed Acyclic Graph validator using Kahn's algorithm with deterministic lexicographical tie-breaking and exact cycle path extraction ($A \rightarrow B \rightarrow C \rightarrow A$).
- **Sandboxed AST Expression Engine:** Explicit syntax allowlist with strict Anti-RCE policy (`eval`, `exec`, `compile`, and dynamic imports permanently prohibited). Enforces AST depth $\le 10$, node count $\le 50$, string length $\le 1,000$, and blocks string multiplication and unbounded exponentiation.
- **Canonical Serialization & Multiset Hashing:**
  - Canonical row byte serialization: $C(r) = \text{UTF-8}\left( \parallel_{k \in \text{sorted(cols)}} k = S(v) \mid \right)$
  - Order-independent multiset hash with row multiplicity: $H_{\text{multiset}}(D) = \left( \sum_{r \in D} \text{int}(h(r)) \right) \pmod{2^{256}}$
- **Atomic Artifact Vault & Path Jail:** ACID file publishing via temporary buffer flushing, fsync, SHA-256 verification, and atomic `os.replace`, with path traversal validation blocking directory escapes.
- **8-Column Operational Resource Guard:** Standardized limits enforcement separating decimal units (MB = $10^6$ bytes) from binary units (MiB = $2^{20}$ bytes).
- **Zero-Cost (₹0) Local-First Architecture (D-05):** Runs 100% offline on loopback `127.0.0.1` without external APIs, cloud subscriptions, or telemetry.

---

## Quickstart & Environment Setup

### 1. Prerequisites
- Python 3.11 or 3.12 (64-bit)
- Git

### 2. Virtual Environment Setup
```powershell
# Create virtual environment
python -m venv .venv

# Activate environment (Windows PowerShell)
.\.venv\Scripts\Activate.ps1

# Install core and development dependencies in editable mode
pip install -r requirements-dev.txt
pip install -e .
```

### 3. Run Developer Diagnostics
```powershell
python -m data_rewind.cli diagnostics
```

### 4. Run Core Engine Smoke Test
```powershell
python -m data_rewind.smoke_test
```

### 5. Run Quality Gates & Tests
```powershell
# Run Ruff Linter
ruff check src tests

# Run Ruff Formatter Check
ruff format --check src tests

# Run Mypy Static Type Checker
mypy src

# Run Test Suite with Coverage (>= 90% threshold)
pytest -v --cov=data_rewind --cov-report=term-missing
```

---

## Project Structure

```
DataRewind/
├── .github/
│   └── workflows/
│       └── ci.yml               # GitHub Actions CI matrix (Ubuntu & Windows, Py 3.11/3.12)
├── docs/
│   ├── spec/                    # Canonical Specification v1.2.0-FINAL-CLOSURE (SPEC-MOD-00 to 10)
│   ├── reports/                 # Milestone closure and audit reports
│   └── DEVELOPER_GUIDE.md       # Comprehensive developer architecture and reference guide
├── src/
│   └── data_rewind/
│       ├── __init__.py
│       ├── cli.py               # Local diagnostic and smoke-test CLI
│       ├── smoke_test.py        # Integrated foundations verification workflow
│       └── core/
│           ├── config/          # Centralized settings and resource guard checks (8-col matrix)
│           ├── dag/             # Kahn's DAG validator, cycle diagnostics, and tie-breaking
│           ├── db/              # Controlled DuckDB runtime and transaction abstraction
│           ├── domain/          # Domain entities, value objects, lifecycle FSM, structured errors
│           ├── expr/            # Sandboxed AST parser, syntax allowlist, and safe evaluator
│           └── integrity/       # Canonical serialization, multiset hashing, manifests, and vault
├── tests/                       # 80 unit, security, integration, and determinism tests
├── pyproject.toml               # PEP 621 project configuration (Ruff, Mypy, Pytest, Coverage)
├── requirements.txt             # Pinned production dependencies
└── requirements-dev.txt         # Pinned development and QA dependencies
```

---

## Approved Architectural Decisions Traceability

| Decision ID | Summary | Implementation Status |
| :--- | :--- | :--- |
| **D-01** | Tabular Execution Engine: DuckDB | **Implemented in M1.0** (`DuckDBRuntime`, memory limits, transactions). |
| **D-02** | Lineage Canvas: `@xyflow/react` | **Deferred to M5.0** (Future UI milestone; no frontend in M1.0). |
| **D-03** | Ingestion File Scope: CSV Only in v1.0 | **Governs Specification** (Resource limits: 50 MB, 500k rows, 100 cols). |
| **D-04** | Demo Scenarios: 4 Deep Scenarios | **Codified in Specification** (Acceptance contracts for SCN-01 to 04). |
| **D-05** | Topology: Local-First Desktop Primary | **Implemented in M1.0** (100% offline, loopback, ₹0 recurring cost). |

---

## License

MIT License. See LICENSE file for details.
