# Data Rewind — Shared Domain Model & Data Lifecycle

**Document Version:** 1.2.0-FINAL-CLOSURE  
**Milestone:** 0.3 (Final Specification Closure & Implementation-Readiness Audit)  
**Status:** Complete Specification / Ready for Owner Review & Explicit Approval  
**Module Identifier:** `SPEC-MOD-02`

---

## 1. Domain Model Architecture & Entities

Data Rewind enforces a single, unified domain model across **Demo Mode**, **CSV Upload Mode**, and **Developer Mode**. The engine provides identical correctness guarantees, hashing algorithms, and comparison semantics regardless of whether an execution was triggered from a pre-packaged demo, a web UI upload, or a programmatic developer specification.

```
+----------------------------------------------------------------------------------------------------+
|                                    SHARED DOMAIN ENTITY RELATIONSHIPS                              |
+----------------------------------------------------------------------------------------------------+
|                                                                                                    |
|    [ Workspace ]                                                                                   |
|          │ 1                                                                                       |
|          ├──► [ Dataset ] 1 ──* [ DatasetVersion ] ──► [ Schema ]                                  |
|          │                                                                                         |
|          └──► [ PipelineDefinition ] 1 ──* [ PipelineVersion ]                                     |
|                                                    │ 1                                             |
|                                                    ├──* [ TransformationStep ]                     |
|                                                    │                                               |
|                                                    └──* [ PipelineRun ]                            |
|                                                              │ 1                                   |
|                                                              ├──* [ StepExecution ]                |
|                                                              │          │ 1                        |
|                                                              │          └──► [ Artifact ]          |
|                                                              │                                     |
|    [ Comparison (Run A vs Run B) ]                           └──► [ ReplayManifest ]               |
|          │ 1                                                                                       |
|          ├──* [ StepDiff ] ──► [ RowDeltaStats ]                                                   |
|          ├──* [ Finding ] ──► [ EvidencePayload ]                                                  |
|          └──* [ DownstreamImpactPath ]                                                             |
|                                                                                                    |
|    [ FixVerification (Run Baseline vs Run Faulted vs Run Fix) ]                                    |
|          │                                                                                         |
|          └──► [ InvestigationReport ]                                                              |
+----------------------------------------------------------------------------------------------------+
```

### 1.1 Entity Dictionary & Schemas

#### 1. Workspace
- **Purpose:** Top-level boundary ensuring complete local isolation of datasets, pipeline runs, and cached artifacts.
- **Attributes:**
  - `workspace_id: UUID` (Primary Key)
  - `name: str` (Human-readable workspace label)
  - `mode: WorkspaceMode` (`"DEMO" | "CSV_UPLOAD" | "DEVELOPER"`)
  - `storage_directory: Path` (Local path: `~/.data_rewind/workspaces/{workspace_id}/`)
  - `is_locked: bool` (Mutex flag preventing concurrent mutating executions in the same workspace)
  - `created_at: ISO8601_Timestamp`
  - `retention_policy_days: int` (Default: 30 days for user workspaces, 0 / ephemeral for guest sessions)

#### 2. Dataset & DatasetVersion
- **Purpose:** Represents an ingested tabular data asset. Datasets are strictly append-only; any modification or re-upload spawns a new `DatasetVersion`.
- **Dataset Attributes:**
  - `dataset_id: UUID`
  - `workspace_id: UUID`
  - `name: str` (e.g. `"raw_orders"`)
  - `created_at: ISO8601_Timestamp`
- **DatasetVersion Attributes:**
  - `version_id: UUID`
  - `dataset_id: UUID`
  - `version_number: int` (Incrementing integer: 1, 2, ...)
  - `storage_path: Path` (Immutable local storage path: `~/.data_rewind/artifacts/{sha256}.parquet`)
  - `raw_source_path: Optional[Path]` (Preserved raw source bytes: `~/.data_rewind/workspaces/{id}/raw_inputs/{sha256}.csv`)
  - `content_hash: str` (SHA-256 hex digest of the raw byte content)
  - `multiset_hash: str` (Canonical order-independent row multiset hash incorporating multiplicity)
  - `row_count: int`
  - `byte_size: int`
  - `schema_id: UUID`
  - `primary_key_columns: list[str]` (Explicit or inferred primary key candidate; empty if keyless)
  - `created_at: ISO8601_Timestamp`

