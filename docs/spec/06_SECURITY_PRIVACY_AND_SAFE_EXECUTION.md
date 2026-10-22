# Data Rewind — Security, Privacy & Safe Execution

**Document Version:** 1.2.0-FINAL-CLOSURE  
**Milestone:** 0.3 (Final Specification Closure & Implementation-Readiness Audit)  
**Status:** Complete Specification / Ready for Owner Review & Explicit Approval  
**Module Identifier:** `SPEC-MOD-06`

---

## 1. Threat Modeling & Attack Surface Analysis

Data Rewind operates as an engineering forensic platform processing user-uploaded tabular datasets and declarative pipeline definitions. To ensure safety, a formal threat analysis identifies six primary threat vectors:

```
+----------------------------------------------------------------------------------------------------+
|                                    DATA REWIND THREAT MATRIX                                       |
+----------------------------------------------------------------------------------------------------+
|  Threat ID  | Vector                       | Consequence                       | Security Severity  |
| :---        | :---                         | :---                              | :---               |
| **TH-01**   | Malformed CSV / CSV Bombs    | Host Memory Crash / ReDoS         | HIGH               |
| **TH-02**   | Expression Injection         | Remote Code Execution (RCE)       | CRITICAL           |
| **TH-03**   | File Path Traversal          | Arbitrary Host File Read/Write    | HIGH               |
| **TH-04**   | Cartesian Product Explosion  | Host Disk / RAM Exhaustion        | MEDIUM             |
| **TH-05**   | Client-Side CSV Injection    | Spreadsheet Formula Exploit (XLS) | MEDIUM             |
| **TH-06**   | Covert Data Exfiltration     | Breach of User Confidentiality    | HIGH               |
+----------------------------------------------------------------------------------------------------+
```

---

## 2. Hardened CSV Ingestion & Parser Safeguards (TH-01)

1. **Size & Dimension Caps:**
   - Maximum upload file size: **50 MB** (Workstation mode) / **10 MB** (Hosted web demo mode).
   - Maximum dataset rows: **500,000 rows**.
   - Maximum dataset columns: **100 columns**.
   - Maximum line length: **65,536 bytes**.
   - Maximum individual cell length: **4,096 characters**. Any cell exceeding this threshold aborts parsing with `CELL_LENGTH_LIMIT_EXCEEDED(row, col)`.
2. **Encoding & Delimiter Handling:**
   - Input bytes are validated as strict UTF-8 with automatic fallback to Latin-1/ISO-8859-1. UTF-8 with BOM (`utf-8-sig`) is automatically detected and the BOM is stripped. Unhandled raw binary triggers `INVALID_ENCODING_ERROR`.
   - Null bytes (`\x00`) in headers or cell values are strictly rejected to prevent string termination vulnerabilities in native C parsers.
   - Delimiter detection is performed across the first 64 KB using a bounded sniffer supporting comma (`,`), semicolon (`;`), and tab (`\t`).
3. **Record Validation & Header Integrity:**
   - **RFC 4180 Quoting:** Double-quote escaping (`""`) is handled strictly per RFC 4180. Newlines inside quoted fields are valid and preserved.
   - **Malformed Records:** Records with field counts that do not match the header abort parsing with line-numbered `MALFORMED_CSV_RECORD_ERROR(line_number, expected_cols, observed_cols)`.
   - **Duplicate Headers:** Automatically rejected with `DUPLICATE_HEADER_ERROR(col_name)` or disambiguated with sequential suffixes (`col_1`, `col_2`) accompanied by an explicit warning.
   - **Empty Headers:** Aborts with `EMPTY_HEADER_ERROR(column_index)`.
4. **Temporary File Sanitization:**
   - File uploads are streamed into isolated temporary files (`~/.data_rewind/tmp/{uuid}.tmp`).
   - If an error occurs during ingestion or validation, the temporary file is unlinked immediately in a `finally` block.

---

## 3. Sandboxed AST Expression Engine & Runtime Bounds (TH-02)

