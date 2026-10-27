"""Data Rewind Fix Verification & Forensic Reporting Subsystem.

Conforms strictly to SPEC-MOD-05, SPEC-MOD-02, and SPEC-MOD-07.
Provides:
- Tri-Run Fix Verification Protocol (R0 Baseline, R1 Faulted, R2 Candidate Fix)
- Dual-Axis Evaluation Matrix (Remediation Axis vs. Baseline Equivalence Axis)
- Canonical Verdict Taxonomy (VERIFIED_CLEAN, INTENTIONAL_UPDATE, PARTIAL_RESTORATION, etc.)
- Forensic Investigation Dossier Generation (JSON, Markdown, and Type-Aware CSV exports)
- Local-first SQLite Persistence with WAL mode
"""

from data_rewind.verification.evaluator import TriRunEvaluator, TriRunValidationError
from data_rewind.verification.models import (
    BaselineEquivalenceAxisResult,
    DualAxisEvaluation,
    EvidenceItem,
    EvidenceTier,
    ForensicDossier,
    ForensicDossierMetadata,
    IntentionalUpdateContract,
    MissingEvidenceDeclaration,
    RemediationAxisResult,
    RunRole,
    TriRunVerification,
    VerificationSummary,
    VerificationVerdict,
)
from data_rewind.verification.orchestrator import FixVerificationOrchestrator
from data_rewind.verification.persistence import VerificationRepository
from data_rewind.verification.reports import (
    CSVDossierExporter,
    CSVFormulaEscaper,
    JSONDossierExporter,
    MarkdownDossierExporter,
)

__all__ = [
    "BaselineEquivalenceAxisResult",
    "CSVFormulaEscaper",
    "CSVDossierExporter",
    "DualAxisEvaluation",
    "EvidenceItem",
    "EvidenceTier",
    "FixVerificationOrchestrator",
    "ForensicDossier",
    "ForensicDossierMetadata",
    "IntentionalUpdateContract",
    "JSONDossierExporter",
    "MarkdownDossierExporter",
    "MissingEvidenceDeclaration",
    "RemediationAxisResult",
    "RunRole",
    "TriRunEvaluator",
    "TriRunValidationError",
    "TriRunVerification",
    "VerificationRepository",
    "VerificationSummary",
    "VerificationVerdict",
]
