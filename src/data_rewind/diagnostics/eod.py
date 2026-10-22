"""Data Rewind Earliest Observable Divergence (EOD) detector.

Conforms strictly to Section 2.1 of SPEC-MOD-04.
"""

from __future__ import annotations

from data_rewind.diagnostics.models import (
    DiagnosticFinding,
    DiagnosticRuleID,
    EODResult,
    EODStatus,
    EvidenceTier,
    StepDiagnosticContext,
)
from data_rewind.diagnostics.rules import DiagnosticRuleEngine


class EODDetector:
    """Detects Earliest Observable Divergence (EOD) across pipeline execution runs."""

    @classmethod
    def detect_eod(
        cls,
        topological_order: list[str],
        step_contexts: dict[str, StepDiagnosticContext],
        step_dependencies: dict[str, list[str]] | None = None,
        terminal_step_ids: list[str] | None = None,
        has_unmaterialized_intermediates: bool = False,
    ) -> EODResult:
        """Identify the Earliest Observable Divergence node(s) and diagnose root causes."""
        if step_dependencies is not None:
            dependencies = step_dependencies
        else:
            # P2-03: When dependencies are omitted, infer linear sequence from topological_order
            dependencies = (
                {
                    topological_order[i]: [topological_order[i - 1]]
                    for i in range(1, len(topological_order))
                }
                if len(topological_order) > 1
                else {}
            )
        findings: list[DiagnosticFinding] = []

        # 1. Edge Case: Missing Intermediate Checkpoints (SPEC-MOD-04 2.1.1)
        if has_unmaterialized_intermediates:
            terminals = terminal_step_ids or ([topological_order[-1]] if topological_order else [])
            for term_id in terminals:
                ctx = step_contexts.get(term_id)
                if ctx and cls._step_diverged(ctx):
                    step_findings = DiagnosticRuleEngine.evaluate_step(ctx)
                    findings.extend(step_findings)
                    return EODResult(
                        status=EODStatus.COARSE_GRAINED_EOD,
                        divergent_step_ids=[term_id],
                        primary_eod_step=term_id,
                        is_coarse_grained=True,
                        findings=findings,
                        evidence_tier=EvidenceTier.PROVEN_OBSERVATION,
                        summary=(
                            f"COARSE_GRAINED_EOD (Intermediates not materialized): "
                            f"Output divergence observed at terminal sink '{term_id}'."
                        ),
                    )

            return EODResult(
                status=EODStatus.NO_DIVERGENCE,
                divergent_step_ids=[],
                primary_eod_step=None,
                is_coarse_grained=True,
                findings=[],
                evidence_tier=EvidenceTier.PROVEN_OBSERVATION,
                summary="No divergence observed at terminal sinks.",
            )

        # 2. Edge Case: Upstream Input Data Drift (SPEC-MOD-04 2.1.3)
        for step_id in topological_order:
            ctx = step_contexts.get(step_id)
            if ctx and ctx.is_ingestion_node and cls._step_diverged(ctx):
                step_findings = DiagnosticRuleEngine.evaluate_step(ctx)
                findings.extend(step_findings)
                return EODResult(
                    status=EODStatus.UPSTREAM_INPUT_DATA_DRIFT,
                    divergent_step_ids=[step_id],
                    primary_eod_step=step_id,
                    is_coarse_grained=False,
                    findings=findings,
                    evidence_tier=EvidenceTier.CAUSAL_HYPOTHESIS_INPUT_DRIFT,
                    summary=(
                        f"Earliest Observable Divergence detected at ingestion step '{step_id}'. "
                        "Upstream input file changed content hash."
                    ),
                )

        # 3. Identify all divergent steps across the graph
        divergent_steps: set[str] = set()
        for step_id in topological_order:
            ctx = step_contexts.get(step_id)
            if ctx and cls._step_diverged(ctx):
                divergent_steps.add(step_id)

        if not divergent_steps:
            return EODResult(
                status=EODStatus.NO_DIVERGENCE,
                divergent_step_ids=[],
                primary_eod_step=None,
                is_coarse_grained=False,
                findings=[],
                evidence_tier=EvidenceTier.PROVEN_OBSERVATION,
                summary="No divergence detected across pipeline steps; all outputs identical.",
            )

        # 4. Filter for root divergent nodes (steps whose upstream dependencies did NOT diverge)
        root_divergent_steps: list[str] = []
        for step_id in topological_order:
            if step_id in divergent_steps:
                upstream_deps = dependencies.get(step_id, [])
                # If no upstream dependencies diverged, this is an origin divergence node
                if not any(dep in divergent_steps for dep in upstream_deps):
                    root_divergent_steps.append(step_id)

        if not root_divergent_steps:
            # Fallback to first topological divergent step
            first_divergent = next(s for s in topological_order if s in divergent_steps)
            root_divergent_steps = [first_divergent]

        # 5. Evaluate findings on root divergent steps
        for step_id in root_divergent_steps:
            ctx = step_contexts.get(step_id)
            if ctx:
                findings.extend(DiagnosticRuleEngine.evaluate_step(ctx))

        # Check for Non-Deterministic Transformation (SPEC-MOD-04 2.1.4)
        is_nondeterministic = any(
            f.rule_id == DiagnosticRuleID.DR_06_NONDETERMINISTIC_TRANSFORMATION for f in findings
        )

        # 6. Multiple Independent Divergent Branches (SPEC-MOD-04 2.1.2)
        if len(root_divergent_steps) > 1:
            tier = EvidenceTier.PROVEN_OBSERVATION
            return EODResult(
                status=EODStatus.CONCURRENT_DIVERGENCE_POINTS,
                divergent_step_ids=root_divergent_steps,
                primary_eod_step=root_divergent_steps[0],
                is_coarse_grained=False,
                findings=findings,
                evidence_tier=tier,
                summary=(
                    f"Concurrent Divergence Points detected across {len(root_divergent_steps)} "
                    f"independent branches: {', '.join(root_divergent_steps)}."
                ),
            )

        # 7. Exact Single EOD Node
        primary_step = root_divergent_steps[0]
        primary_ctx = step_contexts[primary_step]

        # Determine evidence tier
        tier = EvidenceTier.PROVEN_OBSERVATION
        for f in findings:
            if f.step_id == primary_step:
                tier = f.evidence_tier
                break

        status = (
            EODStatus.NONDETERMINISTIC_TRANSFORMATION
            if is_nondeterministic
            else EODStatus.EXACT_EOD
        )

        return EODResult(
            status=status,
            divergent_step_ids=[primary_step],
            primary_eod_step=primary_step,
            is_coarse_grained=False,
            findings=findings,
            evidence_tier=tier,
            summary=(
                f"Earliest Observable Divergence (EOD) isolated at step '{primary_step}' "
                f"({primary_ctx.operation})."
            ),
        )

    @classmethod
    def _step_diverged(cls, ctx: StepDiagnosticContext) -> bool:
        """Return True if step outputs diverged between baseline and target."""
        if ctx.diff_result is not None:
            return not ctx.diff_result.is_equal

        if ctx.baseline_output_hash is not None and ctx.target_output_hash is not None:
            return ctx.baseline_output_hash != ctx.target_output_hash

        return False
