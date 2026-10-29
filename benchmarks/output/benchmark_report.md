# Data Rewind End-to-End Performance & Memory Benchmark Suite

**Generated:** 2026-10-29T09:43:38.540683+00:00  
**Environment:** Windows 10 | CPUs: 12 | Total RAM: 15,777.8 MiB | Python: 3.12.0 | DuckDB: 2.0.0

## 1. Benchmarked Operations Matrix

| Category | Operation | Elapsed (ms) | Peak RSS (MiB) | Delta RSS (MiB) | Status | Key Details |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| CSV Ingestion | `csv_ingestion_1k` | 127.5 ms | 63.0 MiB | 24.1 MiB | **PASS** | 7,840 rows/s |
| CSV Ingestion | `csv_ingestion_10k` | 78.4 ms | 64.9 MiB | 12.4 MiB | **PASS** | 127,487 rows/s |
| CSV Ingestion | `csv_ingestion_50k` | 110.5 ms | 66.6 MiB | 14.1 MiB | **PASS** | 452,384 rows/s |
| Tabular Keyed Comparison | `keyed_comparison_10k` | 68.8 ms | 70.9 MiB | 7.2 MiB | **PASS** | Partitions: VALID |
| Tabular Keyed Comparison | `keyed_comparison_50k` | 151.2 ms | 91.7 MiB | 12.0 MiB | **PASS** | Partitions: VALID |
| Tabular Keyed Comparison | `keyed_comparison_100k` | 248.4 ms | 114.7 MiB | 21.7 MiB | **PASS** | Partitions: VALID |
| Tabular Keyed Comparison | `keyed_comparison_500k` | 605.1 ms | 301.9 MiB | 103.9 MiB | **PASS** | Partitions: VALID |
| Tabular Keyless Comparison | `keyless_multiset_10k` | 128.6 ms | 82.5 MiB | 10.0 MiB | **PASS** | Partitions: VALID |
| Full Pipeline Execution | `pipeline_execution_dag` | 58.2 ms | 72.2 MiB | 7.5 MiB | **PASS** | 3 steps |
| Historical Replay & Manifest Verification | `manifest_replay_and_tamper_detection` | 48.5 ms | 75.8 MiB | 11.8 MiB | **PASS** | - |
| Tri-Run Fix Verification | `tri_run_verification_clean` | 524.1 ms | 71.9 MiB | 7.8 MiB | **PASS** | Verdict: VERIFIED_CLEAN |
| Tri-Run Fix Verification | `tri_run_verification_unresolved` | 500.8 ms | 72.5 MiB | 1.4 MiB | **PASS** | Verdict: REGRESSION_UNRESOLVED |

## 2. Budget Gate Evaluation

| Gate / Invariant | Threshold Target | Actual Measured | Status |
| :--- | :--- | :--- | :--- |
| Process Peak RSS Limit | < 512.0 MiB | 301.9 MiB | **PASS** |
| Partition Completeness Invariant | 100% Valid | 100% Valid | **PASS** |
| 500k Keyed Comparison Wall Time | < 1,500.0 ms | 605.1 ms | **PASS** |
| 500k Keyed Comparison Delta RSS | < 120.0 MiB | 103.9 MiB | **PASS** |

**Final Milestone 6.0 Benchmark Verdict:** ALL BUDGETS PASSED
