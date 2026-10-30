/**
 * Data Rewind — In-Browser Forensic Investigation Service
 * Orchestrates tabular comparison, EOD detection, diagnostic rule evaluation,
 * lineage blast radius analysis, and paged diff retrieval in the browser.
 * Conforms strictly to SPEC-MOD-03, SPEC-MOD-04, and SPEC-MOD-07.
 */

import {
  Investigation,
  InvestigationSummary,
  StepDiffPage,
  EvidenceItem,
} from "../../../types/api";
import {
  ComparisonConfig,
  DiagnosticFinding,
  EODResult,
  BlastRadiusReport,
  RowDiff,
  TabularDiffResult,
  StepDiagnosticContext,
  EODStatus,
  StructuredFinding,
} from "../contracts";
import { TabularComparator } from "../comparator/index";
import { EODDetector } from "../eod/index";
import { DiagnosticRuleEngine, StructuredExplainer } from "../diagnostics/index";
import { BlastRadiusEngine } from "../lineage/blast-radius";
import { ColumnLineageTracker } from "../lineage/column-lineage";
import { PagedDiffService } from "./paged-diff";
import {
  PipelineDefinition,
  PipelineExecutionResult,
} from "../../contracts/index";
import { QueryExecutor } from "../../pipeline/transformations/types";

export interface InvestigationExecutionOptions {
  investigationId?: string;
  title?: string;
  baseline: PipelineExecutionResult;
  target: PipelineExecutionResult;
  pipeline: PipelineDefinition;
  targetPipeline?: PipelineDefinition;
  executor?: QueryExecutor;
  config?: ComparisonConfig;
  stepDataBaseline?: Record<string, Record<string, unknown>[]>;
  stepDataTarget?: Record<string, Record<string, unknown>[]>;
}

export interface InvestigationReport {
  investigation: Investigation;
  eodResult: EODResult;
  blastRadius: BlastRadiusReport;
  findings: DiagnosticFinding[];
  structuredFindings?: StructuredFinding[];
  evidenceChain: EvidenceItem[];
  stepRowDiffs: Record<string, RowDiff[]>;
}

export class ForensicInvestigationService {
  private static investigations = new Map<string, InvestigationReport>();

