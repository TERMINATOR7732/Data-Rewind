import React, { useEffect, useState } from "react";
import {
  AlertTriangle,
  Eye,
  FileText,
  GitCompare,
  Play,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import { api, ApiClientError } from "../../lib/api";
import {
  Investigation,
  InvestigationSummary,
  StepDiffPage,
} from "../../types/api";
import { DiffTable } from "../../components/DiffTable";
import { EvidencePanel } from "../../components/EvidencePanel";
import { LineageGraph } from "../../components/LineageGraph";
import { StatusBadge } from "../../components/StatusBadge";
import { TabularNum } from "../../components/TabularNum";
import { ForensicInvestigationService } from "../../runtime/forensics/index";
import { PipelineDefinition, PipelineExecutionResult } from "../../runtime/contracts/index";
import { useInvestigationContext } from "../context/InvestigationContext";

interface InvestigationViewProps {
  currentInvestigation: Investigation | null;
  onSelectInvestigation: (inv: Investigation) => void;
}

export const InvestigationView: React.FC<InvestigationViewProps> = ({
  currentInvestigation,
  onSelectInvestigation,
}) => {
  const { navigateToVerification, navigateToReports, navigateToCSV, navigateToDemo, activeDataset } =
    useInvestigationContext();

  const [investigationsList, setInvestigationsList] = useState<InvestigationSummary[]>([]);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [diffPage, setDiffPage] = useState<StepDiffPage | null>(null);
  const [diffLoading, setDiffLoading] = useState<boolean>(false);
  const [isExecutingProbe, setIsExecutingProbe] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Load list of saved investigations (merging local in-browser + server)
  useEffect(() => {
    loadInvestigations();
  }, []);

  // When current investigation changes, default selected step to EOD step
  useEffect(() => {
    if (currentInvestigation) {
      const eod = currentInvestigation.eod_result.primary_eod_step;
      const initialStep = eod || currentInvestigation.topological_order[0] || null;
      setSelectedStepId(initialStep);
      if (initialStep) {
        fetchStepDiff(currentInvestigation.investigation_id, initialStep, "ALL", 1);
      }
    }
  }, [currentInvestigation]);

  const loadInvestigations = async () => {
    try {
      const remoteList = await api.listComparisons().catch(() => []);
      const localList = ForensicInvestigationService.listInvestigations();
      const map = new Map<string, InvestigationSummary>();
      for (const item of [...localList, ...remoteList]) {
        map.set(item.investigation_id, item);
      }
      setInvestigationsList(Array.from(map.values()));
    } catch {
      // Ignore list loading errors if none exist yet
    }
  };

  const fetchStepDiff = async (
    invId: string,
    stepId: string,
    status: string = "ALL",
    page: number = 1
  ) => {
    try {
      setDiffLoading(true);
      setError(null);

      // Check local in-browser investigation first
      const localReport = ForensicInvestigationService.getInvestigationReport(invId);
      if (localReport) {
        const localPage = ForensicInvestigationService.getStepDiff(invId, stepId, status, page, 50);
        setDiffPage(localPage);
        return;
      }

      const data = await api.getStepDiff(invId, stepId, status, page, 50);
      setDiffPage(data);
    } catch (err: any) {
      // Fallback check
      const localPage = ForensicInvestigationService.getStepDiff(invId, stepId, status, page, 50);
      if (localPage && localPage.rows.length > 0) {
        setDiffPage(localPage);
      } else {
        setError(err instanceof ApiClientError ? `${err.code}: ${err.message}` : "Failed to load diffs.");
      }
    } finally {
      setDiffLoading(false);
    }
  };

  const handleStepSelect = (stepId: string) => {
    setSelectedStepId(stepId);
    if (currentInvestigation) {
      fetchStepDiff(currentInvestigation.investigation_id, stepId, "ALL", 1);
    }
  };

  const handleFilterChange = (status: string, page: number) => {
    if (currentInvestigation && selectedStepId) {
      fetchStepDiff(currentInvestigation.investigation_id, selectedStepId, status, page);
    }
  };

  const handleSwitchInvestigation = async (invId: string) => {
    try {
      setError(null);
      const local = ForensicInvestigationService.getInvestigation(invId);
      if (local) {
        onSelectInvestigation(local);
        return;
      }
      const inv = await api.getComparison(invId);
      onSelectInvestigation(inv);
    } catch (err: any) {
      setError(err instanceof ApiClientError ? err.message : "Failed to fetch investigation.");
    }
  };

  const handleRunBrowserProbe = async () => {
    try {
      setIsExecutingProbe(true);
      setError(null);

      const probePipeline: PipelineDefinition = {
        version: "1.0.0",
        pipelineId: "browser_forensic_pipeline",
        name: "Browser Forensic Probe Pipeline",
        nodes: [
          {
            nodeId: "step_1_ingest",
            operationType: "select_columns",
            parameters: { columns: ["id", "account", "amount", "fee", "status"], primary_keys: ["id"] },
            inputNodeIds: [],
          },
          {
            nodeId: "step_2_compute_fee",
            operationType: "derive_column",
            parameters: { target_column: "fee", expression: "amount * 0.05", primary_keys: ["id"] },
            inputNodeIds: ["step_1_ingest"],
          },
          {
            nodeId: "step_3_filter_settled",
            operationType: "filter_rows",
            parameters: { predicate: "status = 'SETTLED'", primary_keys: ["id"] },
            inputNodeIds: ["step_2_compute_fee"],
          },
        ],
        edges: [
          { sourceNodeId: "step_1_ingest", targetNodeId: "step_2_compute_fee" },
          { sourceNodeId: "step_2_compute_fee", targetNodeId: "step_3_filter_settled" },
        ],
        sourceDatasets: { step_1_ingest: "raw_settlements" },
      };

      // Raw source data
      const sourceRows = [
        { id: "TX_101", account: "ACC_9001", amount: 1000.0, fee: 50.0, status: "SETTLED" },
        { id: "TX_102", account: "ACC_9002", amount: 2500.0, fee: 125.0, status: "PENDING" },
        { id: "TX_103", account: "ACC_9003", amount: 400.0, fee: 20.0, status: "SETTLED" },
        { id: "TX_104", account: "ACC_9004", amount: 12000.0, fee: 600.0, status: "SETTLED" },
        { id: "TX_105", account: "ACC_9005", amount: 750.0, fee: 37.5, status: "CANCELLED" },
      ];

      // Baseline run: legitimate fee calculation (fee = amount * 0.05)
      const baselineRowsStep2 = [
        { id: "TX_101", account: "ACC_9001", amount: 1000.0, fee: 50.0, status: "SETTLED" },
        { id: "TX_102", account: "ACC_9002", amount: 2500.0, fee: 125.0, status: "PENDING" },
        { id: "TX_103", account: "ACC_9003", amount: 400.0, fee: 20.0, status: "SETTLED" },
        { id: "TX_104", account: "ACC_9004", amount: 12000.0, fee: 600.0, status: "SETTLED" },
        { id: "TX_105", account: "ACC_9005", amount: 750.0, fee: 37.5, status: "CANCELLED" },
      ];

      const baselineRowsStep3 = [
        { id: "TX_101", account: "ACC_9001", amount: 1000.0, fee: 50.0, status: "SETTLED" },
        { id: "TX_103", account: "ACC_9003", amount: 400.0, fee: 20.0, status: "SETTLED" },
        { id: "TX_104", account: "ACC_9004", amount: 12000.0, fee: 600.0, status: "SETTLED" },
      ];

      // Candidate run: corrupted / mutated fee calculation (fee = amount * 0.10)
      const candidateRowsStep2 = [
        { id: "TX_101", account: "ACC_9001", amount: 1000.0, fee: 100.0, status: "SETTLED" },
        { id: "TX_102", account: "ACC_9002", amount: 2500.0, fee: 250.0, status: "PENDING" },
        { id: "TX_103", account: "ACC_9003", amount: 400.0, fee: 40.0, status: "SETTLED" },
        { id: "TX_104", account: "ACC_9004", amount: 12000.0, fee: 1200.0, status: "SETTLED" },
        { id: "TX_105", account: "ACC_9005", amount: 750.0, fee: 75.0, status: "CANCELLED" },
      ];

      const candidateRowsStep3 = [
        { id: "TX_101", account: "ACC_9001", amount: 1000.0, fee: 100.0, status: "SETTLED" },
        { id: "TX_103", account: "ACC_9003", amount: 400.0, fee: 40.0, status: "SETTLED" },
        { id: "TX_104", account: "ACC_9004", amount: 12000.0, fee: 1200.0, status: "SETTLED" },
      ];

      const makeStepOutput = (stepId: string, rows: Record<string, unknown>[], hash: string) => ({
        stepId,
        status: "SUCCESS" as const,
        rowCount: rows.length,
        columnCount: Object.keys(rows[0] || {}).length,
        durationMs: 5,
        schema: {
          version: "1.0.0" as const,
          columns: Object.keys(rows[0] || {}).map((c, i) => ({
            name: c,
            dataType: (c === "amount" || c === "fee" ? "DOUBLE" : "VARCHAR") as any,
            nullable: true,
            ordinalPosition: i,
          })),
          primaryKeys: ["id"],
        },
        tableName: `probe_${stepId}`,
        previewRows: rows,
        contentHash: hash,
        multisetHash: hash,
        definitionHash: `def_${stepId}`,
      });

      const baselineExecution: PipelineExecutionResult = {
        version: "1.0.0",
        executionId: `run_base_${Date.now()}`,
        pipelineId: "browser_forensic_pipeline",
        status: "COMPLETED",
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: 45,
        stepResults: {
          step_1_ingest: makeStepOutput("step_1_ingest", sourceRows, "hash_s1_clean"),
          step_2_compute_fee: makeStepOutput("step_2_compute_fee", baselineRowsStep2, "hash_s2_clean"),
          step_3_filter_settled: makeStepOutput("step_3_filter_settled", baselineRowsStep3, "hash_s3_clean"),
        },
        topologicalOrder: ["step_1_ingest", "step_2_compute_fee", "step_3_filter_settled"],
        checkpoints: [],
      };

      const candidateExecution: PipelineExecutionResult = {
        version: "1.0.0",
        executionId: `run_cand_${Date.now()}`,
        pipelineId: "browser_forensic_pipeline",
        status: "COMPLETED",
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: 48,
        stepResults: {
          step_1_ingest: makeStepOutput("step_1_ingest", sourceRows, "hash_s1_clean"),
          step_2_compute_fee: makeStepOutput("step_2_compute_fee", candidateRowsStep2, "hash_s2_faulted"),
          step_3_filter_settled: makeStepOutput("step_3_filter_settled", candidateRowsStep3, "hash_s3_faulted"),
        },
        topologicalOrder: ["step_1_ingest", "step_2_compute_fee", "step_3_filter_settled"],
        checkpoints: [],
      };

      const report = await ForensicInvestigationService.runInvestigation({
        investigationId: `probe_${Date.now()}`,
        title: "Browser Forensic Probe: Fee Arithmetic Mutation",
        baseline: baselineExecution,
        target: candidateExecution,
        pipeline: probePipeline,
        config: { primaryKey: ["id"] },
        stepDataBaseline: {
          step_1_ingest: sourceRows,
          step_2_compute_fee: baselineRowsStep2,
          step_3_filter_settled: baselineRowsStep3,
        },
        stepDataTarget: {
          step_1_ingest: sourceRows,
          step_2_compute_fee: candidateRowsStep2,
          step_3_filter_settled: candidateRowsStep3,
        },
      });

      onSelectInvestigation(report.investigation);
      await loadInvestigations();
    } catch (err: any) {
      setError(err?.message || "Failed to execute in-browser forensic probe.");
    } finally {
      setIsExecutingProbe(false);
    }
  };

  if (!currentInvestigation) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-16 flex flex-col items-center justify-center text-center font-sans">
        <div className="h-16 w-16 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-500 mb-4">
          <GitCompare className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-bold text-zinc-100 font-mono">No Active Investigation</h2>
        <p className="text-xs text-zinc-400 max-w-md mt-2 font-mono leading-relaxed">
          {activeDataset ? (
            <>
              You have an active dataset loaded: <strong className="text-zinc-200">{activeDataset.name}</strong> (
              <TabularNum value={activeDataset.rowCount} /> rows). Build and compare a pipeline in the CSV tab or run a probe below.
            </>
          ) : (
            <>
              Upload a CSV file or launch a scenario from the Demo Sandbox to compare baseline and candidate pipeline executions.
            </>
          )}
        </p>

        {/* Action Buttons */}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <button
            data-testid="run-browser-probe"
            onClick={handleRunBrowserProbe}
            disabled={isExecutingProbe}
            className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-zinc-950 font-mono font-bold text-xs flex items-center gap-2 border border-emerald-500 transition-all disabled:opacity-50"
          >
            {isExecutingProbe ? (
              <>
                <RotateCcw className="w-3.5 h-3.5 animate-spin" /> Running Forensic Engine...
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-current" /> Run In-Browser Forensic Probe
              </>
            )}
          </button>

          <button
            type="button"
            onClick={navigateToCSV}
            className="px-4 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-mono font-medium text-xs border border-zinc-700 transition-all"
          >
            Upload CSV File
          </button>

          <button
            type="button"
            onClick={navigateToDemo}
            className="px-4 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-mono font-medium text-xs border border-zinc-700 transition-all"
          >
            Explore Demo Scenarios
          </button>
        </div>

        {error && (
          <div className="mt-4 p-3 rounded-lg bg-rose-950/80 border border-rose-800 text-xs font-mono text-rose-200">
            {error}
          </div>
        )}

        {investigationsList.length > 0 && (
          <div className="mt-8 flex flex-col gap-2 w-full max-w-md text-left">
            <span className="text-xs font-mono font-semibold uppercase text-zinc-400">
              Load Prior Investigation ({investigationsList.length})
            </span>
            {investigationsList.map((inv) => (
              <button
                key={inv.investigation_id}
                onClick={() => handleSwitchInvestigation(inv.investigation_id)}
                className="p-3 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-emerald-500 hover:bg-zinc-850 flex items-center justify-between text-xs font-mono transition-all"
              >
                <div className="flex flex-col">
                  <span className="font-bold text-zinc-200">{inv.title}</span>
                  <span className="text-[10px] text-zinc-500">{new Date(inv.created_at).toLocaleString()}</span>
                </div>
                <StatusBadge status={inv.status} size="sm" />
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  const { eod_result } = currentInvestigation;
  const diffSummary = selectedStepId ? currentInvestigation.step_comparisons[selectedStepId] : undefined;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col gap-6 font-sans">
      {/* Investigation Top Banner */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 sm:p-7 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-6 min-w-0">
        <div className="space-y-2 min-w-0">
          <div className="flex items-center gap-2">
            <GitCompare className="w-4 h-4 text-emerald-400 flex-shrink-0" />
            <span className="text-xs font-mono uppercase text-emerald-400 tracking-wider font-semibold">
              Forensic Investigation Dossier
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-zinc-100 truncate" title={currentInvestigation.title}>
            {currentInvestigation.title}
          </h1>
          <div className="flex flex-wrap items-center gap-3 text-xs font-mono text-zinc-400 pt-1">
            <span>
              Baseline Run: <code className="text-zinc-200">{currentInvestigation.baseline_run_id.slice(0, 8)}</code>
            </span>
            <span>•</span>
            <span>
              Target Run: <code className="text-zinc-200">{currentInvestigation.target_run_id.slice(0, 8)}</code>
            </span>
            <span>•</span>
            <span>
              Steps: <TabularNum value={currentInvestigation.topological_order.length} />
            </span>
          </div>
        </div>

        {/* EOD Highlight Card */}
        <div
          data-tour="eod-card"
          className="bg-zinc-950 p-4 rounded-xl border border-zinc-800 flex items-center gap-4 min-w-0 sm:min-w-[280px] shadow-inner"
        >
          <div className="p-2.5 rounded-lg bg-amber-950/80 border border-amber-800 text-amber-400 flex items-center justify-center flex-shrink-0">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <span className="text-[10px] font-mono uppercase text-zinc-400 font-bold block truncate">
              Earliest Observable Divergence
            </span>
            <span className="text-sm font-mono font-bold text-amber-300 block truncate" title={eod_result.primary_eod_step || "None"}>
              {eod_result.primary_eod_step || "None (Identical)"}
            </span>
            <span className="text-xs text-zinc-400 block mt-0.5 truncate">
              Category: <strong className="text-zinc-200">{eod_result.divergence_category}</strong>
            </span>
          </div>
        </div>
      </div>

      {/* Recommended Next Actions Bar */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
        <div className="flex items-center gap-2 text-zinc-300 flex-wrap">
          <span className="font-bold uppercase text-emerald-400">Next Actions:</span>
          {eod_result.primary_eod_step ? (
            <span className="text-zinc-400">
              Divergence isolated at step <strong className="text-amber-400">{eod_result.primary_eod_step}</strong>.
            </span>
          ) : (
            <span className="text-zinc-400">Pipeline runs are bit-for-bit identical across all checkpoints.</span>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {eod_result.primary_eod_step && selectedStepId !== eod_result.primary_eod_step && (
            <button
              type="button"
              onClick={() => handleStepSelect(eod_result.primary_eod_step!)}
              className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-750 text-amber-300 border border-amber-800/60 flex items-center gap-1.5 transition-colors"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>Inspect EOD Step</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => navigateToVerification()}
            className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-750 text-emerald-300 border border-emerald-800/60 flex items-center gap-1.5 transition-colors"
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Verify Fix Candidate</span>
          </button>

          <button
            type="button"
            onClick={() => navigateToReports()}
            className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-750 text-zinc-200 border border-zinc-700 flex items-center gap-1.5 transition-colors"
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Open in Report Studio</span>
          </button>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="bg-rose-950/80 border border-rose-800 rounded-xl p-4 text-xs font-mono text-rose-200 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="font-bold text-rose-400 hover:text-rose-200">
            Dismiss
          </button>
        </div>
      )}

      {/* Interactive Lineage DAG Canvas */}
      <div className="w-full">
        <LineageGraph
          investigation={currentInvestigation}
          selectedStepId={selectedStepId}
          onSelectStep={handleStepSelect}
        />
      </div>

      {/* Bottom Grid: Row Diff Viewer & Forensic Evidence Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 min-w-0">
          <DiffTable
            stepId={selectedStepId || "unknown"}
            diffSummary={diffSummary}
            diffPage={diffPage}
            loading={diffLoading}
            onFilterChange={handleFilterChange}
          />
        </div>

        <div className="lg:col-span-1 min-w-0" data-tour="evidence-panel">
          <EvidencePanel investigation={currentInvestigation} selectedStepId={selectedStepId} />
        </div>
      </div>
    </div>
  );
};