#### 3. Schema & ColumnDefinition
- **Purpose:** Formal structural contract of a tabular dataset or intermediate artifact.
- **Schema Attributes:**
  - `schema_id: UUID`
  - `column_count: int`
  - `fingerprint_sha256: str` (Hash of sorted column names, normalized types, and nullability)
  - `columns: list[ColumnDefinition]`
- **ColumnDefinition Attributes:**
  - `name: str` (Case-preserved column identifier)
  - `data_type: DataType` (`"STRING" | "INTEGER" | "FLOAT" | "BOOLEAN" | "DATE" | "TIMESTAMP"`)
  - `is_nullable: bool`
  - `ordinal_position: int`

#### 4. PipelineDefinition & PipelineVersion
- **Purpose:** Defines the DAG topology and transformation logic. Any change to a transformation parameter or graph edge increments the `PipelineVersion`.
- **PipelineVersion Attributes:**
  - `pipeline_version_id: UUID`
  - `pipeline_id: UUID`
  - `version_number: int`
  - `definition_hash: str` (Deterministic SHA-256 digest of serialized canonical DAG steps and configs)
  - `steps: list[TransformationStep]`
  - `inputs: list[PipelineInputBinding]`
  - `outputs: list[PipelineOutputBinding]`
  - `created_at: ISO8601_Timestamp`

#### 5. TransformationStep
- **Purpose:** A single atomic node in the DAG execution graph.
- **Attributes:**
  - `step_id: str` (Human-readable slug, e.g. `"step_clean_orders"`)
  - `operation_type: OperationType` (e.g. `"filter_rows"`, `"join_datasets"`, `"aggregate_group_by"`)
  - `input_step_ids: list[str]` (Preceding DAG step IDs or raw input IDs)
  - `parameters: dict[str, Any]` (Validated parameters conforming to operation schema)
  - `description: Optional[str]`

#### 6. PipelineRun
- **Purpose:** The concrete execution of a pinned `PipelineVersion` against specific `DatasetVersion` bindings.
- **Attributes:**
  - `run_id: UUID`
  - `pipeline_version_id: UUID` (Strictly pinned at run initialization)
  - `run_type: RunType` (`"BASELINE" | "INVESTIGATION_PROBE" | "FIX_VERIFICATION" | "HISTORICAL_REPLAY"`)
  - `lifecycle_status: RunLifecycle` (`"PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED" | "INTERRUPTED"`)
  - `input_bindings: dict[str, UUID]` (Mapping of input `input_id` $\rightarrow$ `dataset_version_id`)
  - `started_at: Optional[ISO8601_Timestamp]`
  - `completed_at: Optional[ISO8601_Timestamp]`
  - `last_heartbeat_at: Optional[ISO8601_Timestamp]` (Updated every 5s during active execution)
  - `duration_ms: Optional[int]`
  - `peak_memory_bytes: Optional[int]`
  - `error_summary: Optional[str]`
  - `replay_manifest_id: Optional[UUID]`

#### 7. StepExecution & Artifact
- **Purpose:** Records the runtime telemetry and output artifact produced by each individual step.
- **StepExecution Attributes:**
  - `execution_id: UUID`
  - `run_id: UUID`
  - `step_id: str`
  - `status: StepStatus` (`"SUCCESS" | "FAILED" | "SKIPPED" | "CANCELLED"`)
  - `started_at: ISO8601_Timestamp`
  - `completed_at: ISO8601_Timestamp`
  - `duration_ms: int`
  - `output_artifact_id: Optional[UUID]`
  - `error_message: Optional[str]`
