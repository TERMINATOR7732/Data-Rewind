import React, { useEffect, useState } from "react";
import {
  Activity,
  AlertCircle,
  Play,
  ShieldCheck,
} from "lucide-react";
import { api, ApiClientError } from "../../lib/api";
import { ForensicDossier, Investigation, ScenarioSummary } from "../../types/api";

interface DemoHubProps {
  onInvestigationLoaded: (inv: Investigation) => void;
  onDossierLoaded: (dossier: ForensicDossier) => void;
}

export const DemoHub: React.FC<DemoHubProps> = ({
  onInvestigationLoaded,
  onDossierLoaded,
}) => {
  const [scenarios, setScenarios] = useState<ScenarioSummary[]>([]);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>("scn01");
  const [loading, setLoading] = useState<boolean>(true);
  const [executing, setExecuting] = useState<boolean>(false);
  const [verifying, setVerifying] = useState<boolean>(false);
  const [fixMode, setFixMode] = useState<string>("clean");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadScenarios();
  }, []);

  const loadScenarios = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.getScenarios();
      setScenarios(data);
      if (data.length > 0) {
        setSelectedScenarioId(data[0].scenario_id);
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
      const inv = await api.runScenario(selectedScenarioId);
      onInvestigationLoaded(inv);
    } catch (err: any) {
      setError(err instanceof ApiClientError ? `${err.code}: ${err.message}` : "Execution failed.");
    } finally {
      setExecuting(false);
    }
  };

  const handleVerifyFix = async () => {
    if (!selectedScenarioId) return;
    try {
      setVerifying(true);
      setError(null);
      const dossier = await api.verifyScenario(selectedScenarioId, fixMode);
      onDossierLoaded(dossier);
    } catch (err: any) {
      setError(err instanceof ApiClientError ? `${err.code}: ${err.message}` : "Fix verification failed.");
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col gap-8 font-sans">
      {/* Top Banner */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 shadow-xl relative overflow-hidden">
        <div className="max-w-3xl flex flex-col gap-2">
          <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-emerald-400">
            <Activity className="w-4 h-4" /> Demonstration Sandbox (SPEC-MOD-01)
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-100 sm:text-3xl">
            Pre-loaded Forensic Pipeline Regressions
          </h1>
          <p className="text-sm text-zinc-400 leading-relaxed">
            Evaluate Data Rewind's forensic capabilities in seconds. Explore real deterministic scenarios
            demonstrating mathematical drift, schema mutations, duplicates, and sentinel dropouts across multi-step DAG executions.
          </p>
        </div>
      </div>

      {/* Error Card */}
      {error && (
        <div className="bg-rose-950/80 border border-rose-800 rounded-lg p-4 text-xs font-mono text-rose-200 flex items-start justify-between gap-3">
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

      {/* Main Grid: Scenario Selector & Execution Panel */}
      {loading ? (
        <div className="p-12 flex flex-col items-center justify-center gap-3 text-zinc-400 font-mono text-sm">
          <span className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          Discovering pre-loaded scenarios...
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Scenario List (Left Column) */}
          <div className="flex flex-col gap-3">
            <span className="text-xs font-mono font-semibold uppercase tracking-wider text-zinc-400">
              Select Scenario ({scenarios.length})
            </span>
            {scenarios.map((s) => {
              const isSelected = s.scenario_id === selectedScenarioId;
              return (
                <div
                  key={s.scenario_id}
                  onClick={() => setSelectedScenarioId(s.scenario_id)}
                  className={`p-4 rounded-xl border text-left cursor-pointer transition-all ${
                    isSelected
                      ? "bg-zinc-850 border-emerald-500 ring-1 ring-emerald-500/50 shadow-md"
                      : "bg-zinc-900 border-zinc-800 hover:border-zinc-700 hover:bg-zinc-850/50"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-mono text-xs font-bold text-emerald-400 uppercase">
                      {s.scenario_id}
                    </span>
                    <span className="text-[11px] font-mono text-zinc-500">
                      {s.step_count} DAG steps
                    </span>
                  </div>
                  <h3 className="font-semibold text-zinc-100 text-sm mb-1">{s.title}</h3>
                  <p className="text-xs text-zinc-400 line-clamp-2 leading-relaxed">
                    {s.description}
                  </p>
                </div>
              );
            })}
          </div>

          {/* Scenario Details & Execution Controls (Right Column, Span 2) */}
          {selectedScenario && (
            <div className="lg:col-span-2 flex flex-col gap-6 bg-zinc-900 border border-zinc-800 rounded-xl p-6 shadow-xl">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-mono px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-emerald-400 font-bold uppercase">
                    {selectedScenario.scenario_id}
                  </span>
                  <span className="text-xs font-mono text-zinc-400">
                    Expected EOD: <strong className="text-amber-400">{selectedScenario.expected_eod_step}</strong>
                  </span>
                </div>
                <h2 className="text-xl font-bold text-zinc-100">{selectedScenario.title}</h2>
                <p className="text-xs text-zinc-300 mt-2 leading-relaxed font-sans">
                  {selectedScenario.description}
                </p>
              </div>

              {/* Metadata Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs font-mono">
                <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-800">
                  <span className="text-zinc-500 block mb-1">Injected Fault / Defect</span>
                  <span className="text-rose-300 font-semibold">{selectedScenario.description}</span>
                </div>
                <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-800">
                  <span className="text-zinc-500 block mb-1">Expected Root Cause Rule</span>
                  <span className="text-amber-300 font-semibold">{selectedScenario.expected_rule_id}</span>
                </div>
              </div>

              {/* Action 1: Run Full Investigation */}
              <div className="p-4 rounded-lg bg-zinc-950 border border-zinc-800 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div>
                  <h4 className="text-sm font-semibold text-zinc-200 font-mono">1. Execute Full Investigation</h4>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Runs baseline ($R_0$) vs faulted ($R_1$), detects Earliest Observable Divergence, traces downstream taint.
                  </p>
                </div>
                <button
                  onClick={handleRunInvestigation}
                  disabled={executing || verifying}
                  className="w-full sm:w-auto px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-zinc-950 font-bold text-xs font-mono transition-all flex items-center justify-center gap-2 shadow-md disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                >
                  {executing ? (
                    <>
                      <span className="w-3.5 h-3.5 border-2 border-zinc-950 border-t-transparent rounded-full animate-spin" />
                      Executing Pipeline...
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4 fill-current" />
                      Run Investigation
                    </>
                  )}
                </button>
              </div>

              {/* Action 2: Tri-Run Fix Verification */}
              <div className="p-4 rounded-lg bg-zinc-950 border border-zinc-800 flex flex-col gap-4">
                <div>
                  <h4 className="text-sm font-semibold text-zinc-200 font-mono">2. Tri-Run Fix Verification ($R_0, R_1, R_2$)</h4>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Evaluates candidate patch $R_2$ against both faulted $R_1$ (remediation) and baseline $R_0$ (baseline equivalence).
                  </p>
                </div>

                <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 border-t border-zinc-900">
                  <div className="flex items-center gap-2 w-full sm:w-auto">
                    <span className="text-xs font-mono text-zinc-400">Remediation Mode:</span>
                    <select
                      value={fixMode}
                      onChange={(e) => setFixMode(e.target.value)}
                      className="bg-zinc-900 border border-zinc-800 text-xs text-zinc-200 px-3 py-1.5 rounded font-mono focus:outline-none focus:border-emerald-600"
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
                    className="w-full sm:w-auto px-5 py-2.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border border-zinc-700 font-bold text-xs font-mono transition-all flex items-center justify-center gap-2 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                  >
                    {verifying ? (
                      <>
                        <span className="w-3.5 h-3.5 border-2 border-zinc-200 border-t-transparent rounded-full animate-spin" />
                        Verifying Tri-Run...
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
            </div>
          )}
        </div>
      )}
    </div>
  );
};
