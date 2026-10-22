# Data Rewind — Product Specification Audit & Master Index

**Document Version:** 1.2.0-FINAL-CLOSURE  
**Milestone:** 0.3 (Final Specification Closure & Implementation-Readiness Audit)  
**Status:** Complete Specification / Ready for Owner Review & Explicit Approval  
**Date:** October 2026  
**Project Category:** Data Engineering, Pipeline Lineage, Reproducibility, Regression Investigation, and Evidence-Based Debugging  
**Portfolio Position:** Project #5 (Preceded by INTEGRIS, CodeShip, PathForge, Opwise)  
**Tagline:** *Understand the past. Verify the present.*

---

## 1. Executive Summary

Data processing pipelines in modern enterprise and analytics workflows frequently fail silently: they complete with exit code `0`, pass superficial row-count checks, and emit validly formatted tabular files, yet produce corrupted, mathematically drifted, or structurally broken downstream data. When business reports, metric dashboards, or machine learning models consume these outputs, engineers and analysts are tasked with answering difficult retrospective questions:

1. **What changed?** (Was it an upstream input schema shift, changed data values, a code/transformation edit, or an environment anomaly?)
2. **Where did it diverge?** (At which exact intermediate transformation step did the first observable deviation emerge?)
3. **What is the downstream impact?** (Which downstream intermediate artifacts, marts, and reports were contaminated?)
4. **Can we reproduce the historical baseline?** (Given retained input data and pipeline configurations, does the past run reproduce deterministically?)
5. **Does the proposed fix actually resolve the regression?** (Does the corrected pipeline restore baseline equivalence without introducing secondary regressions?)

**Data Rewind** is an evidence-based pipeline regression debugging, lineage tracing, and reproducibility platform. It systematically implements the rigorous investigation loop:

$$\text{Run} \longrightarrow \text{Detect} \longrightarrow \text{Compare} \longrightarrow \text{Trace} \longrightarrow \text{Assess Impact} \longrightarrow \text{Reproduce} \longrightarrow \text{Fix} \longrightarrow \text{Verify} \longrightarrow \text{Report}$$

Data Rewind operates strictly under a local-first, privacy-preserving, zero-cost (₹0 recurring expenditure) engineering philosophy. It executes deterministic transformation engines, compares keyed and keyless datasets with mathematical rigor, produces defensible evidence chains (explicitly segregating observable facts from causal hypotheses), and verifies bug fixes through tri-run comparison.

---

## 2. Document Suite Navigation & Canonical Hierarchy

`SPECIFICATION.md` serves as the authoritative, canonical single source of truth for the Data Rewind platform. The supporting documents modularize deep domain specifications and are kept strictly synchronized:

| Document | Name & Title | Scope & Key Final Contents |
| :--- | :--- | :--- |
| **00** | [Index & Executive Summary](file:///e:/MHT%20CET%20REGISTRATION/BE/Task/DataRewind/docs/spec/00_INDEX_AND_EXECUTIVE_SUMMARY.md) | Vision, portfolio positioning, INTEGRIS differentiation, navigation index. |
| **01** | [PRD & Operating Modes](file:///e:/MHT%20CET%20REGISTRATION/BE/Task/DataRewind/docs/spec/01_PRODUCT_REQUIREMENTS_AND_OPERATING_MODES.md) | Personas, user journeys, 10-point specifications for Demo Mode (`SCN-01` to `SCN-04`), CSV Mode (12 transforms), and Developer Mode. |
| **02** | [Domain Model & Lifecycle](file:///e:/MHT%20CET%20REGISTRATION/BE/Task/DataRewind/docs/spec/02_SHARED_DOMAIN_MODEL_AND_LIFECYCLE.md) | Shared entity schemas, state machines, atomic artifact publication, crash recovery, multiset hashing math, bounded application deletion. |
| **03** | [Execution, DAG & Reproducibility](file:///e:/MHT%20CET%20REGISTRATION/BE/Task/DataRewind/docs/spec/03_EXECUTION_ENGINE_DAG_AND_REPRODUCIBILITY.md) | Kahn's DAG cycle detection, intermediate artifact checkpoints, ReplayManifest spec, 4-way replay distinction, 5 replay outcomes, edge cases. |
| **04** | [Comparison & Impact Analysis](file:///e:/MHT%20CET%20REGISTRATION/BE/Task/DataRewind/docs/spec/04_ROW_COMPARISON_DIAGNOSTICS_AND_IMPACT.md) | Exact 15-case comparison semantics, unverified benchmark targets, EOD exact rules, categorical evidence tiers without arbitrary scores. |
| **05** | [Fix Verification & Reports](file:///e:/MHT%20CET%20REGISTRATION/BE/Task/DataRewind/docs/spec/05_FIX_VERIFICATION_AND_FORENSIC_REPORTS.md) | Tri-run verification edge cases, verdict taxonomy, type-aware CSV export & formula injection mitigation, Raw vs Safe CSV modes. |
| **06** | [Security, Privacy & Limits](file:///e:/MHT%20CET%20REGISTRATION/BE/Task/DataRewind/docs/spec/06_SECURITY_PRIVACY_AND_SAFE_EXECUTION.md) | Threat matrix, RFC 4180 CSV parser guards, sandboxed AST expression engine with runtime bounds, path jail, realistic deletion limits, zero telemetry. |
| **07** | [System Architecture & API](file:///e:/MHT%20CET%20REGISTRATION/BE/Task/DataRewind/docs/spec/07_SYSTEM_ARCHITECTURE_AND_API_CONTRACTS.md) | Local-first operating model, loopback security, optional hosted demo profile, FastAPI + DuckDB + SQLite + React 18/19, REST contracts, error envelopes. |
| **08** | [UI/UX & Screen Inventory](file:///e:/MHT%20CET%20REGISTRATION/BE/Task/DataRewind/docs/spec/08_UI_UX_DESIGN_AND_SCREEN_INVENTORY.md) | Workbench design rationale, typography, tabular numerals, dark/light themes, 12-screen inventory with 5 explicit UI states. |
| **09** | [Resource Limits & Testing](file:///e:/MHT%20CET%20REGISTRATION/BE/Task/DataRewind/docs/spec/09_RESOURCE_LIMITS_AND_TESTING_STRATEGY.md) | 8-column resource limit table, operational metric reconciliation, formal Benchmark Protocol, testing pyramid, CI/CD workflow. |
| **10** | [Roadmap, Deployment & Decisions](file:///e:/MHT%20CET%20REGISTRATION/BE/Task/DataRewind/docs/spec/10_ROADMAP_DEPLOYMENT_AND_DECISION_REGISTER.md) | Milestones 0.1–6.0 roadmap, ₹0 deployment plan, Scope Matrix, Decision Register (D-01 to D-05), Approval Checklist. |
| **Master** | [Consolidated Specification](file:///e:/MHT%20CET%20REGISTRATION/BE/Task/DataRewind/docs/spec/SPECIFICATION.md) | Authoritative unified compilation of all 22 mandatory deliverables. |
| **Report** | [Milestone 0.3 Closure Report](file:///e:/MHT%20CET%20REGISTRATION/BE/Task/DataRewind/docs/spec/milestone_0_3_final_specification_closure_report.md) | Final implementation-readiness audit, 14 reporting sections, verification checklists. |

---

## 3. Portfolio Positioning & Technical Differentiation

### 3.1 Portfolio Ecosystem
Data Rewind occupies Position #5 in the portfolio suite:
1. **INTEGRIS:** Data integrity and forensics for isolated tabular datasets (static file profiling, semantic typing, trust scores).
2. **CodeShip:** Automated build validation, artifact deployment, and shipping pipelines.
3. **PathForge:** Career trajectory synthesis, skill ontology graphs, and gap analysis.
4. **Opwise:** Operational intelligence, prompt cost governance, and LLM latency optimization.
5. **Data Rewind:** Multi-step pipeline execution forensics, regression root-cause isolation, transformation-level lineage, historical replay, and fix verification.

### 3.2 Explicit Differentiation: Data Rewind vs. INTEGRIS

The boundaries between INTEGRIS and Data Rewind are non-overlapping and complementary:

```
+-----------------------------------------------------------------------------------------+
|                                    PORTFOLIO BOUNDARY                                   |
+-----------------------------------------------------------------------------------------+
|                                            |                                            |
|                  INTEGRIS                  |                DATA REWIND                 |
|       (Static Dataset Forensics)           |   (Pipeline Execution & Regression Debug)  |
|                                            |                                            |
| - Scope: Single static tabular artifact.   | - Scope: Multi-step DAG pipelines & runs.  |
| - Time: Point-in-time snapshot.            | - Time: Temporal progression across runs.  |
| - Focus: Statistical anomalies, format     | - Focus: Execution deltas, transformation  |
|   drift, placeholder missingness, cross-   |   divergence, downstream impact paths,     |
|   column lifecycle inversions, and dataset |   reproducibility manifests, and regression|
|   trust scoring (0.0 to 100.0).            |   fix verification.                        |
| - Core Question: "Is this dataset reliable | - Core Question: "Why did Run B diverge    |
|   enough to be used in production?"        |   from Run A, which transformation broke   |
|                                            |   it, and does the proposed fix work?"     |
| - Processing: In-memory forensic passes    | - Processing: Deterministic DAG execution, |
|   over raw uploaded tables.                |   intermediate artifact caching, row diffs |
|                                            |   (keyed & multiset), and replay engines.  |
| - Output: Forensic Dossier with Trust Score| - Output: Lineage Investigation Dossier,   |
|   and statistical profiling.               |   Root-Cause Evidence, Fix Verification.   |
+-----------------------------------------------------------------------------------------+
```

---

## 4. Milestone 0.3 Closure Scope & Execution Boundaries

Milestone 0.3 represents the final closure and implementation-readiness audit:
- **Zero code generation:** No React/Vite scaffolding, no FastAPI application code, no database migrations, no package installations.
- **Zero external resources:** No GitHub repository creation, no git commits, no Vercel deployments, no external API activations.
- **Specification Closure Focus:**
  1. Define the complete local-first operating model and separate optional hosted profile.
  2. Produce an 8-column comprehensive resource limit table with exact failure behaviors.
  3. Formulate the complete loss-aware Raw and Spreadsheet-Safe CSV import/export contracts.
  4. Specify deterministic replay inputs, edge-case outcomes, and canonical hashing rules.
  5. Correct physical deletion claims and establish bounded AST expression safety.
  6. Deliver full 10-point specifications for all 4 demo scenarios (`SCN-01` to `SCN-04`).
  7. Maintain canonical synchronization across `SPECIFICATION.md` and supporting documents.