- **Artifact Attributes:**
  - `artifact_id: UUID`
  - `storage_path: Path` (Local storage file: `~/.data_rewind/artifacts/{sha256}.parquet`)
  - `row_count: int`
  - `byte_size: int`
  - `schema_id: UUID`
  - `content_hash: str` (SHA-256 of byte stream)
  - `multiset_hash: str` (Order-independent row multiset digest with multiplicity)
  - `is_verified: bool` (Flagged True if hash was re-verified on disk)

---

## 2. Content Hashing & Fingerprinting Mathematics

```
Raw Row: {"id": 101, "amount": 45.50, "status": "COMPLETED"}
                             │
                             ▼
  Canonical String Serialization (UTF-8, sorted keys, ISO formats)
  `id=101|amount=45.500000|status=COMPLETED`
                             │
                             ▼
                  SHA-256 Hash per Row ($h_i$)
                             │
            +----------------+----------------+
            │                                 │
            ▼                                 ▼
   Keyed Row Mapping              Order-Independent Multiset Hash
   `PK(101) -> h_101`              $$H_{M}(D) = \sum_{r \in D} \text{int}(h(r)) \pmod{2^{256}}$$
```

### 2.1 Canonical Row Serialization
For any row $r$, its canonical byte representation $C(r)$ is defined as:
$$C(r) = \text{UTF-8}\left( \bigparallel_{k \in \text{sorted}(\text{columns})} \left( k \parallel \text{"="} \parallel S(r[k]) \parallel \text{"\|"} \right) \right)$$
where $S(v)$ is the type-specific canonical string normalizer:
- **Null / None:** `"\x00_NULL_\x00"`
- **Boolean:** `"TRUE"` or `"FALSE"`
- **Integer:** ASCII decimal representation (no leading zeros, e.g. `"42"`).
- **Float:** Fixed-point IEEE-754 representation normalized to 6 decimal places to eliminate platform-dependent trailing zero variances.
- **String:** NFC unicode normalized, un-trimmed, case-preserved.
- **Date / Timestamp:** ISO-8601 string (`YYYY-MM-DD` or `YYYY-MM-DDTHH:MM:SS.ffffffZ`).

The row hash is:
$$h(r) = \text{SHA-256}(C(r))$$

### 2.2 Order-Independent Multiset Hashing with Multiplicity
To detect whether two keyless datasets contain identical rows regardless of row ordering while strictly accounting for duplicate rows, Data Rewind implements an additive multiset hash over modular integer arithmetic:
$$H_{\text{multiset}}(D) = \left( \sum_{r \in D} \text{int}(h(r)) \right) \pmod{2^{256}}$$
- **Multiplicity Property:** If row $r$ occurs $k$ times in dataset $D$, its hash $h(r)$ contributes exactly $k \times \text{int}(h(r))$ to the summation.
- **Commutative & Associative:** Permuting row order leaves $H_{\text{multiset}}$ invariant.
- **Collision Policy:** SHA-256 collision probability is $< 2^{-256}$. However, a matching hash is never treated as magical recovery of missing files. In audit mode, an explicit byte-level verification pass confirms identity.

---

## 3. Comprehensive Run, Artifact & Replay Lifecycle

### 3.1 Run Lifecycle State Transitions
Every pipeline run strictly adheres to the finite state machine:

```
                  [ PENDING ]
                       │
                       ▼
                  [ RUNNING ] ───(Cancellation Requested)───► [ CANCELLED ]
                       │
       ┌───────────────┼───────────────┐
       ▼               ▼               ▼
 [ COMPLETED ]     [ FAILED ]    (Heartbeat Lost / Crash)
                                       │
                                       ▼
                                [ INTERRUPTED ]
```