  /**
   * Run a complete forensic investigation comparing two pipeline executions.
   */
  public static async runInvestigation(
    options: InvestigationExecutionOptions
  ): Promise<InvestigationReport> {
    const {
      investigationId = `inv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      title,
      baseline,
      target,
      pipeline,
      executor,
      config = {},
      stepDataBaseline = {},
      stepDataTarget = {},
      targetPipeline,
    } = options;

    // 1. Build step dependencies and node map from pipeline definition
    const nodeMap = new Map(pipeline.nodes.map((n) => [n.nodeId, n]));
    const targetNodeMap = new Map((targetPipeline || pipeline).nodes.map((n) => [n.nodeId, n]));
    const stepDependencies: Record<string, string[]> = {};
    const primaryKeysByStep: Record<string, string[]> = {};

    for (const node of pipeline.nodes) {
      stepDependencies[node.nodeId] = node.inputNodeIds || [];
      const nodePks = (node.parameters?.primary_keys as string[]) ||
        (node.parameters?.keys as string[]) ||
        [];
      if (nodePks.length > 0) {
        primaryKeysByStep[node.nodeId] = nodePks;
      }
    }

    // Topological order: from pipeline nodes or baseline execution
    const topologicalOrder =
      baseline.topologicalOrder?.length > 0
        ? baseline.topologicalOrder
        : pipeline.nodes.map((n) => n.nodeId);

    const stepComparisons: Record<string, TabularDiffResult> = {};
    const stepRowDiffs: Record<string, RowDiff[]> = {};
    const unmaterializedSteps = new Set<string>();

    // 2. Perform tabular comparison for each step in topological order
    for (const stepId of topologicalOrder) {
      const baseStep = baseline.stepResults?.[stepId];
      const targetStep = target.stepResults?.[stepId];

      // Check if step was executed
      if (!baseStep && !stepDataBaseline[stepId]) {
        unmaterializedSteps.add(stepId);
      }
      if (!targetStep && !stepDataTarget[stepId]) {
        unmaterializedSteps.add(stepId);
      }

      // Retrieve rows
      const baseRows = await this.resolveStepRows(
        baseStep?.tableName,
        stepDataBaseline[stepId],
        baseStep?.previewRows,
        executor
      );

      const targetRows = await this.resolveStepRows(
        targetStep?.tableName,
        stepDataTarget[stepId],
        targetStep?.previewRows,
        executor
      );

      // Determine step primary keys
      const pks =
        config.primaryKey ||
        primaryKeysByStep[stepId] ||
        baseStep?.schema?.primaryKeys ||
        targetStep?.schema?.primaryKeys ||
        [];

      if (pks.length > 0) {
        primaryKeysByStep[stepId] = pks;
      }

      const stepConfig: ComparisonConfig = {
        ...config,
        primaryKey: pks.length > 0 ? pks : undefined,
      };

      const diffResult = await TabularComparator.compare({
        baselineRows: baseRows,
        targetRows,
        config: stepConfig,
      });

      stepComparisons[stepId] = diffResult;
      stepRowDiffs[stepId] = diffResult.sample_row_diffs;
    }

    // 3. Build Step Diagnostic Contexts
    const stepContexts: Record<string, StepDiagnosticContext> = {};
    for (const stepId of topologicalOrder) {
      const node = nodeMap.get(stepId);
      const inputs = stepDependencies[stepId] || [];
      const baseStep = baseline.stepResults?.[stepId];
      const targetStep = target.stepResults?.[stepId];
      const diffResult = stepComparisons[stepId];

      const baselineInputHashes = inputs
        .map((inId) => baseline.stepResults?.[inId]?.contentHash)
        .filter((h): h is string => !!h);

      const targetInputHashes = inputs
        .map((inId) => target.stepResults?.[inId]?.contentHash)
        .filter((h): h is string => !!h);

      const hasSourceDataset = !!(pipeline.sourceDatasets?.[stepId] || node?.parameters?.dataset_name);
      const isIngestion =
        (node?.operationType as string) === "read_csv" ||
        (node?.operationType as string) === "ingest" ||
        (hasSourceDataset && inputs.length === 0) ||
        (inputs.length === 0 && (!node?.parameters || Object.keys(node.parameters).length === 0));

      const inputDatasetName =
        (node?.parameters?.dataset_name as string) ||
        (node?.parameters?.table_name as string) ||
        pipeline.sourceDatasets?.[stepId] ||
        (isIngestion ? "raw_source_input" : null);

      stepContexts[stepId] = {
        step_id: stepId,
        operation: node?.operationType || "TRANSFORMATION",
        is_ingestion_node: isIngestion,
        input_dataset_name: inputDatasetName,
        baseline_input_hashes: baselineInputHashes,
        target_input_hashes: targetInputHashes,
        baseline_parameters: node?.parameters,
        target_parameters: targetNodeMap.get(stepId)?.parameters || node?.parameters,
        baseline_output_hash: baseStep?.contentHash,
        target_output_hash: targetStep?.contentHash,
        diff_result: diffResult,
        left_input_rows: inputs[0] ? baseline.stepResults?.[inputs[0]]?.rowCount : undefined,
        right_input_rows: inputs[1] ? baseline.stepResults?.[inputs[1]]?.rowCount : undefined,
      };
    }

    // 4. Detect Earliest Observable Divergence (EOD)
    const eodResult = EODDetector.detectEOD({
      topologicalOrder,
      stepContexts,
      stepDependencies,
      hasUnmaterializedIntermediates: unmaterializedSteps.size > 0,
    });

    // 5. Downstream Blast Radius Analysis
    const confirmedDivergentSteps = Object.keys(stepComparisons).filter(
      (sid) => !stepComparisons[sid].is_equal
    );

    const stepOutputsBaseline: Record<string, { outputHash?: string | null }> = {};
    const stepOutputsTarget: Record<string, { outputHash?: string | null }> = {};
    const operations: Record<string, string> = {};

    for (const stepId of topologicalOrder) {
      stepOutputsBaseline[stepId] = { outputHash: baseline.stepResults?.[stepId]?.contentHash };
      stepOutputsTarget[stepId] = { outputHash: target.stepResults?.[stepId]?.contentHash };
      operations[stepId] = nodeMap.get(stepId)?.operationType || "UNKNOWN";
    }

    const blastRadius = BlastRadiusEngine.computeBlastRadius({
      originDivergentStepIds: eodResult.primary_eod_step
        ? [eodResult.primary_eod_step]
        : confirmedDivergentSteps,
      topologicalOrder,
      stepDependencies,
      stepOutputsBaseline,
      stepOutputsTarget,
      operations,
    });

    // 6. Evaluate Forensic Diagnostic Rules (R1 - R6)
    const allFindings: DiagnosticFinding[] = [];
    const targetStepsToDiagnose = eodResult.primary_eod_step
      ? [eodResult.primary_eod_step]
      : confirmedDivergentSteps;

    for (const stepId of targetStepsToDiagnose) {
      const ctx = stepContexts[stepId];
      if (ctx) {
        const findings = DiagnosticRuleEngine.evaluateStep(ctx);
        allFindings.push(...findings);
      }
    }

    eodResult.findings = allFindings;

    // 7. Build Rich Structured Explainability (The 5 Core Questions)
    const structuredFindings: StructuredFinding[] = allFindings
      .map((f) => f.structured_finding)
      .filter((sf): sf is StructuredFinding => !!sf);

    if (structuredFindings.length === 0 && eodResult.primary_eod_step) {
      const eodCtx = stepContexts[eodResult.primary_eod_step];
      if (eodCtx) {
        structuredFindings.push(
          StructuredExplainer.buildStructuredFinding({
            ctx: eodCtx,
            diff: stepComparisons[eodResult.primary_eod_step],
            blastRadius,
            allStepIds: topologicalOrder,
          })
        );
      }
    }

    // 8. Build UI-compatible Evidence Items
    const evidenceChain: EvidenceItem[] = allFindings.map((f) => ({
      tier: f.evidence_tier,
      step_id: f.step_id,
      category: f.rule_id,
      description: `${f.rule_name}: ${f.message}. ${f.observed}`,
      remediation_advice: f.next_investigation || f.interpretation,
    }));

    // 9. Construct complete Investigation object
    const finalTitle =
      title ||
      (eodResult.primary_eod_step
        ? `Forensic Divergence at ${eodResult.primary_eod_step} (${eodResult.divergence_category})`
        : `Verified Replay — Baseline ${baseline.executionId.slice(0, 8)} vs ${target.executionId.slice(0, 8)}`);

    const investigation: Investigation = {
      investigation_id: investigationId,
      title: finalTitle,
      baseline_run_id: baseline.executionId,
      target_run_id: target.executionId,
      status: eodResult.status === EODStatus.NO_DIVERGENCE ? "VERIFIED_EQUIVALENT" : "DIVERGENT",
      eod_result: {
        primary_eod_step: eodResult.primary_eod_step,
        status: eodResult.status,
        divergence_category: eodResult.divergence_category,
        affected_row_count: eodResult.affected_row_count || 0,
        explanation: eodResult.summary,
      },
      blast_radius: blastRadius,
      topological_order: topologicalOrder,
      step_comparisons: stepComparisons,
      primary_keys_by_step: primaryKeysByStep,
      step_dependencies: stepDependencies,
      created_at: new Date().toISOString(),
      findings: allFindings,
      structured_findings: structuredFindings,
      evidence_chain: evidenceChain,
    };

    const report: InvestigationReport = {
      investigation,
      eodResult,
      blastRadius,
      findings: allFindings,
      structuredFindings,
      evidenceChain,
      stepRowDiffs,
    };

    this.investigations.set(investigationId, report);
    return report;
  }

  /**
   * Helper to retrieve row records from explicit data, preview rows, or query executor.
   */
  private static async resolveStepRows(
    tableName?: string,
    providedRows?: Record<string, unknown>[],
    previewRows?: Record<string, unknown>[],
    executor?: QueryExecutor
  ): Promise<Record<string, unknown>[]> {
    if (providedRows && providedRows.length > 0) {
      return providedRows;
    }

    if (executor && tableName) {
      try {
        const queryRes = await executor.query(`SELECT * FROM "${tableName}"`);
        if (queryRes?.rows && queryRes.rows.length > 0) {
          return queryRes.rows;
        }
      } catch {
        // Fall back to preview rows
      }
    }

    if (previewRows && previewRows.length > 0) {
      return previewRows;
    }

    return [];
  }

  /**
   * Retrieve a paginated, filtered diff page for a specific step in an investigation.
   */
  public static getStepDiff(
    investigationId: string,
    stepId: string,
    filterStatus: string = "ALL",
    page: number = 1,
    pageSize: number = 50
  ): StepDiffPage {
    const report = this.investigations.get(investigationId);
    const rows = report?.stepRowDiffs?.[stepId] || [];
    const stepComp = report?.investigation.step_comparisons[stepId];
    const columns = stepComp
      ? [
          ...stepComp.schema_diff.common_columns,
          ...stepComp.schema_diff.added_columns,
          ...stepComp.schema_diff.removed_columns,
        ]
      : [];
    const primaryKeys = report?.investigation.primary_keys_by_step[stepId] || [];

    return PagedDiffService.getPage({
      stepId,
      rows,
      columns,
      primaryKeys,
      filterStatus,
      page,
      pageSize,
    });
  }

  /**
   * Retrieve an existing investigation by ID.
   */
  public static getInvestigation(investigationId: string): Investigation | null {
    const report = this.investigations.get(investigationId);
    return report ? report.investigation : null;
  }

  /**
   * Retrieve an investigation report by ID.
   */
  public static getInvestigationReport(investigationId: string): InvestigationReport | null {
    return this.investigations.get(investigationId) || null;
  }

  /**
   * List all stored investigations.
   */
  public static listInvestigations(): InvestigationSummary[] {
    return Array.from(this.investigations.values()).map((report) => ({
      investigation_id: report.investigation.investigation_id,
      title: report.investigation.title,
      baseline_run_id: report.investigation.baseline_run_id,
      target_run_id: report.investigation.target_run_id,
      status: report.investigation.status,
      primary_eod_step: report.investigation.eod_result.primary_eod_step,
      eod_status: report.investigation.eod_result.status,
      blast_radius_ratio: report.investigation.blast_radius.blast_radius_ratio,
      created_at: report.investigation.created_at,
    }));
  }

  /**
   * Column lineage resolution for an arbitrary column at any step.
   */
  public static traceColumnLineage(
    pipeline: PipelineDefinition,
    targetStepId: string,
    targetColumn: string
  ) {
    return ColumnLineageTracker.traceColumnLineage(pipeline, targetStepId, targetColumn);
  }

  /**
   * Clear in-memory investigations (e.g. for testing).
   */
  public static clear(): void {
    this.investigations.clear();
  }
}
