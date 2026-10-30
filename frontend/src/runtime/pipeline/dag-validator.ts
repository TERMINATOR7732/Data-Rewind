/**
 * Data Rewind DAG Validation Engine.
 * Conforms to SPEC-MOD-01 §5.2, SPEC-MOD-02 & SPEC-MOD-07.
 * Validates acyclicity, cardinality, parameter schemas, and expression safety.
 */

import {
  PipelineDefinition,
  ValidationResult,
  ValidationIssue,
  CANONICAL_TRANSFORMATIONS,
  OperationType,
} from "../contracts/index";
import { ERROR_CODES } from "../contracts/errors";
import { parseExpression } from "../expr/index";

export function validatePipeline(pipeline: PipelineDefinition): ValidationResult {
  const issues: ValidationIssue[] = [];

  // 1. Structure check: Empty pipeline
  if (!pipeline || !pipeline.nodes || !Array.isArray(pipeline.nodes) || pipeline.nodes.length === 0) {
    issues.push({
      code: ERROR_CODES.EMPTY_PIPELINE,
      severity: "ERROR",
      message: "Pipeline must contain at least one node.",
      remediation: "Add at least one transformation step to the pipeline definition.",
    });
    return { valid: false, issues };
  }

  // 2. Node uniqueness
  const nodeMap = new Map<string, typeof pipeline.nodes[0]>();
  const duplicateNodeIds = new Set<string>();

  for (const node of pipeline.nodes) {
    if (!node.nodeId) {
      issues.push({
        code: ERROR_CODES.INVALID_PARAMETER,
        severity: "ERROR",
        message: "Pipeline node is missing required 'nodeId'.",
      });
      continue;
    }
    if (nodeMap.has(node.nodeId)) {
      duplicateNodeIds.add(node.nodeId);
      issues.push({
        code: ERROR_CODES.DUPLICATE_NODE_ID,
        severity: "ERROR",
        nodeId: node.nodeId,
        message: `Duplicate node ID '${node.nodeId}' found in pipeline.`,
        remediation: "Ensure all nodes have unique identifiers.",
      });
    } else {
      nodeMap.set(node.nodeId, node);
    }
  }

  // 3. Build Adjacency and Predecessor Graphs
  const successors = new Map<string, Set<string>>();
  const predecessors = new Map<string, Set<string>>();

  for (const node of pipeline.nodes) {
    successors.set(node.nodeId, new Set<string>());
    predecessors.set(node.nodeId, new Set<string>());
  }

  const seenEdges = new Set<string>();

  // Helper to register directed edge (from -> to)
  const addEdge = (fromId: string, toId: string, isFromEdgeList: boolean) => {
    if (fromId === toId) {
      issues.push({
        code: ERROR_CODES.SELF_DEPENDENCY,
        severity: "ERROR",
        nodeId: toId,
        message: `Self-dependency detected on node '${toId}'.`,
        remediation: "Remove the self-referencing dependency.",
      });
      return;
    }

    if (!nodeMap.has(fromId)) {
      // Check if it's an external dataset reference in sourceDatasets
      const isSourceDataset = pipeline.sourceDatasets && (
        pipeline.sourceDatasets[fromId] !== undefined ||
        Object.values(pipeline.sourceDatasets).includes(fromId)
      );

      if (!isSourceDataset) {
        issues.push({
          code: ERROR_CODES.MISSING_NODE_REFERENCE,
          severity: "ERROR",
          nodeId: toId,
          message: `Node '${toId}' references non-existent upstream node '${fromId}'.`,
          remediation: `Ensure '${fromId}' exists in pipeline nodes or sourceDatasets.`,
        });
        return;
      }

      // Valid source dataset reference
      predecessors.get(toId)?.add(fromId);
      return;
    }

    if (!nodeMap.has(toId)) {
      issues.push({
        code: ERROR_CODES.MISSING_NODE_REFERENCE,
        severity: "ERROR",
        message: `Edge references non-existent target node '${toId}'.`,
      });
      return;
    }

    const edgeKey = `${fromId}->${toId}`;
    if (seenEdges.has(edgeKey)) {
      if (isFromEdgeList) {
        issues.push({
          code: ERROR_CODES.DUPLICATE_EDGE,
          severity: "WARNING",
          nodeId: toId,
          message: `Duplicate edge detected from '${fromId}' to '${toId}'.`,
        });
      }
      return;
    }
    seenEdges.add(edgeKey);

    successors.get(fromId)?.add(toId);
    predecessors.get(toId)?.add(fromId);
  };

  // Process explicit edges
  if (Array.isArray(pipeline.edges)) {
    for (const edge of pipeline.edges) {
      addEdge(edge.sourceNodeId, edge.targetNodeId, true);
    }
  }

  // Process node.inputNodeIds
  for (const node of pipeline.nodes) {
    if (Array.isArray(node.inputNodeIds)) {
      for (const inputId of node.inputNodeIds) {
        addEdge(inputId, node.nodeId, false);
      }
    }
  }

  // 4. Cardinality & Source checks
  for (const node of pipeline.nodes) {
    const inputCount = (predecessors.get(node.nodeId) || new Set()).size;
    const isBoundSource = Boolean(pipeline.sourceDatasets && pipeline.sourceDatasets[node.nodeId]);

    if (node.operationType === "join_datasets") {
      if (inputCount !== 2) {
        issues.push({
          code: ERROR_CODES.INVALID_JOIN_CARDINALITY,
          severity: "ERROR",
          nodeId: node.nodeId,
          message: `Join operation on node '${node.nodeId}' requires exactly 2 input datasets, but received ${inputCount}.`,
          remediation: "Connect exactly two upstream nodes to this join step.",
        });
      }
    } else {
      // Single-input or entry node
      if (inputCount === 0 && !isBoundSource) {
        // Node with no inputs and no source dataset binding
        issues.push({
          code: ERROR_CODES.DANGLING_REFERENCE,
          severity: "WARNING",
          nodeId: node.nodeId,
          message: `Node '${node.nodeId}' has no upstream inputs and is not bound to a source dataset.`,
          remediation: "Specify an input node or register this node in sourceDatasets.",
        });
      } else if (inputCount > 1) {
        issues.push({
          code: ERROR_CODES.INVALID_STEP_CARDINALITY,
          severity: "ERROR",
          nodeId: node.nodeId,
          message: `Operation '${node.operationType}' on node '${node.nodeId}' accepts at most 1 input, but received ${inputCount}.`,
          remediation: "Connect only one upstream node or use a join node.",
        });
      }
    }
  }

  // 5. Cycle Detection using DFS (extracts full cycle path)
  const visited = new Map<string, number>(); // 0: unvisited, 1: visiting, 2: visited
  let cyclePath: string[] | null = null;

  function dfsCycle(nodeId: string, currentPath: string[]): boolean {
    visited.set(nodeId, 1);
    currentPath.push(nodeId);

    const neighbors = successors.get(nodeId) || new Set();
    for (const neighbor of neighbors) {
      const state = visited.get(neighbor) || 0;
      if (state === 1) {
        // Cycle found
        const cycleStartIndex = currentPath.indexOf(neighbor);
        cyclePath = currentPath.slice(cycleStartIndex).concat(neighbor);
        return true;
      }
      if (state === 0) {
        if (dfsCycle(neighbor, currentPath)) {
          return true;
        }
      }
    }

    currentPath.pop();
    visited.set(nodeId, 2);
    return false;
  }

  for (const node of pipeline.nodes) {
    if ((visited.get(node.nodeId) || 0) === 0) {
      if (dfsCycle(node.nodeId, [])) {
        break;
      }
    }
  }

  if (cyclePath) {
    issues.push({
      code: ERROR_CODES.CYCLIC_DEPENDENCY,
      severity: "ERROR",
      message: `Cyclic dependency detected in pipeline: ${(cyclePath as string[]).join(" -> ")}`,
      remediation: "Remove the cyclic connection between steps.",
    });
  }

  // 6. Operation Type & Parameter Schemas Validation
  for (const node of pipeline.nodes) {
    validateNodeParameters(node, issues);
  }

  // Determine overall validity
  const valid = !issues.some((i) => i.severity === "ERROR");

  return {
    valid,
    issues,
  };
}

