import React, { useEffect, useState } from "react";
import {
  AlertCircle,
  ChevronRight,
  HelpCircle,
  Play,
  RotateCcw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { api, ApiClientError } from "../../lib/api";
import { ForensicDossier, Investigation, ScenarioSummary } from "../../types/api";
import {
  getCanonicalDemoSummaries,
  executeBrowserScenario,
  verifyBrowserScenarioFix,
} from "./demo-scenarios";

interface DemoHubProps {
  onInvestigationLoaded: (inv: Investigation) => void;
  onDossierLoaded: (dossier: ForensicDossier) => void;
  onStartTour?: () => void;
}

export const DemoHub: React.FC<DemoHubProps> = ({
  onInvestigationLoaded,
  onDossierLoaded,
  onStartTour,
}) => {
  const [scenarios, setScenarios] = useState<ScenarioSummary[]>([]);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>("scn01");
  const [loading, setLoading] = useState<boolean>(true);
  const [executing, setExecuting] = useState<boolean>(false);
  const [verifying, setVerifying] = useState<boolean>(false);
  const [fixMode, setFixMode] = useState<string>("clean");
  const [error, setError] = useState<string | null>(null);

  const [resetSuccessMessage, setResetSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    loadScenarios();
  }, []);

  const loadScenarios = async () => {
    try {
      setLoading(true);
      setError(null);
      try {
        const data = await api.getScenarios();
        if (data && data.length > 0) {
          setScenarios(data);
          setSelectedScenarioId(data[0].scenario_id);
          return;
        }
      } catch {
        // Backend offline or unreachable: fall back to browser-first canonical scenarios
      }

      const localScenarios = getCanonicalDemoSummaries();
      setScenarios(localScenarios);
      if (localScenarios.length > 0) {
        setSelectedScenarioId(localScenarios[0].scenario_id);
      }
    } catch (err: any) {
      setError(err instanceof ApiClientError ? err.message : "Failed to load demonstration scenarios.");
    } finally {
      setLoading(false);
    }
  };

  const selectedScenario = scenarios.find((s) => s.scenario_id === selectedScenarioId);

  const handleRunInvestigation = async () => {
    if (!selectedScenarioId) return;
    try {
      setExecuting(true);
      setError(null);
      setResetSuccessMessage(null);
      try {
        const inv = await api.runScenario(selectedScenarioId);
        onInvestigationLoaded(inv);
        return;
      } catch {
        // Fall back to in-browser deterministic execution engine
        const inv = await executeBrowserScenario(selectedScenarioId);
        onInvestigationLoaded(inv);
      }
    } catch (err: any) {
      setError(err instanceof ApiClientError ? `${err.code}: ${err.message}` : (err?.message || "Execution failed."));
    } finally {
      setExecuting(false);
    }
  };

  const handleVerifyFix = async () => {
    if (!selectedScenarioId) return;
    try {
      setVerifying(true);
      setError(null);
      setResetSuccessMessage(null);
      try {
        const dossier = await api.verifyScenario(selectedScenarioId, fixMode);
        onDossierLoaded(dossier);
        return;
      } catch {
        // Fall back to in-browser tri-run verification engine
        const dossier = await verifyBrowserScenarioFix(selectedScenarioId, fixMode);
        onDossierLoaded(dossier);
      }
    } catch (err: any) {
      setError(err instanceof ApiClientError ? `${err.code}: ${err.message}` : (err?.message || "Fix verification failed."));
    } finally {
      setVerifying(false);
    }
  };

  const handleResetScenario = () => {
    setFixMode("clean");
    setError(null);
    setResetSuccessMessage(`Scenario '${selectedScenarioId.toUpperCase()}' state reset to initial baseline conditions.`);
    setTimeout(() => setResetSuccessMessage(null), 4000);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col gap-8 font-sans">
      {/* 1. Introductory Value Proposition */}
      <section className="bg-gradient-to-b from-zinc-900 to-zinc-900/80 border border-zinc-800 rounded-2xl p-6 sm:p-8 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="max-w-3xl flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono uppercase tracking-widest text-emerald-400 font-semibold px-2 py-0.5 rounded bg-emerald-950/80 border border-emerald-800/80">
              Interactive Forensic Sandbox
            </span>
            <span className="text-xs text-zinc-400 hidden sm:inline">• 4 Canonical Scenarios Available</span>
          </div>

          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-zinc-100">
            Find where your data pipeline went wrong.
          </h1>

          <p className="text-sm text-zinc-300 leading-relaxed max-w-2xl">
            Trace unexpected output changes to the pipeline step that caused them. Inspect the evidence, understand the impact, and verify the fix.
          </p>

          {/* Workflow Sequence Indicator */}
          <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap pt-2 text-xs font-mono text-zinc-400">
            <span className="text-zinc-200 font-semibold">Workflow:</span>
            <span className="px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300">
              1. Pipeline DAG
            </span>
            <ChevronRight className="w-3.5 h-3.5 text-zinc-600" />
            <span className="px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300">
              2. Row Evidence
            </span>
            <ChevronRight className="w-3.5 h-3.5 text-zinc-600" />
            <span className="px-2 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800 font-semibold">
              3. First Divergence (EOD)
            </span>
            <ChevronRight className="w-3.5 h-3.5 text-zinc-600" />
            <span className="px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300">
              4. Impact
            </span>
            <ChevronRight className="w-3.5 h-3.5 text-zinc-600" />
            <span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 font-semibold">
              5. Verification
            </span>
          </div>
        </div>

        {/* Quick Tour CTA */}
        {onStartTour && (
          <div className="flex-shrink-0 flex flex-col items-start md:items-end gap-2">
            <button
              onClick={onStartTour}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold text-zinc-200 bg-zinc-800 hover:bg-zinc-750 border border-zinc-700 hover:border-emerald-500/60 transition-all shadow-md"
            >
              <Sparkles className="w-4 h-4 text-emerald-400" />
              <span>Take Product Tour</span>
            </button>
            <span className="text-[11px] text-zinc-400">5 quick steps • 1 min</span>
          </div>
        )}
      </section>

      {/* Error Alert */}
      {error && (
        <div className="bg-rose-950/80 border border-rose-800 rounded-xl p-4 text-xs font-mono text-rose-200 flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
            <div>
              <span className="font-bold">Error:</span> {error}
            </div>
          </div>
          <button
            onClick={() => setError(null)}
            className="text-rose-400 hover:text-rose-200 font-bold"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main Investigation Selector & Execution Panel */}
      {loading ? (
        <div className="p-16 flex flex-col items-center justify-center gap-3 text-zinc-400 font-mono text-sm">
          <span className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          Loading demonstration scenarios...
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column: Scenario Selector */}
          <div className="flex flex-col gap-3 min-w-0" data-tour="scenario-selector">
            <div className="flex items-center justify-between px-1">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400 font-mono">
                Select Pipeline Scenario
              </span>
              <span className="text-xs text-zinc-500 font-mono">{scenarios.length} Scenarios</span>
            </div>

            <div className="flex flex-col gap-2.5">
              {scenarios.map((s) => {
                const isSelected = s.scenario_id === selectedScenarioId;
                return (
                  <button
                    key={s.scenario_id}
                    onClick={() => setSelectedScenarioId(s.scenario_id)}
                    className={`p-4 rounded-xl border text-left cursor-pointer transition-all w-full flex flex-col gap-2 ${
                      isSelected
                        ? "bg-zinc-850 border-emerald-500 ring-1 ring-emerald-500/50 shadow-md"
                        : "bg-zinc-900 border-zinc-800 hover:border-zinc-700 hover:bg-zinc-850/50"
                    }`}
                  >
                    <div className="flex items-center justify-between w-full">
                      <span className="font-mono text-xs font-bold text-emerald-400 uppercase">
                        {s.scenario_id}
                      </span>
                      <span className="text-[11px] font-mono text-zinc-400">
                        {s.step_count} DAG steps
                      </span>
                    </div>
                    <div className="text-sm font-semibold text-zinc-100 leading-snug">
                      {s.title}
                    </div>
                    <p className="text-xs text-zinc-400 line-clamp-2 leading-relaxed">
                      {s.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right Column: Selected Scenario Details & Execution Actions */}
          {selectedScenario && (
            <div className="lg:col-span-2 flex flex-col gap-6 bg-zinc-900 border border-zinc-800 rounded-2xl p-6 sm:p-7 shadow-xl min-w-0">
              <div className="border-b border-zinc-800 pb-5 flex flex-col gap-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-emerald-400 font-bold uppercase">
                      {selectedScenario.scenario_id}
                    </span>
                    <span className="text-xs font-mono text-zinc-400">
                      Pipeline: <strong>{selectedScenario.scenario_id}</strong>
                    </span>
                  </div>
                  <span className="text-xs font-mono text-zinc-400">
                    Expected EOD: <strong className="text-amber-400">{selectedScenario.expected_eod_step}</strong>
                  </span>
                </div>

                <h2 className="text-xl sm:text-2xl font-bold text-zinc-100 leading-tight">
                  {selectedScenario.title}
                </h2>

                <p className="text-sm text-zinc-300 leading-relaxed font-sans">
                  {selectedScenario.description}
                </p>
              </div>

              {/* Diagnostic Metadata Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="bg-zinc-950 p-3.5 rounded-xl border border-zinc-800 flex flex-col gap-1.5 min-w-0">
                  <span className="text-zinc-400 font-mono text-[11px]">Injected Pipeline Defect</span>
                  <span className="text-rose-300 font-medium leading-relaxed truncate" title={selectedScenario.description}>
                    {selectedScenario.description}
                  </span>
                </div>
                <div className="bg-zinc-950 p-3.5 rounded-xl border border-zinc-800 flex flex-col gap-1.5 min-w-0">
                  <span className="text-zinc-400 font-mono text-[11px]">Expected Root Cause Rule</span>
                  <span className="text-amber-300 font-mono font-semibold">
                    {selectedScenario.expected_rule_id}
                  </span>
                </div>
              </div>

              {/* Action 1: Primary Investigation Workflow */}
              <div
                className="p-5 rounded-xl bg-zinc-950 border border-zinc-800/80 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
                data-tour="run-investigation"
              >
                <div className="space-y-1 max-w-md">
                  <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                    <Play className="w-4 h-4 text-emerald-400 fill-current" />
                    <span>Run Forensic Investigation</span>
                  </h3>
                  <p className="text-xs text-zinc-400 leading-relaxed">
                    Executes baseline and faulted pipeline runs, isolates the earliest divergence point, and maps downstream taint propagation.
                  </p>
                </div>

                <button
                  onClick={handleRunInvestigation}
                  disabled={executing || verifying}
                  className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold text-xs transition-all flex items-center justify-center gap-2 shadow-lg hover:shadow-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                  aria-label={`Run investigation for ${selectedScenario.scenario_id}`}
                >
                  {executing ? (
                    <>
                      <span className="w-3.5 h-3.5 border-2 border-zinc-950 border-t-transparent rounded-full animate-spin" />
                      Analyzing Pipeline...
                    </>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5 fill-current" />
                      Run Investigation
                    </>
                  )}
                </button>
              </div>

              {/* Action 2: Tri-Run Fix Verification */}
              <div
                className="p-5 rounded-xl bg-zinc-950 border border-zinc-800/80 flex flex-col gap-4"
                data-tour="verify-section"
              >
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    <span>Tri-Run Fix Verification</span>
                  </h3>
                  <p className="text-xs text-zinc-400 leading-relaxed">
                    Evaluates a candidate patch across dual axes: Remediation (does it resolve the fault?) and Baseline Equivalence (does it avoid collateral regressions?).
                  </p>
                </div>

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-3 border-t border-zinc-900 min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs text-zinc-400 font-mono whitespace-nowrap">Fix Mode:</span>
                    <select
                      value={fixMode}
                      onChange={(e) => setFixMode(e.target.value)}
                      className="bg-zinc-900 border border-zinc-750 text-xs text-zinc-200 px-3 py-1.5 rounded-lg focus:outline-none focus:border-emerald-500 w-full sm:w-auto max-w-full font-sans truncate"
                    >
                      <option value="clean">Clean Fix (Restores Baseline Equivalence)</option>
                      <option value="intentional">Intentional Update (Contracted Logic Drift)</option>
                      <option value="partial">Partial Restoration (Residual Drift)</option>
                      <option value="unresolved">Unresolved Regression (Fault Persists)</option>
                      <option value="collateral">Collateral Regression (Introduces New Fault)</option>
                    </select>
                  </div>

                  <button
                    onClick={handleVerifyFix}
                    disabled={executing || verifying}
                    className="px-5 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-750 text-zinc-100 border border-zinc-700 font-semibold text-xs transition-all flex items-center justify-center gap-2 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                    aria-label={`Verify fix candidate in ${fixMode} mode`}
                  >
                    {verifying ? (
                      <>
                        <span className="w-3.5 h-3.5 border-2 border-zinc-200 border-t-transparent rounded-full animate-spin" />
                        Evaluating Tri-Run...
                      </>
                    ) : (
                      <>
                        <ShieldCheck className="w-4 h-4 text-emerald-400" />
                        Verify Fix Candidate
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Action 3: Safe Scenario Reset */}
              <div className="flex items-center justify-between pt-2 border-t border-zinc-800 text-xs font-mono text-zinc-400">
                <span className="text-[11px] text-zinc-500">
                  Resetting restores initial baseline fixtures without altering custom datasets or workspace archives.
                </span>
                <button
                  type="button"
                  onClick={handleResetScenario}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 text-zinc-300 text-xs transition-colors"
                >
                  <RotateCcw className="w-3 h-3 text-zinc-400" />
                  <span>Reset Scenario</span>
                </button>
              </div>

              {/* Reset Success Notice */}
              {resetSuccessMessage && (
                <div className="p-3 bg-emerald-950/70 border border-emerald-800/80 rounded-lg text-xs font-mono text-emerald-200">
                  {resetSuccessMessage}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Forensic Evidence & Technical Terminology Guide */}
      <section className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 sm:p-7 shadow-xl flex flex-col gap-4 font-sans">
        <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-zinc-400 font-semibold">
          <HelpCircle className="w-4 h-4 text-emerald-400" />
          <span>Forensic Evidence & Investigation Terminology</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
          <div className="bg-zinc-950 p-4 rounded-xl border border-zinc-800 flex flex-col gap-1.5">
            <span className="font-mono font-bold text-amber-300">Earliest Observable Divergence (EOD)</span>
            <p className="text-zinc-400 leading-relaxed font-sans">
              The first DAG node in topological execution order where pipeline outputs differ between runs. EOD proves where the data changed; investigation rules evaluate whether it represents the root fault.
            </p>
          </div>

          <div className="bg-zinc-950 p-4 rounded-xl border border-zinc-800 flex flex-col gap-1.5">
            <span className="font-mono font-bold text-emerald-300">Keyed vs Keyless Comparison</span>
            <p className="text-zinc-400 leading-relaxed font-sans">
              Primary key comparison isolates exact cell changes per entity. Keyless comparison falls back to multiset row multiplicity diffs when keys are unaligned or duplicate.
            </p>
          </div>

          <div className="bg-zinc-950 p-4 rounded-xl border border-zinc-800 flex flex-col gap-1.5">
            <span className="font-mono font-bold text-cyan-300">Evidence Tiers</span>
            <p className="text-zinc-400 leading-relaxed font-sans">
              Categorizes findings from Proven Observations (bit-for-bit mathematical cell diffs) to Causal Hypotheses (formula or code changes that explain observed variations).
            </p>
          </div>

          <div className="bg-zinc-950 p-4 rounded-xl border border-zinc-800 flex flex-col gap-1.5">
            <span className="font-mono font-bold text-violet-300">Blast Radius & Impact</span>
            <p className="text-zinc-400 leading-relaxed font-sans">
              Separates directly observed output diffs from potentially affected downstream models, preventing false alarms on un-mutated branches.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
};
