"""Data Rewind Lineage Traversal and Downstream Taint Tracking Engine.

Conforms strictly to SPEC-MOD-03 Section 2 and SPEC-MOD-04 Section 2.
"""

from __future__ import annotations

from collections import defaultdict, deque
from collections.abc import Sequence

from data_rewind.core.domain.models import TransformationStep
from data_rewind.lineage.models import BlastRadiusReport, LineageNode, TaintStatus


class LineageEngine:
    """Computes lineage graphs, downstream taint propagation, and blast radius reports."""

    @classmethod
    def build_adjacency(
        cls, steps: Sequence[TransformationStep]
    ) -> tuple[dict[str, list[str]], dict[str, list[str]], dict[str, TransformationStep]]:
        """Build forward (downstream) and backward (upstream) adjacency lists for steps.

        Returns:
            forward_adj: step_id -> list of downstream dependent step_ids
            backward_adj: step_id -> list of upstream input step_ids
            steps_map: step_id -> TransformationStep
        """
        forward_adj: dict[str, list[str]] = defaultdict(list)
        backward_adj: dict[str, list[str]] = defaultdict(list)
        steps_map: dict[str, TransformationStep] = {}

        all_step_ids = {s.step_id for s in steps}

        for s in steps:
            steps_map[s.step_id] = s
            # Initialize empty lists
            if s.step_id not in forward_adj:
                forward_adj[s.step_id] = []
            if s.step_id not in backward_adj:
                backward_adj[s.step_id] = []

            for dep in s.input_step_ids:
                if dep in all_step_ids:
                    forward_adj[dep].append(s.step_id)
                    backward_adj[s.step_id].append(dep)

        return dict(forward_adj), dict(backward_adj), steps_map

    @classmethod
    def find_descendants(
        cls,
        forward_adj: dict[str, list[str]],
        origin_step_ids: Sequence[str],
    ) -> set[str]:
        """Perform BFS along dataflow direction to find all downstream descendants."""
        descendants: set[str] = set()
        queue: deque[str] = deque(origin_step_ids)

        while queue:
            curr = queue.popleft()
            for successor in forward_adj.get(curr, []):
                if successor not in descendants and successor not in origin_step_ids:
                    descendants.add(successor)
                    queue.append(successor)

        return descendants

    @classmethod
    def compute_downstream_blast_radius(
        cls,
        steps: Sequence[TransformationStep],
        origin_step_ids: Sequence[str],
        baseline_hashes: dict[str, str | None] | None = None,
        target_hashes: dict[str, str | None] | None = None,
        terminal_sink_ids: Sequence[str] | None = None,
    ) -> BlastRadiusReport:
        """Propagate taint from origin divergence points and calculate forensic blast radius.

        Args:
            steps: Pipeline transformation steps.
            origin_step_ids: Step IDs identified as divergence origins (e.g., from EOD).
            baseline_hashes: Optional mapping of step_id -> baseline output multiset/content hash.
            target_hashes: Optional mapping of step_id -> target output multiset/content hash.
            terminal_sink_ids: Optional list of explicit terminal sink step IDs.
        """
        forward_adj, backward_adj, steps_map = cls.build_adjacency(steps)
        b_hashes = baseline_hashes or {}
        t_hashes = target_hashes or {}
        origins = set(origin_step_ids)

        # BFS downstream descendants
        descendants = cls.find_descendants(forward_adj, origin_step_ids)
        tainted_all = origins | descendants

        # Identify terminal sinks: explicit terminal sinks or nodes with no downstream step
        if terminal_sink_ids is not None:
            sink_candidates = set(terminal_sink_ids)
        else:
            sink_candidates = {sid for sid, succs in forward_adj.items() if not succs}

        affected_terminal_sinks = sorted(sink_candidates & tainted_all)

        nodes: dict[str, LineageNode] = {}
        tainted_step_ids: list[str] = []
        confirmed_affected_step_ids: list[str] = []
        masked_step_ids: list[str] = []
        untainted_step_ids: list[str] = []

        for step in steps:
            sid = step.step_id
            b_h = b_hashes.get(sid)
            t_h = t_hashes.get(sid)
            is_origin = sid in origins
            op = (
                step.operation_type.value
                if hasattr(step.operation_type, "value")
                else str(step.operation_type)
            )

            if not (is_origin or sid in descendants):
                # Node is clean outside the blast radius
                status = TaintStatus.UNTAINTED
                untainted_step_ids.append(sid)
                explanation = "Clean node outside dataflow blast radius."
            elif is_origin:
                # Origin divergence point
                status = TaintStatus.CONFIRMED_AFFECTED
                tainted_step_ids.append(sid)
                confirmed_affected_step_ids.append(sid)
                explanation = "Origin point of earliest observable divergence (EOD)."
            else:
                # Descendant in blast radius
                tainted_step_ids.append(sid)
                if b_h is not None and t_h is not None:
                    if b_h != t_h:
                        status = TaintStatus.CONFIRMED_AFFECTED
                        confirmed_affected_step_ids.append(sid)
                        explanation = "Tainted descendant with empirically divergent output values."
                    else:
                        status = TaintStatus.MASKED_UNAFFECTED
                        masked_step_ids.append(sid)
                        explanation = (
                            "Topologically connected, but output values remain identical "
                            "to baseline (masked)."
                        )
                else:
                    # Missing or unmaterialized hashes: topologically potentially affected
                    status = TaintStatus.POTENTIALLY_AFFECTED
                    explanation = (
                        "Topological descendant in blast radius; output verification pending."
                    )

            is_divergent = status == TaintStatus.CONFIRMED_AFFECTED

            nodes[sid] = LineageNode(
                step_id=sid,
                operation=op,
                taint_status=status,
                is_origin=is_origin,
                is_divergent=is_divergent,
                input_step_ids=backward_adj.get(sid, []),
                output_step_ids=forward_adj.get(sid, []),
                baseline_output_hash=b_h,
                target_output_hash=t_h,
                explanation=explanation,
            )

        total_nodes = len(steps)
        tainted_count = len(tainted_step_ids)
        confirmed_count = len(confirmed_affected_step_ids)
        masked_count = len(masked_step_ids)
        untainted_count = len(untainted_step_ids)

        blast_ratio = (tainted_count / total_nodes) if total_nodes > 0 else 0.0
        confirmed_ratio = (confirmed_count / total_nodes) if total_nodes > 0 else 0.0

        # Trace upstream paths for each origin node
        upstream_paths: dict[str, list[list[str]]] = {}
        for orig in origin_step_ids:
            upstream_paths[orig] = cls.trace_upstream_paths(steps, orig)

        return BlastRadiusReport(
            origin_divergent_step_ids=list(origin_step_ids),
            total_nodes_count=total_nodes,
            tainted_nodes_count=tainted_count,
            confirmed_affected_count=confirmed_count,
            masked_count=masked_count,
            untainted_count=untainted_count,
            blast_radius_ratio=round(blast_ratio, 4),
            confirmed_divergence_ratio=round(confirmed_ratio, 4),
            tainted_step_ids=sorted(tainted_step_ids),
            confirmed_affected_step_ids=sorted(confirmed_affected_step_ids),
            masked_step_ids=sorted(masked_step_ids),
            untainted_step_ids=sorted(untainted_step_ids),
            affected_terminal_sinks=affected_terminal_sinks,
            nodes=nodes,
            upstream_paths=upstream_paths,
        )

    @classmethod
    def trace_upstream_paths(
        cls,
        steps: Sequence[TransformationStep],
        target_step_id: str,
    ) -> list[list[str]]:
        """Trace all acyclic directed paths from source roots leading into target_step_id."""
        _, backward_adj, _ = cls.build_adjacency(steps)

        paths: list[list[str]] = []

        def dfs(curr: str, current_path: list[str]) -> None:
            parents = backward_adj.get(curr, [])
            if not parents:
                paths.append(list(reversed(current_path)))
                return
            for parent in parents:
                if parent not in current_path:  # cycle protection
                    current_path.append(parent)
                    dfs(parent, current_path)
                    current_path.pop()

        dfs(target_step_id, [target_step_id])
        return sorted(paths)

    @classmethod
    def trace_downstream_paths(
        cls,
        steps: Sequence[TransformationStep],
        source_step_id: str,
    ) -> list[list[str]]:
        """Trace all acyclic directed paths from source_step_id to terminal sinks."""
        forward_adj, _, _ = cls.build_adjacency(steps)

        paths: list[list[str]] = []

        def dfs(curr: str, current_path: list[str]) -> None:
            children = forward_adj.get(curr, [])
            if not children:
                paths.append(list(current_path))
                return
            for child in children:
                if child not in current_path:  # cycle protection
                    current_path.append(child)
                    dfs(child, current_path)
                    current_path.pop()

        dfs(source_step_id, [source_step_id])
        return sorted(paths)
