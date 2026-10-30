/**
 * Data Rewind Deterministic Execution Planner.
 * Conforms to SPEC-MOD-02 & SPEC-MOD-07.
 * Implements Kahn's topological sort with strict lexicographical tie-breaking
 * to guarantee identical execution plans across all environments.
 */

import { PipelineDefinition, ExecutionPlan } from "../contracts/index";
import { ERROR_CODES, RuntimeError } from "../contracts/errors";
import { validatePipeline } from "./dag-validator";

export function createExecutionPlan(pipeline: PipelineDefinition): ExecutionPlan {
  // 1. Validate DAG structure and parameters
  const validation = validatePipeline(pipeline);
  if (!validation.valid) {
    const firstError = validation.issues.find((i) => i.severity === "ERROR");
    throw new RuntimeError(
      firstError?.code || ERROR_CODES.SQL_EXECUTION_ERROR,
      `Pipeline validation failed: ${firstError?.message || "Invalid pipeline"}`,
      { issues: validation.issues },
      firstError?.remediation
    );
  }

  // 2. Build adjacency and in-degree tables
  const nodeIds = pipeline.nodes.map((n) => n.nodeId);
  const successors = new Map<string, Set<string>>();
  const predecessors = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const id of nodeIds) {
    successors.set(id, new Set<string>());
    predecessors.set(id, []);
    inDegree.set(id, 0);
  }

  // Helper to add dependency: fromId -> toId (toId depends on fromId)
  const addDependency = (fromId: string, toId: string) => {
    if (!nodeIds.includes(fromId) || !nodeIds.includes(toId)) {
      return;
    }
    const currentPredecessors = predecessors.get(toId)!;
    if (!currentPredecessors.includes(fromId)) {
      currentPredecessors.push(fromId);
      successors.get(fromId)!.add(toId);
      inDegree.set(toId, (inDegree.get(toId) || 0) + 1);
    }
  };

  // Edges
  if (Array.isArray(pipeline.edges)) {
    for (const edge of pipeline.edges) {
      addDependency(edge.sourceNodeId, edge.targetNodeId);
    }
  }

  // node.inputNodeIds (preserve explicit input ordering, especially important for joins: [left, right])
  for (const node of pipeline.nodes) {
    if (Array.isArray(node.inputNodeIds)) {
      for (const inputId of node.inputNodeIds) {
        addDependency(inputId, node.nodeId);
      }
    }
  }

  // 3. Kahn's Algorithm with Stage Partitioning and Lexicographical Tie-breaking
  const stages: string[][] = [];
  const topologicalOrder: string[] = [];
  let tieBreakerApplied = false;

  // Initial ready nodes (in-degree 0)
  let readyNodes: string[] = [];
  for (const [id, deg] of inDegree.entries()) {
    if (deg === 0) {
      readyNodes.push(id);
    }
  }

  // Apply deterministic tie-breaking: sort ready nodes alphabetically by ID
  if (readyNodes.length > 1) {
    tieBreakerApplied = true;
  }
  readyNodes.sort((a, b) => a.localeCompare(b));

  const remainingInDegree = new Map<string, number>(inDegree);

  while (readyNodes.length > 0) {
    // Current stage contains all currently ready nodes
    const currentStage = [...readyNodes];
    stages.push(currentStage);
    topologicalOrder.push(...currentStage);

    const nextReadyNodes: string[] = [];

    for (const nodeId of currentStage) {
      const neighbors = successors.get(nodeId) || new Set();
      for (const neighbor of neighbors) {
        const currentDeg = remainingInDegree.get(neighbor)! - 1;
        remainingInDegree.set(neighbor, currentDeg);
        if (currentDeg === 0) {
          nextReadyNodes.push(neighbor);
        }
      }
    }

    if (nextReadyNodes.length > 1) {
      tieBreakerApplied = true;
    }
    nextReadyNodes.sort((a, b) => a.localeCompare(b));
    readyNodes = nextReadyNodes;
  }

  if (topologicalOrder.length !== nodeIds.length) {
    throw new RuntimeError(
      ERROR_CODES.CYCLIC_DEPENDENCY,
      "Pipeline contains an unresolvable cyclic dependency during topological planning."
    );
  }

  const stepInputs: Record<string, string[]> = {};
  for (const id of nodeIds) {
    stepInputs[id] = predecessors.get(id) || [];
  }

  return {
    planId: `plan_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    pipelineId: pipeline.pipelineId,
    topologicalOrder,
    stages,
    stepInputs,
    plannedAt: new Date().toISOString(),
    tieBreakerApplied,
  };
}
