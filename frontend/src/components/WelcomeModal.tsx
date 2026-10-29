import React from "react";
import { Compass, X, ShieldCheck, GitCompare, Database } from "lucide-react";
import { Logo } from "./Logo";

interface WelcomeModalProps {
  isOpen: boolean;
  onStartTour: () => void;
  onDismiss: () => void;
}

export const WelcomeModal: React.FC<WelcomeModalProps> = ({
  isOpen,
  onStartTour,
  onDismiss,
}) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/80 backdrop-blur-sm animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-modal-title"
    >
      <div className="w-full max-w-lg bg-zinc-900 border border-zinc-700/80 rounded-2xl p-7 shadow-2xl flex flex-col gap-6 text-zinc-100 font-sans">
        {/* Top Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <Logo size={40} className="w-10 h-10 flex-shrink-0" />
            <div>
              <span className="text-[11px] font-mono uppercase tracking-widest text-emerald-400 font-semibold block">
                Evidence-Based Pipeline Forensics
              </span>
              <h2 id="welcome-modal-title" className="text-xl font-bold text-zinc-100">
                Welcome to Data Rewind
              </h2>
            </div>
          </div>
          <button
            onClick={onDismiss}
            className="text-zinc-400 hover:text-zinc-200 p-1 rounded-md hover:bg-zinc-800 transition-colors"
            aria-label="Close welcome introduction"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Core Value Proposition */}
        <div className="flex flex-col gap-3">
          <p className="text-sm text-zinc-300 leading-relaxed">
            Investigate a data pipeline failure, trace the <strong>Earliest Observable Divergence (EOD)</strong>, and inspect the exact mathematical and row-level evidence behind the result.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 text-xs">
            <div className="bg-zinc-950/80 p-3 rounded-lg border border-zinc-800 flex flex-col gap-1">
              <Database className="w-4 h-4 text-emerald-400" />
              <span className="font-semibold text-zinc-200">Replay & Compare</span>
              <span className="text-zinc-400 text-[11px]">Compare baseline vs faulted DAG runs step-by-step.</span>
            </div>
            <div className="bg-zinc-950/80 p-3 rounded-lg border border-zinc-800 flex flex-col gap-1">
              <GitCompare className="w-4 h-4 text-amber-400" />
              <span className="font-semibold text-zinc-200">Trace Root Cause</span>
              <span className="text-zinc-400 text-[11px]">Isolate the earliest divergence before taint propagates.</span>
            </div>
            <div className="bg-zinc-950/80 p-3 rounded-lg border border-zinc-800 flex flex-col gap-1">
              <ShieldCheck className="w-4 h-4 text-sky-400" />
              <span className="font-semibold text-zinc-200">Verify Candidate Fix</span>
              <span className="text-zinc-400 text-[11px]">Tri-run evaluation for remediation & equivalence.</span>
            </div>
          </div>
        </div>

        {/* Call to Actions */}
        <div className="flex flex-col-reverse sm:flex-row items-center justify-between gap-3 pt-2 border-t border-zinc-800">
          <button
            onClick={onDismiss}
            className="w-full sm:w-auto text-xs font-medium text-zinc-400 hover:text-zinc-200 px-4 py-2 rounded-lg hover:bg-zinc-800 transition-colors text-center"
          >
            Skip for now
          </button>
          <button
            onClick={onStartTour}
            className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-2.5 text-xs font-bold text-zinc-950 bg-emerald-400 hover:bg-emerald-300 rounded-lg transition-colors shadow-md"
          >
            <Compass className="w-4 h-4" /> Start Guided Tour
          </button>
        </div>
      </div>
    </div>
  );
};
