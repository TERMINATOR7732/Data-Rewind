import React, { useState } from "react";
import {
  AlertOctagon,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileCode,
  FileSearch,
  HelpCircle,
  MapPin,
  Scale,
  Wrench,
} from "lucide-react";
import { Investigation, TabularDiffResult, StructuredFinding } from "../types/api";
import { TabularNum } from "./TabularNum";
import { StructuredExplainer } from "../runtime/forensics/diagnostics/structured-explainer";

interface EvidencePanelProps {
  investigation: Investigation;
  selectedStepId: string | null;
}

export const EvidencePanel: React.FC<EvidencePanelProps> = ({
  investigation,
  selectedStepId,
}) => {
  const [showTechnicalDetails, setShowTechnicalDetails] = useState<boolean>(false);

  const { eod_result, blast_radius, step_comparisons, structured_findings } = investigation;
  const currentStepId = selectedStepId || eod_result.primary_eod_step;
  const diffSummary: TabularDiffResult | undefined = currentStepId
    ? step_comparisons[currentStepId]
    : undefined;

  const isEOD = currentStepId === eod_result.primary_eod_step;
  const isTainted = currentStepId
    ? blast_radius.tainted_step_ids?.includes(currentStepId)
    : false;

  // Resolve or synthesize structured finding for the active step
  const activeFinding: StructuredFinding = React.useMemo(() => {
    // 1. Look for pre-computed finding matching active step
    const matching = structured_findings?.find((sf) => sf.where.step_id === currentStepId);
    if (matching) return matching;

    // 2. If viewing primary EOD and finding is available, use first
    if (isEOD && structured_findings && structured_findings.length > 0) {
      return structured_findings[0];
    }

    // 3. Synthesize structured finding on the fly from step context
    const stepCtx = {
      step_id: currentStepId || "unknown_step",
      operation: "TRANSFORMATION",
      diff_result: diffSummary as any,
    };

    return StructuredExplainer.buildStructuredFinding({
      ctx: stepCtx as any,
      diff: diffSummary as any,
      blastRadius: blast_radius as any,
    });
  }, [currentStepId, structured_findings, isEOD, diffSummary, blast_radius]);

  const riskBadgeColor =
    activeFinding.impact.risk_level === "CRITICAL"
      ? "bg-rose-950 text-rose-300 border-rose-800"
      : activeFinding.impact.risk_level === "HIGH"
      ? "bg-amber-950 text-amber-300 border-amber-800"
      : activeFinding.impact.risk_level === "MEDIUM"
      ? "bg-yellow-950 text-yellow-300 border-yellow-800"
      : "bg-emerald-950 text-emerald-300 border-emerald-800";

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 flex flex-col gap-5 shadow-lg font-sans text-zinc-100">
      {/* Panel Header */}
      <div className="border-b border-zinc-800 pb-3 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <FileSearch className="w-4 h-4 text-emerald-400" />
          <h3 className="text-sm font-semibold font-mono tracking-tight text-zinc-100">
            Forensic Evidence & Root Cause Analysis
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs px-2.5 py-1 rounded bg-zinc-800 text-zinc-300 font-mono border border-zinc-700">
            Step: <strong className="text-zinc-100">{currentStepId || "None"}</strong>
          </span>
          {isEOD && (
            <span className="text-[11px] px-2 py-0.5 rounded font-mono font-bold bg-amber-950 text-amber-300 border border-amber-800">
              First Divergence
            </span>
          )}
          {isTainted && !isEOD && (
            <span className="text-[11px] px-2 py-0.5 rounded font-mono font-bold bg-rose-950 text-rose-300 border border-rose-800">
              Downstream Tainted
            </span>
          )}
          {!isEOD && !isTainted && diffSummary?.is_equal && (
            <span className="text-[11px] px-2 py-0.5 rounded font-mono font-bold bg-emerald-950 text-emerald-300 border border-emerald-800">
              Verified Clean
            </span>
          )}
        </div>
      </div>

      {/* 1. What Went Wrong? (Plain Language, Zero Jargon) */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-amber-400 font-mono">
          <HelpCircle className="w-3.5 h-3.5 text-amber-400" /> 1. What Went Wrong?
        </div>
        <div className="bg-zinc-950 p-4 rounded-lg border border-zinc-800 text-xs text-zinc-200 leading-relaxed font-sans">
          <p className="font-medium text-sm text-zinc-100">{activeFinding.what_went_wrong}</p>
        </div>
      </div>

      {/* 2. Where Did It Go Wrong? */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-sky-400 font-mono">
          <MapPin className="w-3.5 h-3.5 text-sky-400" /> 2. Where Did It Go Wrong?
        </div>
        <div className="bg-zinc-950 p-3.5 rounded-lg border border-zinc-800 grid grid-cols-2 gap-2.5 text-xs font-mono">
          <div className="flex flex-col gap-0.5">
            <span className="text-zinc-500 text-[10px] uppercase">Pipeline Step:</span>
            <span className="text-zinc-200 font-semibold truncate">{activeFinding.where.step_id}</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-zinc-500 text-[10px] uppercase">Source Dataset:</span>
            <span className="text-zinc-200 font-semibold truncate">{activeFinding.where.dataset_name || "Internal Node"}</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-zinc-500 text-[10px] uppercase">Transformation:</span>
            <span className="text-emerald-400 font-semibold truncate">{activeFinding.where.operation}</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-zinc-500 text-[10px] uppercase">Affected Columns:</span>
            <span className="text-zinc-300 font-semibold truncate">
              {activeFinding.where.affected_columns.length > 0
                ? activeFinding.where.affected_columns.join(", ")
                : "None / Schema preserved"}
            </span>
          </div>
        </div>
      </div>

      {/* 3. What Is The Evidence? (Measured Facts & Deltas) */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-emerald-400 font-mono">
          <Scale className="w-3.5 h-3.5 text-emerald-400" /> 3. What Is The Evidence?
        </div>
        <div className="bg-zinc-950 p-3.5 rounded-lg border border-zinc-800 flex flex-col gap-3 text-xs font-mono">
          {/* Measured Counts Grid */}
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-zinc-900 p-2 rounded border border-zinc-850">
              <span className="text-zinc-500 text-[10px] block">Baseline Rows</span>
              <TabularNum value={activeFinding.evidence.baseline_row_count} className="text-zinc-200 font-bold text-sm" />
            </div>
            <div className="bg-zinc-900 p-2 rounded border border-zinc-850">
              <span className="text-zinc-500 text-[10px] block">Candidate Rows</span>
              <TabularNum value={activeFinding.evidence.target_row_count} className="text-zinc-200 font-bold text-sm" />
            </div>
            <div className="bg-zinc-900 p-2 rounded border border-zinc-850">
              <span className="text-zinc-500 text-[10px] block">Row Delta</span>
              <span
                className={`font-bold text-sm ${
                  activeFinding.evidence.row_delta === 0
                    ? "text-emerald-400"
                    : activeFinding.evidence.row_delta > 0
                    ? "text-sky-400"
                    : "text-amber-400"
                }`}
              >
                {activeFinding.evidence.row_delta >= 0 ? "+" : ""}
                <TabularNum value={activeFinding.evidence.row_delta} />
              </span>
            </div>
          </div>

          {/* Observed Facts Bullet List */}
          {activeFinding.evidence.observed_facts.length > 0 && (
            <div className="border-t border-zinc-900 pt-2 flex flex-col gap-1 text-[11px] text-zinc-300">
              <span className="text-zinc-500 uppercase text-[10px] font-bold">Verified Observations:</span>
              {activeFinding.evidence.observed_facts.map((fact, idx) => (
                <div key={idx} className="flex items-start gap-1.5">
                  <CheckCircle2 className="w-3 h-3 text-emerald-400 flex-shrink-0 mt-0.5" />
                  <span>{fact}</span>
                </div>
              ))}
            </div>
          )}

          {/* Sample Divergence Preview */}
          {activeFinding.evidence.sample_records && activeFinding.evidence.sample_records.length > 0 && (
            <div className="border-t border-zinc-900 pt-2 flex flex-col gap-1">
              <span className="text-zinc-500 uppercase text-[10px] font-bold">Sample Record Differences:</span>
              <div className="max-h-32 overflow-y-auto space-y-1 pr-1">
                {activeFinding.evidence.sample_records.slice(0, 3).map((rec, i) => (
                  <div key={i} className="p-2 rounded bg-zinc-900/90 border border-zinc-850 text-[10px]">
                    <div className="text-zinc-400 flex items-center justify-between">
                      <span>Key: {JSON.stringify(rec.key)}</span>
                      {rec.diff_columns.length > 0 && (
                        <span className="text-amber-400">Changed: {rec.diff_columns.join(", ")}</span>
                      )}
                    </div>
                    {Object.keys(rec.after).length > 0 ? (
                      <div className="grid grid-cols-2 gap-1 mt-1 text-zinc-400">
                        <div className="truncate">Base: {JSON.stringify(rec.before)}</div>
                        <div className="truncate text-zinc-200">Cand: {JSON.stringify(rec.after)}</div>
                      </div>
                    ) : (
                      <div className="text-rose-400 mt-0.5">Row removed in candidate</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 4. Why Does It Matter? (Consequence & Downstream Blast Radius) */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-rose-400 font-mono">
            <AlertOctagon className="w-3.5 h-3.5 text-rose-400" /> 4. Why Does It Matter? (Downstream Blast Radius & Impact)
          </div>
          <span className={`text-[10px] px-2 py-0.5 rounded font-mono font-bold border ${riskBadgeColor}`}>
            Risk: {activeFinding.impact.risk_level}
          </span>
        </div>
        <div className="bg-zinc-950 p-3.5 rounded-lg border border-zinc-800 flex flex-col gap-2.5 text-xs">
          <p className="text-zinc-300 leading-relaxed">{activeFinding.impact.consequence}</p>
          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-zinc-900 text-[11px] font-mono">
            <div className="flex flex-col">
              <span className="text-zinc-500 text-[10px]">Graph Taint:</span>
              <span className="text-rose-400 font-bold">
                <TabularNum value={blast_radius.blast_radius_ratio} format="percentage" /> (
                <TabularNum value={blast_radius.tainted_nodes_count} /> /{" "}
                <TabularNum value={blast_radius.total_graph_nodes} /> nodes)
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-zinc-500 text-[10px]">Tainted Terminal Sinks:</span>
              <span className="text-zinc-200 truncate">
                {activeFinding.impact.affected_terminal_sinks.length > 0
                  ? activeFinding.impact.affected_terminal_sinks.join(", ")
                  : "0 Sinks Tainted"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 5. How To Fix & Verify It? (Actionable & Measurable) */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-emerald-400 font-mono">
          <Wrench className="w-3.5 h-3.5 text-emerald-400" /> 5. How Can I Fix & Verify It?
        </div>
        <div className="bg-zinc-950 p-3.5 rounded-lg border border-zinc-800 flex flex-col gap-2 text-xs">
          <div className="flex flex-col gap-1">
            <span className="text-[10px] uppercase font-mono text-zinc-500 font-bold">Recommended Action:</span>
            <p className="text-zinc-200 font-medium">{activeFinding.remediation.action}</p>
          </div>
          <div className="flex flex-col gap-1 border-t border-zinc-900 pt-2">
            <span className="text-[10px] uppercase font-mono text-zinc-500 font-bold">Why This Helps:</span>
            <p className="text-zinc-400">{activeFinding.remediation.explanation}</p>
          </div>
          <div className="flex flex-col gap-1 border-t border-zinc-900 pt-2 font-mono text-[11px]">
            <span className="text-[10px] uppercase text-emerald-400 font-bold">Verification Condition:</span>
            <p className="text-emerald-300 bg-emerald-950/40 p-2 rounded border border-emerald-900/60">
              {activeFinding.remediation.verification_check}
            </p>
          </div>
        </div>
      </div>

      {/* Expandable Section: Technical Diagnostic Details */}
      <div className="border-t border-zinc-800 pt-3 flex flex-col gap-2">
        <button
          type="button"
          onClick={() => setShowTechnicalDetails((prev) => !prev)}
          className="flex items-center justify-between text-xs font-mono text-zinc-400 hover:text-zinc-200 transition-colors p-1"
        >
          <span className="flex items-center gap-1.5">
            <FileCode className="w-3.5 h-3.5 text-zinc-500" /> Technical Details (Rule Codes & Hashes)
          </span>
          {showTechnicalDetails ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>

        {showTechnicalDetails && (
          <div className="bg-zinc-950 p-3.5 rounded-lg border border-zinc-800 flex flex-col gap-2.5 text-[11px] font-mono text-zinc-400">
            <div className="flex items-center justify-between">
              <span className="text-zinc-500">Diagnostic Rule ID:</span>
              <code className="text-zinc-200 bg-zinc-900 px-1.5 py-0.5 rounded border border-zinc-800">
                {activeFinding.technical_details.rule_id}
              </code>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-zinc-500">Evidence Tier:</span>
              <span className="text-zinc-300">{activeFinding.technical_details.evidence_tier}</span>
            </div>
            <div className="flex flex-col gap-1 pt-1 border-t border-zinc-900">
              <span className="text-zinc-500">Baseline Content Hash:</span>
              <code className="text-zinc-300 select-all truncate">
                {activeFinding.evidence.baseline_hash || "none"}
              </code>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-zinc-500">Candidate Content Hash:</span>
              <code className="text-zinc-300 select-all truncate">
                {activeFinding.evidence.target_hash || "none"}
              </code>
            </div>
            {activeFinding.technical_details.parameters_diff && (
              <div className="flex flex-col gap-1 pt-1 border-t border-zinc-900">
                <span className="text-zinc-500">Parameters Comparison:</span>
                <div className="grid grid-cols-2 gap-1 text-[10px]">
                  <div className="bg-zinc-900 p-1.5 rounded">
                    <span className="text-zinc-500 block">Baseline:</span>
                    <pre className="text-zinc-300 overflow-x-auto whitespace-pre-wrap">
                      {JSON.stringify(activeFinding.technical_details.parameters_diff.baseline, null, 2)}
                    </pre>
                  </div>
                  <div className="bg-zinc-900 p-1.5 rounded">
                    <span className="text-zinc-500 block">Candidate:</span>
                    <pre className="text-zinc-300 overflow-x-auto whitespace-pre-wrap">
                      {JSON.stringify(activeFinding.technical_details.parameters_diff.target, null, 2)}
                    </pre>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
