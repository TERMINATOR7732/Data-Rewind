# Data Rewind End-to-End Performance & Memory Benchmark Suite

**Generated:** 2026-10-28T09:32:36.011192+00:00  
**Environment:** Windows 10 | CPUs: 12 | Total RAM: 15,777.8 MiB | Python: 3.12.0 | DuckDB: 2.0.0

## 1. Benchmarked Operations Matrix

| Category | Operation | Elapsed (ms) | Peak RSS (MiB) | Delta RSS (MiB) | Status | Key Details |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| CSV Ingestion | `csv_ingestion_1k` | 132.8 ms | 62.8 MiB | 23.9 MiB | **PASS** | 7,533 rows/s |
| CSV Ingestion | `csv_ingestion_10k` | 80.7 ms | 64.5 MiB | 12.0 MiB | **PASS** | 123,882 rows/s |
| CSV Ingestion | `csv_ingestion_50k` | 110.8 ms | 66.7 MiB | 14.2 MiB | **PASS** | 451,176 rows/s |
| Tabular Keyed Comparison | `keyed_comparison_10k` | 70.1 ms | 71.2 MiB | 7.2 MiB | **PASS** | Partitions: VALID |
| Tabular Keyed Comparison | `keyed_comparison_50k` | 148.1 ms | 91.9 MiB | 12.3 MiB | **PASS** | Partitions: VALID |
| Tabular Keyed Comparison | `keyed_comparison_100k` | 248.1 ms | 115.0 MiB | 20.7 MiB | **PASS** | Partitions: VALID |
| Tabular Keyed Comparison | `keyed_comparison_500k` | 623.8 ms | 301.3 MiB | 104.3 MiB | **PASS** | Partitions: VALID |
| Tabular Keyless Comparison | `keyless_multiset_10k` | 125.9 ms | 82.5 MiB | 9.9 MiB | **PASS** | Partitions: VALID |
| Full Pipeline Execution | `pipeline_execution_dag` | 57.3 ms | 71.4 MiB | 7.2 MiB | **PASS** | 3 steps |
| Historical Replay & Manifest Verification | `manifest_replay_and_tamper_detection` | 50.1 ms | 74.1 MiB | 9.2 MiB | **PASS** | - |
| Tri-Run Fix Verification | `tri_run_verification_clean` | 513.4 ms | 71.3 MiB | 6.5 MiB | **PASS** | Verdict: VERIFIED_CLEAN |
| Tri-Run Fix Verification | `tri_run_verification_unresolved` | 512.1 ms | 71.4 MiB | 1.8 MiB | **PASS** | Verdict: REGRESSION_UNRESOLVED |

## 2. Budget Gate Evaluation

| Gate / Invariant | Threshold Target | Actual Measured | Status |
| :--- | :--- | :--- | :--- |
| Process Peak RSS Limit | < 512.0 MiB | 301.3 MiB | **PASS** |
| Partition Completeness Invariant | 100% Valid | 100% Valid | **PASS** |
| 500k Keyed Comparison Wall Time | < 1,500.0 ms | 623.8 ms | **PASS** |
| 500k Keyed Comparison Delta RSS | < 120.0 MiB | 104.3 MiB | **PASS** |

**Final Milestone 6.0 Benchmark Verdict:** ALL BUDGETS PASSED
