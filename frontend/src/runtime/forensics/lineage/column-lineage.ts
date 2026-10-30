/**
 * Column-Level Forensic Lineage Engine.
 * Traces producing transformations, AST expression inputs, and multi-step provenance.
 */

import { PipelineDefinition } from "../../contracts/index";
import { parseExpression } from "../../expr/index";
import { ASTNode } from "../../expr/ast";
import { ColumnLineageResult, ColumnLineageSource } from "../contracts";

/**
 * Recursively extracts all column identifier names referenced in an AST expression.
 */
function extractIdentifiers(node: ASTNode): string[] {
  const identifiers: string[] = [];

  function traverse(n: ASTNode) {
    if (n.type === "Identifier") {
      identifiers.push(n.name);
    } else if (n.type === "UnaryOp") {
      traverse(n.argument);
    } else if (n.type === "BinaryOp") {
      traverse(n.left);
      traverse(n.right);
    } else if (n.type === "Call") {
      for (const arg of n.args) {
        traverse(arg);
      }
    }
  }

  traverse(node);
  return Array.from(new Set(identifiers));
}

export class ColumnLineageTracker {
  /**
   * Traces column-level lineage backwards to source datasets and forwards to consumers.
   */
  public static traceColumnLineage(
    pipeline: PipelineDefinition,
    targetStepId: string,
    targetColumn: string
  ): ColumnLineageResult {
    const nodeMap = new Map(pipeline.nodes.map((n) => [n.nodeId, n]));
    const targetNode = nodeMap.get(targetStepId);

    if (!targetNode) {
      return {
        target_step_id: targetStepId,
        target_column: targetColumn,
        producing_operation: "UNKNOWN",
        direct_input_columns: [],
        upstream_sources: [],
        downstream_consumers: [],
        is_derived: false,
        is_ambiguous: true,
      };
    }

    const p = targetNode.parameters || {};
    let isDerived = false;
    let expression: string | undefined = undefined;
    let directInputs: string[] = [];

    // 1. Analyze target step's transformation rules
    switch (targetNode.operationType) {
      case "derive_column": {
        const targetColName = (p.target_column || p.new_column || p.column) as string;
        if (targetColName === targetColumn && p.expression) {
          isDerived = true;
          expression = p.expression;
          try {
            const ast = parseExpression(p.expression);
            directInputs = extractIdentifiers(ast);
          } catch {
            directInputs = [];
          }
        } else {
          directInputs = [targetColumn];
        }
        break;
      }

      case "rename_columns": {
        const mapping = (p.column_mapping || p.mapping || p.renames || {}) as Record<string, string>;
        // Reverse lookup: check if targetColumn was renamed from an old column
        const oldCol = Object.keys(mapping).find((k) => mapping[k] === targetColumn);
        directInputs = [oldCol || targetColumn];
        break;
      }

      case "aggregate_group_by": {
        const groupKeys: string[] = p.group_keys || p.group_by_columns || [];
        if (groupKeys.includes(targetColumn)) {
          directInputs = [targetColumn];
        } else if (Array.isArray(p.aggregations)) {
          const matchedAgg = p.aggregations.find((a: any) => a.alias === targetColumn);
          if (matchedAgg && matchedAgg.column && matchedAgg.column !== "*") {
            directInputs = [matchedAgg.column];
            isDerived = true;
          }
        } else if (typeof p.aggregations === "object") {
          directInputs = [targetColumn];
          isDerived = true;
        }
        break;
      }

      case "join_datasets": {
        if (targetColumn.endsWith("_right")) {
          const stripped = targetColumn.slice(0, -6);
          directInputs = [stripped];
        } else {
          directInputs = [targetColumn];
        }
        break;
      }

      default: {
        // select_columns, drop_columns, filter_rows, deduplicate_rows, sort_rows, etc.
        directInputs = [targetColumn];
        break;
      }
    }

    // 2. Find upstream source datasets by walking backwards
    const upstreamSources: ColumnLineageSource[] = [];
    const visited = new Set<string>();

    function traceBack(nodeId: string, colName: string, path: string[]) {
      const visitKey = `${nodeId}:${colName}`;
      if (visited.has(visitKey)) return;
      visited.add(visitKey);

      const n = nodeMap.get(nodeId);
      if (!n) return;

      const currentPath = [n.operationType, ...path];
      const inputs = n.inputNodeIds || [];

      // Determine upstream columns needed by this node for colName
      let upstreamCols = [colName];
      if (n.operationType === "derive_column") {
        const targetCol = (n.parameters?.target_column || n.parameters?.new_column) as string;
        if (targetCol === colName && n.parameters?.expression) {
          try {
            const ast = parseExpression(n.parameters.expression);
            upstreamCols = extractIdentifiers(ast);
          } catch {
            upstreamCols = [];
          }
        }
      } else if (n.operationType === "rename_columns") {
        const mapping = (n.parameters?.column_mapping || n.parameters?.mapping || n.parameters?.renames || {}) as Record<string, string>;
        const oldCol = Object.keys(mapping).find((k) => mapping[k] === colName);
        if (oldCol) {
          upstreamCols = [oldCol];
        }
      }

      if (inputs.length === 0 || (pipeline.sourceDatasets && pipeline.sourceDatasets[nodeId])) {
        // Ingestion boundary / source dataset
        const dsName = pipeline.sourceDatasets ? pipeline.sourceDatasets[nodeId] || nodeId : nodeId;
        for (const uCol of upstreamCols) {
          upstreamSources.push({
            source_dataset: dsName,
            source_column: uCol,
            transformations: currentPath,
          });
        }
        return;
      }

      for (const inId of inputs) {
        for (const uCol of upstreamCols) {
          const inNode = nodeMap.get(inId);
          const inCols = (inNode?.parameters?.columns || inNode?.parameters?.select_columns) as string[] | undefined;
          if (inCols && Array.isArray(inCols) && !inCols.includes(uCol)) {
            continue;
          }

          if (pipeline.sourceDatasets && pipeline.sourceDatasets[inId]) {
            upstreamSources.push({
              source_dataset: pipeline.sourceDatasets[inId],
              source_column: uCol,
              transformations: currentPath,
            });
          } else {
            traceBack(inId, uCol, currentPath);
          }
        }
      }
    }

    for (const inCol of directInputs) {
      const inputs = targetNode.inputNodeIds || [];
      for (const inId of inputs) {
        traceBack(inId, inCol, [targetNode.operationType]);
      }
    }

    // 3. Find downstream consumers
    const downstreamConsumers: Array<{ step_id: string; column: string }> = [];
    for (const node of pipeline.nodes) {
      if (node.nodeId !== targetStepId && node.inputNodeIds?.includes(targetStepId)) {
        downstreamConsumers.push({
          step_id: node.nodeId,
          column: targetColumn,
        });
      }
    }

    return {
      target_step_id: targetStepId,
      target_column: targetColumn,
      producing_operation: targetNode.operationType,
      direct_input_columns: directInputs,
      upstream_sources: upstreamSources,
      downstream_consumers: downstreamConsumers,
      is_derived: isDerived,
      expression: expression,
      is_ambiguous: upstreamSources.length > 1,
    };
  }
}
