import React from "react";
import {
  CheckCircle2,
  FileSearch,
  Lightbulb,
  ShieldAlert,
} from "lucide-react";
import { Investigation, TabularDiffResult } from "../types/api";
import { TabularNum } from "./TabularNum";

interface EvidencePanelProps {
  investigation: Investigation;
  selectedStepId: string | null;
}

export const EvidencePanel: React.FC<EvidencePanelProps> = ({
  investigation,
  selectedStepId,
}) => {
  const { eod_result, blast_radius, step_comparisons } = investigation;
  const currentStepId = selectedStepId || eod_result.primary_eod_step;
  const diffSummary: TabularDiffResult | undefined = currentStepId
    ? step_comparisons[currentStepId]
    : undefined;

  const isEOD = currentStepId === eod_result.primary_eod_step;
  const isTainted = currentStepId
    ? blast_radius.tainted_step_ids?.includes(currentStepId)
    : false;

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-5 flex flex-col gap-5 shadow-lg font-sans">
      {/* Panel Header */}
      <div className="border-b border-zinc-800 pb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileSearch className="w-4 h-4 text-emerald-400" />
          <h3 className="text-sm font-semibold text-zinc-100 font-mono">
            Forensic Evidence & Root Cause
          </h3>
        </div>
        <span className="text-xs px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 font-mono border border-zinc-700">
          Target Step: <strong className="text-zinc-200">{currentStepId || "None"}</strong>
        </span>
      </div>

      {/* 1. Proven Observations (Mathematical & Structural Facts) */}
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-emerald-400 font-mono">
          <CheckCircle2 className="w-3.5 h-3.5" /> Proven Observations (Verified Facts)
        </div>
        <div className="bg-zinc-950 p-3.5 rounded border border-zinc-800 text-xs font-mono flex flex-col gap-2 text-zinc-300">
          {diffSummary ? (
            <>
              <div className="flex items-center justify-between">
                <span className="text-zinc-400">Step Partition Status:</span>
                <span
                  className={
                    diffSummary.is_equal ? "text-emerald-400 font-bold" : "text-amber-400 font-bold"
                  }
                >
                  {diffSummary.is_equal ? "100% IDENTICAL" : "DIVERGENT ROW DELTAS DETECTED"}
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 border-t border-zinc-900 text-[11px]">
                <div className="bg-zinc-900/80 p-2 rounded">
                  <div className="text-zinc-500 text-[10px]">Identical Rows</div>
                  <TabularNum value={diffSummary.identical_count} className="text-emerald-400 font-bold" />
                </div>
                <div className="bg-zinc-900/80 p-2 rounded">
                  <div className="text-zinc-500 text-[10px]">Modified Rows</div>
                  <TabularNum value={diffSummary.modified_count} className="text-amber-400 font-bold" />
                </div>
                <div className="bg-zinc-900/80 p-2 rounded">
                  <div className="text-zinc-500 text-[10px]">Added Rows</div>
                  <TabularNum value={diffSummary.added_count} className="text-sky-400 font-bold" />
                </div>
                <div className="bg-zinc-900/80 p-2 rounded">
                  <div className="text-zinc-500 text-[10px]">Removed Rows</div>
                  <TabularNum value={diffSummary.removed_count} className="text-rose-400 font-bold" />
                </div>
              </div>
              <div className="pt-2 text-[11px] text-zinc-400 border-t border-zinc-900 flex flex-col gap-1">
                <div>
                  <span className="text-zinc-500">Baseline Fingerprint:</span>{" "}
                  <code className="text-zinc-300 select-all">
                    {diffSummary.baseline_fingerprint.fingerprint_hash.slice(0, 16)}...
                  </code>
                </div>
                <div>
                  <span className="text-zinc-500">Target Fingerprint:</span>{" "}
                  <code className="text-zinc-300 select-all">
                    {diffSummary.target_fingerprint.fingerprint_hash.slice(0, 16)}...
                  </code>
                </div>
              </div>
            </>
          ) : (
            <span className="text-zinc-500">Select a step on the canvas to inspect observed facts.</span>
          )}
        </div>
      </div>

      {/* 2. Causal Hypotheses & Diagnostic Rules */}
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-amber-400 font-mono">
          <Lightbulb className="w-3.5 h-3.5" /> Diagnostic Classification & Inferred Cause
        </div>
        <div className="bg-zinc-950 p-3.5 rounded border border-zinc-800 text-xs font-mono flex flex-col gap-2 text-zinc-300">
          <div className="flex items-center justify-between">
            <span className="text-zinc-400">Earliest Observable Divergence (EOD):</span>
            <span className={isEOD ? "text-amber-400 font-bold" : "text-zinc-400"}>
              {eod_result.primary_eod_step || "None"} {isEOD && "(ACTIVE NODE)"}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-zinc-400">Divergence Category:</span>
            <span className="text-zinc-200 font-bold">{eod_result.divergence_category}</span>
          </div>
          <div className="pt-2 border-t border-zinc-900 text-zinc-400 text-xs leading-relaxed">
            <span className="text-zinc-300 font-semibold block mb-0.5">Automated Explanation:</span>
            {eod_result.explanation || "No divergence observed across pipeline nodes."}
          </div>
        </div>
      </div>

      {/* 3. Downstream Blast Radius & Impact */}
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-rose-400 font-mono">
          <ShieldAlert className="w-3.5 h-3.5" /> Downstream Blast Radius & Taint Propagation
        </div>
        <div className="bg-zinc-950 p-3.5 rounded border border-zinc-800 text-xs font-mono flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-zinc-400">Graph Taint Ratio:</span>
            <span className="text-rose-400 font-bold">
              <TabularNum value={blast_radius.blast_radius_ratio} format="percentage" /> (
              <TabularNum value={blast_radius.tainted_nodes_count} /> /{" "}
              <TabularNum value={blast_radius.total_graph_nodes} /> nodes)
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-zinc-400">Terminal Sinks Contaminated:</span>
            <span className="text-zinc-200">
              {blast_radius.affected_terminal_sinks?.length ? (
                blast_radius.affected_terminal_sinks.join(", ")
              ) : (
                <span className="text-emerald-400">0 Affected Sinks</span>
              )}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-zinc-400">Selected Node Tainted:</span>
            <span className={isTainted ? "text-rose-400 font-bold" : "text-emerald-400 font-semibold"}>
              {isTainted ? "YES (DOWNSTREAM CONTAMINATED)" : "NO (CLEAN)"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