Data Rewind allows users to define row filters (e.g. `order_amount > 100 and status == 'PAID'`) and derived columns (e.g. `gross - coalesce(discount, 0)`).

> [!IMPORTANT]
> **Strict Anti-RCE Rule:**  
> The Python functions `eval()`, `exec()`, `compile()`, and `__import__()` are **strictly forbidden** anywhere in the Data Rewind codebase.

### 3.1 Why AST Parsing Alone Is Insufficient
Parsing an expression into an Abstract Syntax Tree (AST) verifies syntax, but is **not** sufficient on its own to guarantee safety. Runtime attacks such as unbounded memory allocations (`'A' * 1000000`), CPU exhaustion via giant exponentiation (`2 ** 1000000`), deep recursion, or malicious operator overloading must be constrained by **runtime complexity bounds**:

```
                              User Expression
                       `order_amount * 1.18 + coalesce(fee, 0)`
                                     │
                                     ▼
                          Python `ast.parse(mode='eval')`
                                     │
                                     ▼
                         [ AST Security Validator ]
            1. Whitelisted node check (No Attribute, Lambda, Import)
            2. Depth verification: depth <= 10
            3. Node count verification: nodes <= 50
            4. Expression string length: <= 1,000 characters
            5. Exponentiation check: disallow `Pow` or bound exp <= 4
            6. String multiplication check: disallow str * int
                                     │
                 ┌───────────────────┴───────────────────┐
                 ▼                                       ▼
         [ Forbidden Node / Bound ]               [ Allowed Node ]
    e.g. Attribute (`.__class__`),           e.g. BinOp (`+`, `*`), Name (`fee`),
    `2 ** 1000000`, `'A' * 1000000`          Constant (`1.18`), Call (`coalesce`)
                 │                                       │
                 ▼                                       ▼
       ABORT IMMEDIATELY                     [ Vectorized Execution ]
   `SECURITY_VALIDATION_ERROR`             DuckDB SQL / Arrow Engine
                                           - Batch execution timeout: 1.0s
                                           - Cooperative cancellation token
```

### 3.2 Explicit AST Allowlist & Bounds
- **Allowed AST Types:** `Expression`, `BinOp`, `UnaryOp`, `BoolOp`, `Compare`, `Name`, `Constant`, `IfExp`, `Call`.
- **Allowed Operators:** `Add`, `Sub`, `Mult`, `Div`, `Mod`, `Eq`, `NotEq`, `Lt`, `LtE`, `Gt`, `GtE`, `And`, `Or`, `Not`.
- **Prohibited Operators & Operations:**
  - `Pow` (`**`): Exponentiation is strictly prohibited or bounded to integer exponents $\le 4$ to prevent CPU freeze on `2**10000000`.
  - String Multiplication (`str * int`): Prohibited to prevent memory exhaustion attacks (`'A'*1000000`).
  - Container Literals: `List`, `Dict`, `Set`, `Tuple` displays are prohibited.
  - Comprehensions: `ListComp`, `DictComp`, `SetComp`, `GeneratorExp` are prohibited.
- **Forbidden AST Types (Immediate Rejection):** `Attribute` (blocks dunder traversal like `x.__class__.__bases__`), `Subscript`, `Lambda`, `Import`, `ImportFrom`, `Assign`, `FunctionDef`, `ClassDef`.
- **Structural Complexity Limits:**
  - Maximum AST Tree Depth: $\le 10$.
  - Maximum AST Total Node Count: $\le 50$.
  - Maximum Raw Expression String Length: $\le 1,000$ characters.
- **Whitelisted Pure Functions:** `abs`, `round`, `upper`, `lower`, `trim`, `coalesce`, `if_else`, `date_diff`, `len`. All other function identifiers trigger immediate validation error.
- **Runtime Step Budget & Timeout:** Vectorized expression execution is bound to a 1.0-second execution timeout per row batch.

---

