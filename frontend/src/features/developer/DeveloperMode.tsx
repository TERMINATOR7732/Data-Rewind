import React, { useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Code2,
  Layers,
  Play,
  Terminal,
} from "lucide-react";
import { api, ApiClientError } from "../../lib/api";
import { TransformationStep } from "../../types/api";
import { TabularNum } from "../../components/TabularNum";

const DEFAULT_PIPELINE_JSON = JSON.stringify(
  [
    {
      step_id: "filter_active",
      operation_type: "filter_rows",
      input_step_ids: ["raw_events"],
      parameters: {
        predicate: "status == 'ACTIVE' and count > 0",
      },
    },
    {
      step_id: "aggregate_metrics",
      operation_type: "aggregate_group_by",
      input_step_ids: ["filter_active"],
      parameters: {
        group_keys: ["user_id"],
        aggregations: {
          total_revenue: "sum(amount)",
          event_count: "count()",
        },
      },
    },
  ],
  null,
  2
);

export const DeveloperMode: React.FC = () => {
  const [pipelineJson, setPipelineJson] = useState<string>(DEFAULT_PIPELINE_JSON);
  const [inputRowsJson, setInputRowsJson] = useState<string>(
    JSON.stringify(
      {
        raw_events: [
          { user_id: 1, status: "ACTIVE", count: 3, amount: 45.0 },
          { user_id: 2, status: "INACTIVE", count: 0, amount: 0.0 },
          { user_id: 1, status: "ACTIVE", count: 2, amount: 20.0 },
        ],
      },
      null,
      2
    )
  );

  const [validationResult, setValidationResult] = useState<{
    valid: boolean;
    topological_order?: string[];
    error_message?: string;
  } | null>(null);

  const [executionResult, setExecutionResult] = useState<any | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const handleValidate = async () => {
    try {
      setError(null);
      setValidationResult(null);
      let parsedSteps: TransformationStep[];
      try {
        parsedSteps = JSON.parse(pipelineJson);
      } catch (e: any) {
        setError(`JSON Syntax Error: ${e.message}`);
        return;
      }

      const res = await api.validatePipeline(parsedSteps);
      setValidationResult(res);
    } catch (err: any) {
      setError(err instanceof ApiClientError ? err.message : "Validation request failed.");
    }
  };

  const handleExecute = async () => {
    try {
      setLoading(true);
      setError(null);
      setExecutionResult(null);

      let parsedSteps: TransformationStep[];
      let parsedInputs: Record<string, any[]>;
      try {
        parsedSteps = JSON.parse(pipelineJson);
      } catch (e: any) {
        setError(`Pipeline JSON Syntax Error: ${e.message}`);
        return;
      }
      try {
        parsedInputs = JSON.parse(inputRowsJson);
      } catch (e: any) {
        setError(`Input Data JSON Syntax Error: ${e.message}`);
        return;
      }

      const res = await api.executePipeline(parsedSteps, parsedInputs);
      setExecutionResult(res);
    } catch (err: any) {
      setError(err instanceof ApiClientError ? `${err.code}: ${err.message}` : "Execution failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col gap-8 font-sans">
      {/* Top Banner */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 shadow-xl">
        <div className="max-w-3xl flex flex-col gap-2">
          <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-emerald-400">
            <Code2 className="w-4 h-4" /> Developer Mode & Declarative DAGs (SPEC-MOD-01 §3)
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-100 sm:text-3xl">
            Declarative Pipeline Manifest Workbench
          </h1>
          <p className="text-sm text-zinc-400 leading-relaxed">
            Validate pipeline topology, check for Kahn cycles, inspect AST expression safety bounds, and execute
            arbitrary DAG transformations using local DuckDB Parquet checkpoints.
          </p>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="bg-rose-950/80 border border-rose-800 rounded-lg p-3 text-xs font-mono text-rose-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)} className="font-bold text-rose-400 hover:text-rose-200">
            Dismiss
          </button>
        </div>
      )}

      {/* Code Editors Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pipeline Steps Editor */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 flex flex-col gap-3 shadow-xl">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono font-semibold text-zinc-200 uppercase flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-emerald-400" /> Pipeline Definition (JSON Steps)
            </span>
            <button
              onClick={handleValidate}
              className="px-3 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-mono font-medium border border-zinc-700"
            >
              Validate DAG
            </button>
          </div>
          <textarea
            value={pipelineJson}
            onChange={(e) => setPipelineJson(e.target.value)}
            rows={14}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-xs font-mono text-zinc-300 focus:outline-none focus:border-emerald-600 leading-relaxed"
            spellCheck={false}
          />

          {/* Validation Result Banner */}
          {validationResult && (
            <div
              className={`p-3 rounded text-xs font-mono border ${
                validationResult.valid
                  ? "bg-emerald-950/60 border-emerald-800 text-emerald-300"
                  : "bg-rose-950/60 border-rose-800 text-rose-300"
              }`}
            >
              {validationResult.valid ? (
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span>
                    Valid DAG! Topological Order:{" "}
                    <strong>{validationResult.topological_order?.join(" → ")}</strong>
                  </span>
                </div>
              ) : (
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
                  <span>{validationResult.error_message}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Input Tables Editor */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 flex flex-col gap-3 shadow-xl">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono font-semibold text-zinc-200 uppercase flex items-center gap-1.5">
              <Terminal className="w-3.5 h-3.5 text-sky-400" /> Input Data Tables (JSON Mock Rows)
            </span>
            <button
              onClick={handleExecute}
              disabled={loading}
              className="px-4 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-zinc-950 text-xs font-mono font-bold flex items-center gap-1.5 disabled:opacity-50"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              {loading ? "Running..." : "Execute Pipeline"}
            </button>
          </div>
          <textarea
            value={inputRowsJson}
            onChange={(e) => setInputRowsJson(e.target.value)}
            rows={14}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-xs font-mono text-zinc-300 focus:outline-none focus:border-emerald-600 leading-relaxed"
            spellCheck={false}
          />

          {/* Execution Result */}
          {executionResult && (
            <div className="p-3 bg-zinc-950 border border-zinc-800 rounded text-xs font-mono text-zinc-300 flex flex-col gap-1.5">
              <div className="flex items-center justify-between border-b border-zinc-900 pb-1.5">
                <span className="text-emerald-400 font-bold">Execution Completed ({executionResult.status})</span>
                <span className="text-zinc-500">Run ID: {executionResult.run_id.slice(0, 8)}</span>
              </div>
              <div className="flex items-center justify-between text-[11px] text-zinc-400">
                <span>Duration: <TabularNum value={executionResult.duration_ms} /> ms</span>
                <span>Materialized Checkpoints: {Object.keys(executionResult.step_results).length}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