/**
 * Validates individual node transformation parameters.
 */
function validateNodeParameters(node: PipelineDefinition["nodes"][0], issues: ValidationIssue[]): void {
  const op = node.operationType as OperationType;

  // Validate supported operation
  if (!CANONICAL_TRANSFORMATIONS.includes(op as any) && op !== "cast_columns") {
    issues.push({
      code: ERROR_CODES.UNSUPPORTED_OPERATION,
      severity: "ERROR",
      nodeId: node.nodeId,
      message: `Unsupported operation type '${op}' on node '${node.nodeId}'.`,
      remediation: `Choose one of: ${CANONICAL_TRANSFORMATIONS.join(", ")}.`,
    });
    return;
  }

  const p = node.parameters || {};

  switch (op) {
    case "select_columns": {
      if (!Array.isArray(p.columns) || p.columns.length === 0) {
        issues.push({
          code: ERROR_CODES.MISSING_PARAMETER,
          severity: "ERROR",
          nodeId: node.nodeId,
          parameterName: "columns",
          message: "'select_columns' requires a non-empty 'columns' array of strings.",
        });
      } else if (!p.columns.every((c: any) => typeof c === "string" && c.trim().length > 0)) {
        issues.push({
          code: ERROR_CODES.INVALID_PARAMETER,
          severity: "ERROR",
          nodeId: node.nodeId,
          parameterName: "columns",
          message: "All column names in 'select_columns' must be non-empty strings.",
        });
      }
      break;
    }

    case "rename_columns": {
      const mapping = p.mapping;
      if (!mapping || typeof mapping !== "object" || Array.isArray(mapping) || Object.keys(mapping).length === 0) {
        issues.push({
          code: ERROR_CODES.MISSING_PARAMETER,
          severity: "ERROR",
          nodeId: node.nodeId,
          parameterName: "mapping",
          message: "'rename_columns' requires a non-empty 'mapping' object.",
        });
      } else {
        for (const [oldCol, newCol] of Object.entries(mapping)) {
          if (!oldCol.trim() || typeof newCol !== "string" || !newCol.trim()) {
            issues.push({
              code: ERROR_CODES.INVALID_PARAMETER,
              severity: "ERROR",
              nodeId: node.nodeId,
              parameterName: "mapping",
              message: `Invalid column renaming mapping '${oldCol}' -> '${newCol}'. Both names must be non-empty strings.`,
            });
          }
        }
      }
      break;
    }

    case "drop_columns": {
      if (!Array.isArray(p.columns) || p.columns.length === 0) {
        issues.push({
          code: ERROR_CODES.MISSING_PARAMETER,
          severity: "ERROR",
          nodeId: node.nodeId,
          parameterName: "columns",
          message: "'drop_columns' requires a non-empty 'columns' array of strings.",
        });
      }
      break;
    }

    case "filter_rows": {
      const predicate = p.predicate ?? p.condition;
      if (typeof predicate !== "string" || predicate.trim().length === 0) {
        issues.push({
          code: ERROR_CODES.MISSING_PARAMETER,
          severity: "ERROR",
          nodeId: node.nodeId,
          parameterName: "predicate",
          message: "'filter_rows' requires a non-empty 'predicate' string expression.",
        });
      } else {
        try {
          parseExpression(predicate);
        } catch (err: any) {
          issues.push({
            code: err?.code || ERROR_CODES.EXPRESSION_SYNTAX_ERROR,
            severity: "ERROR",
            nodeId: node.nodeId,
            parameterName: "predicate",
            message: `Filter expression syntax error: ${err?.message || "Invalid syntax"}`,
          });
        }
      }
      break;
    }

    case "deduplicate_rows": {
      const subset = p.subset ?? p.subset_columns;
      if (subset !== undefined && (!Array.isArray(subset) || !subset.every((c) => typeof c === "string"))) {
        issues.push({
          code: ERROR_CODES.INVALID_PARAMETER,
          severity: "ERROR",
          nodeId: node.nodeId,
          parameterName: "subset",
          message: "'deduplicate_rows' subset must be an array of column names.",
        });
      }
      if (p.keep !== undefined && p.keep !== "first" && p.keep !== "last") {
        issues.push({
          code: ERROR_CODES.INVALID_PARAMETER,
          severity: "ERROR",
          nodeId: node.nodeId,
          parameterName: "keep",
          message: "'deduplicate_rows' keep must be either 'first' or 'last'.",
        });
      }
      break;
    }

    case "handle_missing": {
      if (!Array.isArray(p.columns) || p.columns.length === 0) {
        issues.push({
          code: ERROR_CODES.MISSING_PARAMETER,
          severity: "ERROR",
          nodeId: node.nodeId,
          parameterName: "columns",
          message: "'handle_missing' requires a non-empty 'columns' array.",
        });
      }
      const validStrategies = ["drop", "fill_literal", "fill_mean", "fill_mode"];
      if (!p.strategy || !validStrategies.includes(p.strategy)) {
        issues.push({
          code: ERROR_CODES.INVALID_PARAMETER,
          severity: "ERROR",
          nodeId: node.nodeId,
          parameterName: "strategy",
          message: `'handle_missing' strategy must be one of: ${validStrategies.join(", ")}.`,
        });
      }
      if (p.strategy === "fill_literal" && p.value === undefined) {
        issues.push({
          code: ERROR_CODES.MISSING_PARAMETER,
          severity: "ERROR",
          nodeId: node.nodeId,
          parameterName: "value",
          message: "'handle_missing' with strategy 'fill_literal' requires 'value' parameter.",
        });
      }
      break;
    }

    case "cast_types":
    case "cast_columns": {
      const casts = p.casts ?? p.target_types;
      if (!casts || typeof casts !== "object" || Array.isArray(casts) || Object.keys(casts).length === 0) {
        issues.push({
          code: ERROR_CODES.MISSING_PARAMETER,
          severity: "ERROR",
          nodeId: node.nodeId,
          parameterName: "casts",
          message: `'${op}' requires a non-empty 'casts' or 'target_types' mapping.`,
        });
      }
      break;
    }

    case "join_datasets": {
      const joinType = p.join_type ?? p.how ?? "inner";
      const validJoins = ["inner", "left", "right", "outer", "full", "cross"];
      if (!validJoins.includes(joinType.toLowerCase())) {
        issues.push({
          code: ERROR_CODES.INVALID_JOIN_TYPE,
          severity: "ERROR",
          nodeId: node.nodeId,
          parameterName: "join_type",
          message: `Invalid join_type '${joinType}'. Must be one of: ${validJoins.join(", ")}.`,
        });
      }
      if (joinType.toLowerCase() !== "cross" && !p.on) {
        const leftOn = p.left_on ?? p.join_keys;
        const rightOn = p.right_on ?? p.join_keys;
        if (!Array.isArray(leftOn) || !Array.isArray(rightOn) || leftOn.length === 0 || rightOn.length === 0) {
          issues.push({
            code: ERROR_CODES.MISSING_PARAMETER,
            severity: "ERROR",
            nodeId: node.nodeId,
            parameterName: "left_on / right_on",
            message: "join_datasets requires 'left_on' and 'right_on' column arrays (or 'join_keys').",
          });
        } else if (leftOn.length !== rightOn.length) {
          issues.push({
            code: ERROR_CODES.INVALID_PARAMETER,
            severity: "ERROR",
            nodeId: node.nodeId,
            message: `'left_on' (length ${leftOn.length}) and 'right_on' (length ${rightOn.length}) must have equal number of columns.`,
          });
        }
      }
      break;
    }

    case "aggregate_group_by": {
      const aggs = p.aggregations;
      if (!aggs || (Array.isArray(aggs) && aggs.length === 0) || (typeof aggs === "object" && Object.keys(aggs).length === 0)) {
        issues.push({
          code: ERROR_CODES.MISSING_PARAMETER,
          severity: "ERROR",
          nodeId: node.nodeId,
          parameterName: "aggregations",
          message: "'aggregate_group_by' requires at least one aggregation definition.",
        });
      }
      break;
    }

    case "sort_rows": {
      const by = p.by ?? p.sort_columns;
      if (!Array.isArray(by) || by.length === 0) {
        issues.push({
          code: ERROR_CODES.MISSING_PARAMETER,
          severity: "ERROR",
          nodeId: node.nodeId,
          parameterName: "by",
          message: "'sort_rows' requires a non-empty 'by' or 'sort_columns' array.",
        });
      }
      break;
    }

    case "derive_column": {
      const newCol = p.new_column ?? p.target_column;
      if (typeof newCol !== "string" || newCol.trim().length === 0) {
        issues.push({
          code: ERROR_CODES.MISSING_PARAMETER,
          severity: "ERROR",
          nodeId: node.nodeId,
          parameterName: "target_column",
          message: "'derive_column' requires a non-empty 'new_column' or 'target_column'.",
        });
      }
      if (typeof p.expression !== "string" || p.expression.trim().length === 0) {
        issues.push({
          code: ERROR_CODES.MISSING_PARAMETER,
          severity: "ERROR",
          nodeId: node.nodeId,
          parameterName: "expression",
          message: "'derive_column' requires a non-empty 'expression'.",
        });
      } else {
        try {
          parseExpression(p.expression);
        } catch (err: any) {
          issues.push({
            code: err?.code || ERROR_CODES.EXPRESSION_SYNTAX_ERROR,
            severity: "ERROR",
            nodeId: node.nodeId,
            parameterName: "expression",
            message: `Derive expression syntax error: ${err?.message || "Invalid syntax"}`,
          });
        }
      }
      break;
    }

    case "data_quality_rule": {
      const validRules = ["is_not_null", "in_range", "matches_regex"];
      if (!p.rule_type || !validRules.includes(p.rule_type)) {
        issues.push({
          code: ERROR_CODES.INVALID_PARAMETER,
          severity: "ERROR",
          nodeId: node.nodeId,
          parameterName: "rule_type",
          message: `'data_quality_rule' requires rule_type in: ${validRules.join(", ")}.`,
        });
      }
      if (typeof p.column !== "string" || p.column.trim().length === 0) {
        issues.push({
          code: ERROR_CODES.MISSING_PARAMETER,
          severity: "ERROR",
          nodeId: node.nodeId,
          parameterName: "column",
          message: "'data_quality_rule' requires a target 'column'.",
        });
      }
      if (p.rule_type === "in_range") {
        if (p.params?.min === undefined && p.params?.max === undefined) {
          issues.push({
            code: ERROR_CODES.INVALID_PARAMETER,
            severity: "ERROR",
            nodeId: node.nodeId,
            parameterName: "params",
            message: "'in_range' rule requires at least 'min' or 'max' in params.",
          });
        }
      }
      if (p.rule_type === "matches_regex") {
        if (!p.params?.pattern || typeof p.params.pattern !== "string") {
          issues.push({
            code: ERROR_CODES.INVALID_PARAMETER,
            severity: "ERROR",
            nodeId: node.nodeId,
            parameterName: "params.pattern",
            message: "'matches_regex' rule requires a string 'pattern' in params.",
          });
        }
      }
      break;
    }
  }
}
