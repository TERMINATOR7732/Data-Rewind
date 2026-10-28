import React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Scale,
  ShieldCheck,
} from "lucide-react";
import { ForensicDossier } from "../../types/api";
import { StatusBadge } from "../../components/StatusBadge";

interface VerificationHubProps {
  currentDossier: ForensicDossier | null;
  onNavigateToReports: (dossierId: string) => void;
}

export const VerificationHub: React.FC<VerificationHubProps> = ({
  currentDossier,
  onNavigateToReports,
}) => {
  if (!currentDossier) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-16 flex flex-col items-center justify-center text-center font-sans">
        <div className="h-16 w-16 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-500 mb-4">
          <ShieldCheck className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-bold text-zinc-100 font-mono">No Active Fix Verification</h2>
        <p className="text-xs text-zinc-400 max-w-md mt-2 font-mono leading-relaxed">
          Execute a Tri-Run Fix Verification from the <strong>Demo Sandbox</strong> or submit candidate pipeline patches to evaluate remediation vs baseline equivalence.
        </p>
      </div>
    );
  }

  const { metadata, verification } = currentDossier;
  const { dual_axis, verdict, verdict_meaning, evidence_chain, missing_evidence } = verification;
  const { remediation_axis, baseline_axis } = dual_axis;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col gap-8 font-sans">
      {/* Top Banner with Verdict */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Scale className="w-4 h-4 text-emerald-400" />
            <span className="text-xs font-mono uppercase text-emerald-400 tracking-wider">
              Tri-Run Fix Verification Hub (SPEC-MOD-05)
            </span>
          </div>
          <h1 className="text-2xl font-bold text-zinc-100">{verification.title}</h1>
          <p className="text-xs text-zinc-400 font-mono">
            Pipeline: <strong>{metadata.pipeline_name}</strong> • Dossier ID:{" "}
            <code>{metadata.dossier_id.slice(0, 8)}</code>
          </p>
        </div>

        {/* Big Verdict Pill */}
        <div className="flex flex-col items-start md:items-end gap-2">
          <StatusBadge status={verdict} size="lg" />
          <span className="text-xs font-mono text-zinc-400 max-w-xs md:text-right leading-tight">
            {verdict_meaning}
          </span>
        </div>
      </div>

      {/* Dual-Axis Verification Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Axis 1: Remediation Evaluation (R2 vs R1) */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 flex flex-col gap-4 shadow-lg">
          <div className="border-b border-zinc-800 pb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="h-6 w-6 rounded bg-zinc-800 text-zinc-300 font-mono text-xs flex items-center justify-center font-bold">
                A1
              </span>
              <h3 className="text-sm font-semibold text-zinc-100 font-mono">
                Axis 1: Remediation Evaluation (R₂ vs R₁)
              </h3>
            </div>
            <span
              className={`text-xs px-2.5 py-0.5 rounded font-mono font-bold ${
                remediation_axis.eod_remediated
                  ? "bg-emerald-950 text-emerald-300 border border-emerald-800"
                  : "bg-rose-950 text-rose-300 border border-rose-800"
              }`}
            >
              {remediation_axis.eod_remediated ? "FAULT REMEDIATED" : "FAULT PERSISTS"}
            </span>
          </div>

          <div className="text-xs font-mono text-zinc-300 flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <span className="text-zinc-500">Target EOD Step:</span>
              <strong className="text-zinc-200">{remediation_axis.eod_step || "None"}</strong>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-zinc-500">Severity Reduced:</span>
              <span className={remediation_axis.eod_severity_reduced ? "text-emerald-400" : "text-zinc-400"}>
                {remediation_axis.eod_severity_reduced ? "YES" : "NO"}
              </span>
            </div>
            <div className="p-3 bg-zinc-950 rounded border border-zinc-800 text-zinc-400 leading-relaxed text-[11px]">
              {remediation_axis.explanation}
            </div>
          </div>
        </div>

        {/* Axis 2: Baseline Equivalence (R2 vs R0) */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 flex flex-col gap-4 shadow-lg">
          <div className="border-b border-zinc-800 pb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="h-6 w-6 rounded bg-zinc-800 text-zinc-300 font-mono text-xs flex items-center justify-center font-bold">
                A2
              </span>
              <h3 className="text-sm font-semibold text-zinc-100 font-mono">
                Axis 2: Baseline Equivalence (R₂ vs R₀)
              </h3>
            </div>
            {baseline_axis ? (
              <span
                className={`text-xs px-2.5 py-0.5 rounded font-mono font-bold ${
                  baseline_axis.baseline_equivalent_across_all_steps
                    ? "bg-emerald-950 text-emerald-300 border border-emerald-800"
                    : "bg-amber-950 text-amber-300 border border-amber-800"
                }`}
              >
                {baseline_axis.baseline_equivalent_across_all_steps ? "100% EQUIVALENT" : "DRIFT DETECTED"}
              </span>
            ) : (
              <span className="text-xs px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 font-mono">
                BASELINE UNAVAILABLE
              </span>
            )}
          </div>

          <div className="text-xs font-mono text-zinc-300 flex flex-col gap-2.5">
            {baseline_axis ? (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-500">Equivalent at Sinks:</span>
                  <span
                    className={
                      baseline_axis.baseline_equivalent_at_sinks ? "text-emerald-400 font-bold" : "text-rose-400"
                    }
                  >
                    {baseline_axis.baseline_equivalent_at_sinks ? "YES (RESTORED)" : "NO"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-500">Secondary / Collateral Faults:</span>
                  <span
                    className={
                      baseline_axis.collateral_regressions.length > 0
                        ? "text-rose-400 font-bold"
                        : "text-emerald-400"
                    }
                  >
                    {baseline_axis.collateral_regressions.length > 0
                      ? `${baseline_axis.collateral_regressions.length} Step(s)`
                      : "0 (Clean)"}
                  </span>
                </div>
                {baseline_axis.collateral_regressions.length > 0 && (
                  <div className="p-2.5 bg-rose-950/60 border border-rose-800 rounded text-rose-300 text-[11px]">
                    <span className="font-bold block mb-1">Offending Collateral Steps:</span>
                    {baseline_axis.collateral_regressions.join(", ")}
                  </div>
                )}
                <div className="p-3 bg-zinc-950 rounded border border-zinc-800 text-zinc-400 leading-relaxed text-[11px]">
                  {baseline_axis.explanation}
                </div>
              </>
            ) : (
              <div className="p-4 bg-zinc-950 rounded border border-zinc-800 text-zinc-500 text-center">
                Baseline run $R_0$ was not supplied. Baseline equivalence cannot be verified.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Evidence Chain Items */}
      {evidence_chain.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 flex flex-col gap-4 shadow-xl font-mono text-xs">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
            <h3 className="font-semibold text-zinc-200 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" /> Multi-Tier Evidence Chain
            </h3>
            <span className="text-zinc-500">{evidence_chain.length} Evidence Items</span>
          </div>
          <div className="flex flex-col gap-3">
            {evidence_chain.map((item, idx) => (
              <div key={idx} className="bg-zinc-950 p-3.5 rounded-lg border border-zinc-800 flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-emerald-400 font-bold text-[11px] uppercase tracking-wider">
                    {item.tier}
                  </span>
                  <span className="text-zinc-500">Step: {item.step_id}</span>
                </div>
                <p className="text-zinc-200 font-sans leading-relaxed">{item.description}</p>
                {item.remediation_advice && (
                  <span className="text-zinc-400 text-[11px]">
                    <strong className="text-zinc-300">Remediation:</strong> {item.remediation_advice}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Missing Evidence / Disclaimer */}
      {missing_evidence.length > 0 && (
        <div className="bg-amber-950/40 border border-amber-800/80 rounded-xl p-5 flex flex-col gap-2 font-mono text-xs text-amber-200">
          <div className="flex items-center gap-2 font-bold text-amber-300">
            <AlertTriangle className="w-4 h-4" /> Missing Evidence Declarations
          </div>
          <ul className="list-disc pl-5 flex flex-col gap-1 text-[11px] text-amber-200/90">
            {missing_evidence.map((me, i) => (
              <li key={i}>
                Step <strong>{me.step_id}</strong>: missing {me.missing_artifact} — {me.impact_on_verdict}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Export Action Card */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div>
          <h4 className="font-semibold text-zinc-100 font-mono text-sm">
            Export Signed Forensic Investigation Dossier
          </h4>
          <p className="text-xs text-zinc-400 mt-1">
            Generate audit-ready reports in JSON, Markdown, Spreadsheet-Safe CSV, or Raw CSV.
          </p>
        </div>
        <button
          onClick={() => onNavigateToReports(metadata.dossier_id)}
          className="px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-zinc-950 font-bold text-xs font-mono transition-all flex items-center gap-2 whitespace-nowrap shadow-md"
        >
          <FileText className="w-4 h-4" />
          Open Report Studio
        </button>
      </div>
    </div>
  );
};
