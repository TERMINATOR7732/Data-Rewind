"""DAG validation and deterministic topological ordering using Kahn's algorithm.

Conforms strictly to Section 1 of SPEC-MOD-03.
Guarantees:
- Cycle detection with exact diagnostic cycle path.
- Deterministic lexicographical tie-breaking for parallel-eligible nodes.
- Full structural validation (cardinality, dangling references, duplicate IDs).
"""

from __future__ import annotations

import heapq
from collections import defaultdict, deque

from data_rewind.core.domain.errors import (
    CyclicDependencyError,
    DanglingReferenceError,
    GraphValidationError,
)
from data_rewind.core.domain.models import OperationType, TransformationStep


class DAGValidator:
    """Validates pipeline execution graphs and computes deterministic topological order."""

    @staticmethod
    def validate_and_order(
        steps: list[TransformationStep],
        registered_inputs: list[str] | None = None,
    ) -> list[str]:
        """Validate DAG structural invariants and return deterministic topological step order.

        Args:
            steps: List of transformation steps forming the DAG.
            registered_inputs: Optional list of external input identifiers available to steps.

        Returns:
            Deterministic list of step_ids in execution order.

        Raises:
            GraphValidationError: If duplicates, empty steps, or cardinality errors exist.
            DanglingReferenceError: If a dependency is unknown.
            CyclicDependencyError: If a cycle is detected.
        """
        if not steps:
            raise GraphValidationError(
                "Pipeline must contain at least one transformation step",
                code="EMPTY_PIPELINE",
            )

        inputs_set = set(registered_inputs or [])
        step_ids_set: set[str] = set()

        # 1. Check duplicate step IDs
        for step in steps:
            if step.step_id in step_ids_set:
                raise GraphValidationError(
                    f"Duplicate step identifier detected: '{step.step_id}'",
                    code="DUPLICATE_STEP_ID",
                    details={"step_id": step.step_id},
                )
            step_ids_set.add(step.step_id)

        all_valid_sources = step_ids_set | inputs_set

        # 2. Check self-dependencies and dangling references
        for step in steps:
            for dep in step.input_step_ids:
                if dep == step.step_id:
                    raise CyclicDependencyError(
                        f"Step '{step.step_id}' depends directly on itself",
                        details={"cycle": [step.step_id, step.step_id]},
                    )
                if dep not in all_valid_sources:
                    raise DanglingReferenceError(
                        f"Step '{step.step_id}' references unknown dependency '{dep}'",
                        details={"step_id": step.step_id, "unknown_dependency": dep},
                    )

            # 3. Cardinality verification
            DAGValidator._verify_operation_cardinality(step)

        # 4. Build adjacency graph for step-to-step dependencies
        # Edge (u -> v): step u must execute before step v
        adj: dict[str, list[str]] = defaultdict(list)
        in_degree: dict[str, int] = {step.step_id: 0 for step in steps}

        for step in steps:
            for dep in step.input_step_ids:
                # If dependency is another step in the DAG
                if dep in step_ids_set:
                    adj[dep].append(step.step_id)
                    in_degree[step.step_id] += 1

        # 5. Kahn's Algorithm with Lexicographical Min-Heap for deterministic tie-breaking
        ready_queue: list[str] = [sid for sid, deg in in_degree.items() if deg == 0]
        heapq.heapify(ready_queue)

        topological_order: list[str] = []

        while ready_queue:
            current = heapq.heappop(ready_queue)
            topological_order.append(current)

            for successor in adj[current]:
                in_degree[successor] -= 1
                if in_degree[successor] == 0:
                    heapq.heappush(ready_queue, successor)

        # 6. Cycle check
        if len(topological_order) < len(steps):
            cycle_path = DAGValidator._extract_cycle_path(adj, in_degree)
            cycle_repr = " -> ".join(cycle_path)
            raise CyclicDependencyError(
                f"Cyclic dependency detected in pipeline DAG: {cycle_repr}",
                details={"cycle": cycle_path},
            )

        return topological_order

    @staticmethod
    def _verify_operation_cardinality(step: TransformationStep) -> None:
        """Verify that step operation receives the canonical number of inputs."""
        input_count = len(step.input_step_ids)
        if step.operation_type == OperationType.JOIN_DATASETS:
            if input_count != 2:
                raise GraphValidationError(
                    f"Join operation '{step.step_id}' requires exactly 2 input dependencies, "
                    f"got {input_count}",
                    code="INVALID_JOIN_CARDINALITY",
                    details={"step_id": step.step_id, "input_count": input_count},
                )
        elif (
            step.operation_type
            in (
                OperationType.FILTER_ROWS,
                OperationType.DERIVE_COLUMN,
                OperationType.AGGREGATE_GROUP_BY,
                OperationType.DEDUPLICATE_ROWS,
                OperationType.CAST_COLUMNS,
            )
            and input_count != 1
        ):
            raise GraphValidationError(
                f"Operation '{step.operation_type.value}' in step '{step.step_id}' "
                f"requires exactly 1 input dependency, got {input_count}",
                code="INVALID_STEP_CARDINALITY",
                details={
                    "step_id": step.step_id,
                    "operation": step.operation_type.value,
                    "input_count": input_count,
                },
            )

    @staticmethod
    def _extract_cycle_path(
        adj: dict[str, list[str]],
        in_degree: dict[str, int],
    ) -> list[str]:
        """Deterministically extract an exact representative cycle path using DFS."""
        # Candidates are nodes that were not resolved (in_degree > 0)
        cycle_candidates = sorted([node for node, deg in in_degree.items() if deg > 0])

        visited: dict[str, int] = {}  # 0: unvisited, 1: visiting, 2: visited
        path: list[str] = []

        def dfs(node: str) -> list[str] | None:
            visited[node] = 1
            path.append(node)

            for neighbor in sorted(adj.get(node, [])):
                if in_degree.get(neighbor, 0) <= 0:
                    continue
                if visited.get(neighbor, 0) == 1:
                    # Found cycle: extract from neighbor to current and close loop
                    cycle_start_idx = path.index(neighbor)
                    return path[cycle_start_idx:] + [neighbor]
                if visited.get(neighbor, 0) == 0:
                    result = dfs(neighbor)
                    if result is not None:
                        return result

            visited[node] = 2
            path.pop()
            return None

        for start_node in cycle_candidates:
            if visited.get(start_node, 0) == 0:
                cycle = dfs(start_node)
                if cycle:
                    return cycle

        # Fallback if no clean loop found in candidates
        return cycle_candidates[:2] + [cycle_candidates[0]]

    @staticmethod
    def get_descendants(
        root_step_id: str,
        steps: list[TransformationStep],
    ) -> set[str]:
        """Compute all downstream topological descendants (blast radius) of a step."""
        adj: dict[str, list[str]] = defaultdict(list)
        for step in steps:
            for dep in step.input_step_ids:
                adj[dep].append(step.step_id)

        descendants: set[str] = set()
        queue: deque[str] = deque([root_step_id])

        while queue:
            curr = queue.popleft()
            for child in adj.get(curr, []):
                if child not in descendants:
                    descendants.add(child)
                    queue.append(child)

        return descendants
