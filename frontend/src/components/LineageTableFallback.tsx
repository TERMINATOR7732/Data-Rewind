import React from "react";
import { AlertTriangle, CheckCircle, Database, ShieldAlert } from "lucide-react";
import { Investigation } from "../types/api";
import { TabularNum } from "./TabularNum";

interface LineageTableFallbackProps {
  investigation: Investigation;
  selectedStepId: string | null;
  onSelectStep: (stepId: string) => void;
}

export const LineageTableFallback: React.FC<LineageTableFallbackProps> = ({
  investigation,
  selectedStepId,
  onSelectStep,
}) => {
  const { topological_order, step_comparisons, eod_result, blast_radius, step_dependencies } =
    investigation;

  const eodStep = eod_result.primary_eod_step;
  const taintedSteps = new Set(blast_radius.tainted_step_ids || []);

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden font-mono text-xs">
      <div className="p-3 bg-zinc-950 border-b border-zinc-800 flex items-center justify-between">
        <span className="font-semibold text-zinc-200">
          Structured Pipeline Dependency Table (Accessible Alternative to Graph)
        </span>
        <span className="text-zinc-500">Topological Sort Order (Kahn's Algorithm)</span>
      </div>
      <table className="w-full text-left border-collapse">
        <thead className="bg-zinc-950/60 text-zinc-400 border-b border-zinc-800">
          <tr>
            <th className="py-2 px-3">Order</th>
            <th className="py-2 px-3">Step ID</th>
            <th className="py-2 px-3">Status</th>
            <th className="py-2 px-3">Upstream Dependencies</th>
            <th className="py-2 px-3">Divergence / Taint Role</th>
            <th className="py-2 px-3 text-right">Modified Rows</th>
            <th className="py-2 px-3 text-center">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800/60">
          {topological_order.map((sid, idx) => {
            const isEOD = sid === eodStep;
            const isTainted = taintedSteps.has(sid);
            const comp = step_comparisons[sid];
            const isSelected = sid === selectedStepId;
            const deps = step_dependencies?.[sid] || [];

            return (
              <tr
                key={sid}
                className={`hover:bg-zinc-800/50 transition-colors ${
                  isSelected
                    ? "bg-emerald-950/30 border-l-2 border-emerald-500"
                    : isEOD
                    ? "bg-amber-950/20"
                    : isTainted
                    ? "bg-rose-950/15"
                    : ""
                }`}
              >
                <td className="py-2.5 px-3 text-zinc-500">{idx + 1}</td>
                <td className="py-2.5 px-3 font-bold text-zinc-200">
                  <span className="flex items-center gap-1.5">
                    <Database className="w-3.5 h-3.5 text-zinc-400" />
                    {sid}
                  </span>
                </td>
                <td className="py-2.5 px-3">
                  {comp ? (
                    comp.is_equal ? (
                      <span className="text-emerald-400 flex items-center gap-1">
                        <CheckCircle className="w-3.5 h-3.5" /> Identical
                      </span>
                    ) : (
                      <span className="text-amber-400 flex items-center gap-1">
                        <AlertTriangle className="w-3.5 h-3.5" /> Divergent
                      </span>
                    )
                  ) : (
                    <span className="text-zinc-500">—</span>
                  )}
                </td>
                <td className="py-2.5 px-3 text-zinc-400">
                  {deps.length > 0 ? deps.join(", ") : <span className="text-zinc-600">Root Source</span>}
                </td>
                <td className="py-2.5 px-3">
                  {isEOD ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-950 border border-amber-700 text-amber-200 font-bold">
                      <AlertTriangle className="w-3 h-3 text-amber-400" /> EOD BEACON
                    </span>
                  ) : isTainted ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-950 border border-rose-800 text-rose-300">
                      <ShieldAlert className="w-3 h-3 text-rose-400" /> TAINTED
                    </span>
                  ) : (
                    <span className="text-zinc-500">Clean</span>
                  )}
                </td>
                <td className="py-2.5 px-3 text-right">
                  {comp ? <TabularNum value={comp.modified_count} /> : "—"}
                </td>
                <td className="py-2.5 px-3 text-center">
                  <button
                    onClick={() => onSelectStep(sid)}
                    className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-mono text-[11px] border border-zinc-700"
                  >
                    Inspect Diff
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
