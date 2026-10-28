import React, { useEffect, useState } from "react";
import {
  AlertTriangle,
  GitCompare,
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

interface InvestigationViewProps {
  currentInvestigation: Investigation | null;
  onSelectInvestigation: (inv: Investigation) => void;
}

export const InvestigationView: React.FC<InvestigationViewProps> = ({
  currentInvestigation,
  onSelectInvestigation,
}) => {
  const [investigationsList, setInvestigationsList] = useState<InvestigationSummary[]>([]);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [diffPage, setDiffPage] = useState<StepDiffPage | null>(null);
  const [diffLoading, setDiffLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Load list of saved investigations
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
      const list = await api.listComparisons();
      setInvestigationsList(list);
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
      const data = await api.getStepDiff(invId, stepId, status, page, 50);
      setDiffPage(data);
    } catch (err: any) {
      setError(err instanceof ApiClientError ? `${err.code}: ${err.message}` : "Failed to load diffs.");
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
      const inv = await api.getComparison(invId);
      onSelectInvestigation(inv);
    } catch (err: any) {
      setError(err instanceof ApiClientError ? err.message : "Failed to fetch investigation.");
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
          Launch a demonstration scenario from the <strong>Demo Sandbox</strong> or ingest a CSV dataset to initiate forensic comparison and lineage analysis.
        </p>

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
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <GitCompare className="w-4 h-4 text-emerald-400" />
            <span className="text-xs font-mono uppercase text-emerald-400 tracking-wider">
              Forensic Investigation Dossier
            </span>
          </div>
          <h1 className="text-2xl font-bold text-zinc-100">{currentInvestigation.title}</h1>
          <div className="flex flex-wrap items-center gap-3 text-xs font-mono text-zinc-400 mt-2">
            <span>
              Baseline $R_0$: <code className="text-zinc-200">{currentInvestigation.baseline_run_id.slice(0, 8)}</code>
            </span>
            <span>•</span>
            <span>
              Target $R_1$: <code className="text-zinc-200">{currentInvestigation.target_run_id.slice(0, 8)}</code>
            </span>
            <span>•</span>
            <span>
              Steps: <TabularNum value={currentInvestigation.topological_order.length} />
            </span>
          </div>
        </div>

        {/* EOD Highlight Card */}
        <div className="bg-zinc-950 p-4 rounded-xl border border-zinc-800 flex items-center gap-4 min-w-[280px]">
          <div className="p-2.5 rounded-lg bg-amber-950/80 border border-amber-800 text-amber-400 flex items-center justify-center">
            <AlertTriangle className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <span className="text-[10px] font-mono uppercase text-zinc-500 font-bold block">
              Earliest Observable Divergence
            </span>
            <span className="text-sm font-mono font-bold text-amber-300">
              {eod_result.primary_eod_step || "None (Identical)"}
            </span>
            <span className="text-xs text-zinc-400 block mt-0.5">
              Category: <strong className="text-zinc-200">{eod_result.divergence_category}</strong>
            </span>
          </div>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="bg-rose-950/80 border border-rose-800 rounded-lg p-3 text-xs font-mono text-rose-200 flex items-center justify-between">
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
        <div className="lg:col-span-2">
          <DiffTable
            stepId={selectedStepId || "unknown"}
            diffSummary={diffSummary}
            diffPage={diffPage}
            loading={diffLoading}
            onFilterChange={handleFilterChange}
          />
        </div>

        <div className="lg:col-span-1">
          <EvidencePanel investigation={currentInvestigation} selectedStepId={selectedStepId} />
        </div>
      </div>
    </div>
  );
};
