"""Data Rewind structured error hierarchy and diagnostic error codes.

All domain exceptions derive from DataRewindError and carry:
- code: Stable, machine-readable diagnostic error code.
- message: Actionable human-readable explanation without leaking sensitive row data.
- details: Optional dictionary of structured diagnostic parameters.
"""

from typing import Any


class DataRewindError(Exception):
    """Base exception for all Data Rewind errors."""

    default_code: str = "DATA_REWIND_ERROR"

    def __init__(
        self,
        message: str,
        code: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.code: str = code or self.default_code
        self.message: str = message
        self.details: dict[str, Any] = details or {}

    def to_dict(self) -> dict[str, Any]:
        """Return a structured diagnostic dictionary."""
        return {
            "error_code": self.code,
            "message": self.message,
            "details": self.details,
        }


# --- Domain and Validation Errors ---


class DomainValidationError(DataRewindError):
    """Raised when domain entities violate structural or field invariants."""

    default_code = "INVALID_DOMAIN_INPUT"


class InvalidLifecycleTransitionError(DataRewindError):
    """Raised when an illegal run lifecycle transition is requested."""

    default_code = "INVALID_LIFECYCLE_TRANSITION"


# --- Graph & DAG Errors ---


class GraphValidationError(DataRewindError):
    """Raised when a DAG structure violates topological invariants."""

    default_code = "INVALID_GRAPH_ERROR"


class CyclicDependencyError(GraphValidationError):
    """Raised when a DAG contains a cycle, identifying the cycle path."""

    default_code = "CYCLIC_DEPENDENCY_ERROR"


class DanglingReferenceError(GraphValidationError):
    """Raised when a step references an unknown or unregistered predecessor."""

    default_code = "DANGLING_REFERENCE_ERROR"


# --- Security Errors ---


class SecurityError(DataRewindError):
    """Base class for security and safety guard violations."""

    default_code = "SECURITY_VALIDATION_ERROR"


class PathTraversalError(SecurityError):
    """Raised when an artifact or workspace path escapes the sandboxed jail."""

    default_code = "PATH_TRAVERSAL_BLOCKED"


class ExpressionSecurityError(SecurityError):
    """Raised when an expression attempts forbidden AST nodes or operations."""

    default_code = "EXPRESSION_SECURITY_ERROR"


class ExpressionComplexityError(SecurityError):
    """Raised when an expression exceeds structural complexity limits (depth, nodes, length)."""

    default_code = "EXPRESSION_COMPLEXITY_EXCEEDED"


class ExpressionTimeoutError(SecurityError):
    """Raised when batch expression evaluation exceeds its time budget."""

    default_code = "EXPRESSION_EVALUATION_TIMEOUT"


# --- Database & Runtime Errors ---


class DuckDBRuntimeError(DataRewindError):
    """Raised when a DuckDB operation or query fails."""

    default_code = "DUCKDB_OPERATION_ERROR"


# --- Integrity & Artifact Errors ---


class ArtifactIntegrityError(DataRewindError):
    """Raised when an artifact checksum mismatch indicates file corruption."""

    default_code = "CORRUPTED_ARTIFACT_ERROR"


class ArtifactNotFoundError(DataRewindError):
    """Raised when a referenced artifact does not physically exist in the vault."""

    default_code = "ARTIFACT_NOT_FOUND"


# --- Resource Limit Errors (8-Column Matrix) ---


class ResourceLimitExceededError(DataRewindError):
    """Base exception for resource limit violations."""

    default_code = "RESOURCE_LIMIT_EXCEEDED"


class FileSizeLimitExceededError(ResourceLimitExceededError):
    """Raised when raw uploaded payload exceeds byte limit (e.g. 50 MB)."""

    default_code = "FILE_SIZE_LIMIT_EXCEEDED"


class RowCountLimitExceededError(ResourceLimitExceededError):
    """Raised when dataset rows exceed cardinality limit (e.g. 500,000 rows)."""

    default_code = "ROW_COUNT_LIMIT_EXCEEDED"


class ColumnCountLimitExceededError(ResourceLimitExceededError):
    """Raised when header column count exceeds limit (e.g. 100 columns)."""

    default_code = "COLUMN_COUNT_LIMIT_EXCEEDED"


class CellLengthLimitExceededError(ResourceLimitExceededError):
    """Raised when an individual cell exceeds character limit (4,096 chars)."""

    default_code = "CELL_LENGTH_LIMIT_EXCEEDED"


class LineLengthLimitExceededError(ResourceLimitExceededError):
    """Raised when a raw line length exceeds byte limit (65,536 bytes)."""

    default_code = "LINE_LENGTH_EXCEEDED"


class StepTimeoutError(ResourceLimitExceededError):
    """Raised when a transformation step exceeds execution timeout (120 seconds)."""

    default_code = "STEP_EXECUTION_TIMEOUT"


class InsufficientDiskSpaceError(ResourceLimitExceededError):
    """Raised when workstation disk space falls below pre-flight minimum (100 MB)."""

    default_code = "INSUFFICIENT_DISK_SPACE_ERROR"


class ProcessMemoryExceededError(ResourceLimitExceededError):
    """Raised when backend process RSS reaches ceiling (512 MiB)."""

    default_code = "OUT_OF_MEMORY_SAFEGUARD"
