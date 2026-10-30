/**
 * Downstream Taint & Blast Radius Analysis Engine.
 * Conforms strictly to SPEC-MOD-03 §2.1 and SPEC-MOD-04 §2.1.
 */

import { BlastRadiusReport, LineageNode, TaintStatus } from "../contracts";

export interface ComputeBlastRadiusOptions {
  originDivergentStepIds: string[];
  topologicalOrder: string[];
  stepDependencies: Record<string, string[]>; // stepId -> array of upstream input stepIds
  stepOutputsBaseline?: Record<string, { outputHash?: string | null }>;
  stepOutputsTarget?: Record<string, { outputHash?: string | null }>;
  operations?: Record<string, string>;
}

export class BlastRadiusEngine {
  /**
   * Computes downstream blast radius and categorizes every node's taint status.
   */
  public static computeBlastRadius(options: ComputeBlastRadiusOptions): BlastRadiusReport {
    const {
      originDivergentStepIds,
      topologicalOrder,
      stepDependencies,
      stepOutputsBaseline = {},
      stepOutputsTarget = {},
      operations = {},
    } = options;

    const totalNodesCount = topologicalOrder.length;
    if (totalNodesCount === 0) {
      return {
        origin_divergent_step_ids: [],
        total_nodes_count: 0,
        tainted_nodes_count: 0,
        confirmed_affected_count: 0,
        masked_count: 0,
        untainted_count: 0,
        blast_radius_ratio: 0.0,
        confirmed_divergence_ratio: 0.0,
        tainted_step_ids: [],
        confirmed_affected_step_ids: [],
        masked_step_ids: [],
        untainted_step_ids: [],
        affected_terminal_sinks: [],
        nodes: {},
        upstream_paths: {},
        confirmed_divergent_step_ids: [],
        total_graph_nodes: 0,
      };
    }

    // Build downstream adjacency list (successors)
    const successors: Record<string, string[]> = {};
    for (const stepId of topologicalOrder) {
      successors[stepId] = [];
    }

    for (const [stepId, upstreams] of Object.entries(stepDependencies)) {
      for (const upId of upstreams) {
        if (successors[upId]) {
          successors[upId].push(stepId);
        }
      }
    }

    // Identify terminal sinks (nodes with 0 outgoing edges)
    const allTerminalSinks = topologicalOrder.filter(
      (s) => !successors[s] || successors[s].length === 0
    );

    // BFS Traversal to collect all downstream reachable nodes from origins
    const taintedStepIdsSet = new Set<string>();
    const upstreamPaths: Record<string, string[][]> = {};
    const queue: Array<{ stepId: string; path: string[] }> = [];

    for (const origin of originDivergentStepIds) {
      if (topologicalOrder.includes(origin)) {
        taintedStepIdsSet.add(origin);
        queue.push({ stepId: origin, path: [origin] });
        upstreamPaths[origin] = [[origin]];
      }
    }

    while (queue.length > 0) {
      const { stepId, path } = queue.shift()!;
      const nextSteps = successors[stepId] || [];

      for (const next of nextSteps) {
        const nextPath = [...path, next];
        if (!upstreamPaths[next]) {
          upstreamPaths[next] = [];
        }
        upstreamPaths[next].push(nextPath);

        if (!taintedStepIdsSet.has(next)) {
          taintedStepIdsSet.add(next);
          queue.push({ stepId: next, path: nextPath });
        }
      }
    }

    const taintedStepIds = Array.from(taintedStepIdsSet);
    const untaintedStepIds: string[] = [];
    const confirmedAffectedStepIds: string[] = [];
    const maskedStepIds: string[] = [];
    const nodes: Record<string, LineageNode> = {};

    for (const stepId of topologicalOrder) {
      const isOrigin = originDivergentStepIds.includes(stepId);
      const isTainted = taintedStepIdsSet.has(stepId);

      const baseHash = stepOutputsBaseline[stepId]?.outputHash ?? null;
      const targHash = stepOutputsTarget[stepId]?.outputHash ?? null;
      const hashesAvailable = Boolean(baseHash && targHash);
      const isDivergent = hashesAvailable ? baseHash !== targHash : isOrigin;

      let taintStatus: TaintStatus;
      let explanation: string;

      if (!isTainted) {
        taintStatus = TaintStatus.UNTAINTED;
        explanation = "Step is topologically isolated from upstream divergence origins.";
        untaintedStepIds.push(stepId);
      } else if (isOrigin) {
        taintStatus = TaintStatus.CONFIRMED_AFFECTED;
        explanation = "Earliest Observable Divergence origin point.";
        confirmedAffectedStepIds.push(stepId);
      } else if (hashesAvailable && !isDivergent) {
        // Tainted path, but output values match baseline (e.g. filtered out bad rows)
        taintStatus = TaintStatus.MASKED_UNAFFECTED;
        explanation = "Descendant of divergence, but downstream filtering or transformation masked the delta.";
        maskedStepIds.push(stepId);
      } else if (hashesAvailable && isDivergent) {
        taintStatus = TaintStatus.CONFIRMED_AFFECTED;
        explanation = "Divergence propagated and output values differ from baseline.";
        confirmedAffectedStepIds.push(stepId);
      } else {
        // Intermediates not materialized
        taintStatus = TaintStatus.POTENTIALLY_AFFECTED;
        explanation = "Topologically descendant of divergence; intermediate checkpoints not materialized.";
      }

      nodes[stepId] = {
        step_id: stepId,
        operation: operations[stepId] || "transformation",
        taint_status: taintStatus,
        is_origin: isOrigin,
        is_divergent: isDivergent,
        input_step_ids: stepDependencies[stepId] || [],
        output_step_ids: successors[stepId] || [],
        baseline_output_hash: baseHash,
        target_output_hash: targHash,
        explanation,
      };
    }

    const affectedTerminalSinks = allTerminalSinks.filter((s) => taintedStepIdsSet.has(s));

    const blastRadiusRatio = Math.round((taintedStepIds.length / totalNodesCount) * 1000) / 1000;
    const confirmedDivergenceRatio =
      Math.round((confirmedAffectedStepIds.length / totalNodesCount) * 1000) / 1000;

    return {
      origin_divergent_step_ids: originDivergentStepIds,
      total_nodes_count: totalNodesCount,
      tainted_nodes_count: taintedStepIds.length,
      confirmed_affected_count: confirmedAffectedStepIds.length,
      masked_count: maskedStepIds.length,
      untainted_count: untaintedStepIds.length,
      blast_radius_ratio: blastRadiusRatio,
      confirmed_divergence_ratio: confirmedDivergenceRatio,
      tainted_step_ids: taintedStepIds,
      confirmed_affected_step_ids: confirmedAffectedStepIds,
      masked_step_ids: maskedStepIds,
      untainted_step_ids: untaintedStepIds,
      affected_terminal_sinks: affectedTerminalSinks,
      nodes,
      upstream_paths: upstreamPaths,
      confirmed_divergent_step_ids: confirmedAffectedStepIds,
      total_graph_nodes: totalNodesCount,
    };
  }
}