## 4. Path Traversal & Jail Enforcement (TH-03 & TH-04)

1. **Sandboxed Root Directory:**
   - All workspace files, cached Parquet artifacts, and SQLite databases must reside strictly under:
     `{USER_HOME}/.data_rewind/workspaces/{workspace_id}/`
2. **Path Sanitization & Jail Enforcement:**
   - Any path resolution must pass `os.path.realpath`, resolve symlinks, and verify that the target is strictly inside the workspace directory using `is_relative_to`:
     ```python
     def validate_safe_path(target_path: Path, workspace_root: Path) -> Path:
         resolved = target_path.resolve(strict=False)
         root_resolved = workspace_root.resolve(strict=True)
         if not resolved.is_relative_to(root_resolved):
             raise SecurityException(f"Path traversal attempt blocked: {target_path}")
         return resolved
     ```
   - Windows-specific path semantics (case-insensitivity, alternate stream names `file::$DATA`, 8.3 short filenames) are handled by resolving real canonical paths before validation.
3. **Cartesian Product Circuit Breakers (TH-04):**
   - For all `join_datasets` operations, the engine estimates the output row count prior to execution. If an unkeyed join produces $> 1,000,000$ rows or expands the row count by $> 10\times$ the combined input size, the join is halted with `CARTESIAN_EXPLOSION_BLOCKED`.

---

## 5. Type-Aware CSV Formula-Injection Mitigation (TH-05)

Spreadsheet applications (Microsoft Excel, LibreOffice Calc) interpret cells beginning with `=`, `+`, `-`, `@`, `\t`, or `\r` as formulas or DDE execution commands.

### 5.1 Type-Aware Escaping Policy
Blanket prefixing of `-` with `'` corrupts valid negative numbers (e.g. converting `-42` to string `'-42'`). Data Rewind implements **Type-Aware Escaping**:
1. **Numeric Columns:** Columns typed as `INTEGER` or `FLOAT` are **never** prefixed. Numeric signs (`-` and `+`) remain valid numbers.
2. **Text / String Columns:**
   - Strip leading whitespace (` `, `\t`, `\r`, `\n`).
   - If the first non-whitespace character is in `{ '=', '+', '-', '@', '\t', '\r' }`:
     - Attempt a strict numeric parse (`float(val)` or `int(val)`). If it parses as a valid number, output untouched.
     - If it does **not** parse as a number (e.g. `=SUM(...)`, `-cmd|...`, `@calc`), prefix an apostrophe (`'`).
3. **Two Export Flavors:**
   - **Raw Data Export:** Outputs raw byte-for-byte unescaped data for programmatic and SQL ingestion.
   - **Spreadsheet-Safe Export:** Applies type-aware formula escaping for safe opening in desktop spreadsheet applications.

---

## 6. Privacy, Deletion & Realistic Local Boundaries (TH-06)

1. **Realistic Privacy Boundaries:**
   - Data Rewind does not make unsupported claims of "absolute cryptographic privacy."
   - The application executes **100% locally on the host workstation**.
   - User datasets and intermediate artifacts are stored on the local filesystem (`~/.data_rewind/`).
   - **Zero External Transfers:** Data Rewind makes zero outbound network calls to external AI/LLM providers (no OpenAI, Anthropic, or cloud endpoints). All processing is executed via local embedded DuckDB and Python runtimes.
   - **Zero Telemetry:** The application contains zero tracking cookies, Google Analytics, or remote telemetry beacons.
2. **Application-Managed Deletion Limitations:**
   - When users click **"Delete All Workspace Data"**, Data Rewind unlinks all raw inputs, Parquet checkpoints, temporary files, and SQLite records, executing `VACUUM`.
   - **Physical Erasure Disclaimer:** As documented in `SPEC-MOD-02`, operating-system file unlinking does not provide forensic sanitization against SSD wear-leveling, filesystem journaling, or volume shadow copies. The application guarantees removal from active catalogs and workspace paths, not military-grade zeroization.