- **Cancellation:** When a user clicks "Cancel Run", an atomic cancellation token is set. The engine halts before starting the next step. Active temporary files for the in-progress step are immediately unlinked. The in-progress step is marked `CANCELLED`, all downstream steps are marked `SKIPPED`, and all completed upstream step artifacts remain preserved and inspectable.
- **Crash Recovery & Heartbeats:** During execution, the backend writes a timestamp heartbeat every 5 seconds. On application startup, a startup scanner inspects all runs: any run in `RUNNING` or `PENDING` with no active heartbeat for $> 60$ seconds is transitioned to `INTERRUPTED`. Orphaned temporary files are automatically pruned.
- **Partial Outputs:** Upstream steps completed before a failure, cancellation, or interruption remain saved, valid, and fully inspectable in the DAG.

### 3.2 Atomic Artifact Publication & Checksums
Intermediate step outputs are materialized with full ACID durability:
1. Output data is written to a private temporary file: `~/.data_rewind/tmp/{run_id}_{step_id}.tmp.parquet`.
2. The engine flushes file buffers to disk via `os.fsync()`.
3. The SHA-256 checksum of the completed file is computed.
4. An atomic rename (`os.replace`) publishes the file to its content-addressed vault path:
   `~/.data_rewind/artifacts/{sha256}.parquet`
5. The `Artifact` metadata record is committed to SQLite.
6. **Corruption Detection:** Whenever an artifact is read from disk for comparison or replay, its SHA-256 checksum is re-verified against the catalog. If a mismatch occurs, the engine raises a `CORRUPTED_ARTIFACT_ERROR`, marks the cache entry dirty, and prompts the user to re-execute the step.

### 3.3 Disk Exhaustion Handling
- **Pre-Flight Disk Check:** Before executing any run, the engine checks available local disk space. If free space is $< 100$ MB, execution is blocked with `INSUFFICIENT_DISK_SPACE_ERROR`.
- **Runtime Exhaustion:** If an `OSError(ENOSPC)` occurs during artifact materialization, the active step is caught cleanly, temporary files are pruned, and the run transitions to `FAILED` with explicit error advice to free workstation disk space.

### 3.4 Concurrency & Pipeline Changes During Execution
- **Pipeline Version Immutability:** When a run starts, it binds to a specific `PipelineVersionID`. If a user edits a transformation in the UI builder while a run is executing, that edit creates a new `PipelineVersion`. The executing run continues using its pinned version without interference.
- **Workspace Mutex Lock:** Each workspace enforces a file-based execution lock (`workspace.lock`). Concurrent runs within the same workspace are queued sequentially to prevent race conditions on local SQLite catalogs and temporary files.

---

## 4. Application-Managed Data Deletion vs. Physical Erasure

Data Rewind provides an explicit **"Delete All Workspace Data"** action in UI Settings.

### 4.1 Scope of Application-Managed Removal
When triggered, the backend executes the following bounded cleanup sequence:
1. Unlinks all raw input CSV files in `raw_inputs/`.
2. Unlinks all intermediate and terminal Parquet artifacts associated with the workspace in `artifacts/`.
3. Unlinks all temporary files in `tmp/`.
4. Deletes all associated records in SQLite (Runs, Steps, Comparisons, Findings, Manifests).
5. Executes SQLite `VACUUM` and checkpointing to truncate the Write-Ahead Log (`metadata.db-wal`).
6. Unlinks the workspace root directory.

### 4.2 Explicit Limitations (No Unsupported Physical Destruction Claims)
> [!IMPORTANT]
> **Forensic Erasure Disclaimer**  
> Data Rewind performs standard operating-system file unlinking. It does **not** provide military-grade disk zeroization (DoD 5220.22-M) or guarantee complete physical erasure from underlying flash storage.
> 
> Due to:
> - **Solid-State Drive (SSD) Wear-Leveling and Flash Translation Layers (FTL),**
> - **Filesystem Journaling (NTFS / ext4 / APFS),**
> - **Operating System Volume Shadow Copies and RAM pagefile caches,**
> - **External backups or syncing utilities (Dropbox, OneDrive),**
> 
> physical byte traces may remain recoverable through specialized hardware forensics until overwritten. The application guarantees removal from its active catalogs and application-managed storage, not cryptographic sanitization of the physical drive.
