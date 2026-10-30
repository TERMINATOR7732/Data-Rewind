import React, { useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Code2,
  Cpu,
  Database,
  Hash,
  Layers,
  Play,
  Terminal,
  ShieldCheck,
} from "lucide-react";
import { api, ApiClientError } from "../../lib/api";
import { TransformationStep } from "../../types/api";
import { TabularNum } from "../../components/TabularNum";
import { getBrowserRuntime } from "../../runtime/browser-runtime";
import {
  PipelineDefinition,
  EXECUTION_CONTRACT_VERSION,
  PipelineExecutionResult,
  ValidationResult,
  ExecutionPlan,
} from "../../runtime/contracts/index";
import { validatePipeline } from "../../runtime/pipeline/dag-validator";
import { createExecutionPlan } from "../../runtime/pipeline/planner";

const DEFAULT_PIPELINE_JSON = JSON.stringify(
  [
    {
      step_id: "filter_active",
      operation_type: "filter_rows",
      input_step_ids: ["raw_events"],
      parameters: {
        predicate: 'status == "ACTIVE" and count > 0',
      },
    },
    {
      step_id: "derive_net",
      operation_type: "derive_column",
      input_step_ids: ["filter_active"],
      parameters: {
        new_column: "net_amount",
        expression: "round(amount * 0.82, 2)",
      },
    },
    {
      step_id: "aggregate_metrics",
      operation_type: "aggregate_group_by",
      input_step_ids: ["derive_net"],
      parameters: {
        group_keys: ["user_id"],
        aggregations: [
          { column: "net_amount", func: "sum", alias: "total_net_revenue" },
          { column: "*", func: "count", alias: "event_count" },
        ],
      },
    },
  ],
  null,
  2
);

const DEFAULT_INPUT_JSON = JSON.stringify(
  {
    raw_events: [
      { user_id: 1, status: "ACTIVE", count: 3, amount: 45.0 },
      { user_id: 2, status: "INACTIVE", count: 0, amount: 10.0 },
      { user_id: 1, status: "ACTIVE", count: 2, amount: 20.0 },
      { user_id: 3, status: "ACTIVE", count: 5, amount: 100.5 },
    ],
  },
  null,
  2
);

interface DeveloperModeProps {
  isHostedDemo?: boolean;
}

export const DeveloperMode: React.FC<DeveloperModeProps> = ({ isHostedDemo = false }) => {
  const [engineMode, setEngineMode] = useState<"browser" | "backend">("browser");
  const [pipelineJson, setPipelineJson] = useState<string>(DEFAULT_PIPELINE_JSON);
  const [inputRowsJson, setInputRowsJson] = useState<string>(DEFAULT_INPUT_JSON);

  const [validationResult, setValidationResult] = useState<ValidationResult | {
    valid: boolean;
    topological_order?: string[];
    error_message?: string;
  } | null>(null);

  const [executionPlan, setExecutionPlan] = useState<ExecutionPlan | null>(null);
  const [executionResult, setExecutionResult] = useState<PipelineExecutionResult | any | null>(null);
  const [activePreviewStep, setActivePreviewStep] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [progressText, setProgressText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * Helper to parse and convert steps into canonical PipelineDefinition.
   */
  const buildCanonicalPipeline = (rawSteps: any[], inputTableNames: string[]): PipelineDefinition => {
    const sourceDatasets: Record<string, string> = {};
    for (const name of inputTableNames) {
      sourceDatasets[name] = name;
    }

    return {
      version: EXECUTION_CONTRACT_VERSION,
      pipelineId: `pipe_${Date.now()}`,
      name: "Browser Manifest Pipeline",
      nodes: rawSteps.map((s) => ({
        nodeId: s.step_id || s.nodeId,
        label: s.label || s.step_id || s.nodeId,
        operationType: s.operation_type || s.operationType,
        parameters: s.parameters || {},
        inputNodeIds: s.input_step_ids || s.inputNodeIds || [],
      })),
      edges: [],
      sourceDatasets,
    };
  };

  const handleValidate = async () => {
    try {
      setError(null);
      setValidationResult(null);
      setExecutionPlan(null);

      let parsedSteps: any[];
      try {
        parsedSteps = JSON.parse(pipelineJson);
      } catch (e: any) {
        setError(`Pipeline JSON Syntax Error: ${e.message}`);
        return;
      }

      if (engineMode === "browser") {
        let inputTableNames: string[] = [];
        try {
          const parsedInputs = JSON.parse(inputRowsJson);
          inputTableNames = Object.keys(parsedInputs);
        } catch {
          // ignore
        }

        const canonical = buildCanonicalPipeline(parsedSteps, inputTableNames);
        const res = validatePipeline(canonical);
        setValidationResult(res);

        if (res.valid) {
          const plan = createExecutionPlan(canonical);
          setExecutionPlan(plan);
        }
      } else {
        const res = await api.validatePipeline(parsedSteps as TransformationStep[]);
        setValidationResult(res);
      }
    } catch (err: any) {
      setError(err instanceof ApiClientError ? err.message : err?.message || "Validation failed.");
    }
  };

  const handleExecute = async () => {
    try {
      setLoading(true);
      setError(null);
      setExecutionResult(null);
      setProgressText("Initializing execution...");

      let parsedSteps: any[];
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

      if (engineMode === "browser") {
        const runtime = getBrowserRuntime();
        if (!runtime.isReady()) {
          setProgressText("Spinning up isolated DuckDB-Wasm Web Worker...");
          await runtime.initialize();
        }

        // Subscribe to live worker progress
        const unsubscribe = runtime.onProgress((p) => {
          setProgressText(`${p.stage}: ${p.details || ""}`);
        });

        try {
          setProgressText("Ingesting mock tables into browser DuckDB instance...");
          // Ingest input datasets as CSV into DuckDB
          for (const [tableName, rows] of Object.entries(parsedInputs)) {
            if (Array.isArray(rows) && rows.length > 0) {
              const headers = Object.keys(rows[0]);
              const csvLines = [headers.join(",")];
              for (const r of rows) {
                const line = headers.map((h) => {
                  const val = r[h];
                  if (val === null || val === undefined) return "";
                  if (typeof val === "string") return `"${val.replace(/"/g, '""')}"`;
                  return String(val);
                }).join(",");
                csvLines.push(line);
              }
              const csvContent = csvLines.join("\n");
              await runtime.importCsv(tableName, csvContent);
            }
          }

          const canonical = buildCanonicalPipeline(parsedSteps, Object.keys(parsedInputs));
          setProgressText("Executing pipeline DAG via DuckDB-Wasm...");

          const res = await runtime.executePipeline({
            version: EXECUTION_CONTRACT_VERSION,
            executionId: `run_${Date.now()}`,
            pipeline: canonical,
            runType: "BASELINE",
          });

          setExecutionResult(res);
          if (res.topologicalOrder.length > 0) {
            setActivePreviewStep(res.topologicalOrder[res.topologicalOrder.length - 1]);
          }
        } finally {
          unsubscribe();
        }
      } else {
        const res = await api.executePipeline(parsedSteps as TransformationStep[], parsedInputs);
        setExecutionResult(res);
      }
    } catch (err: any) {
      setError(err instanceof ApiClientError ? `${err.code}: ${err.message}` : err?.message || "Execution failed.");
    } finally {
      setLoading(false);
      setProgressText(null);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col gap-8 font-sans">
      {/* Top Banner & Mode Toggle */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div className="max-w-3xl flex flex-col gap-2">
          <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-emerald-400">
            <Code2 className="w-4 h-4" /> Developer Mode & Declarative DAGs
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-100 sm:text-3xl">
            Declarative Pipeline Manifest Workbench
          </h1>
          <p className="text-sm text-zinc-400 leading-relaxed">
            Validate pipeline topology, check for Kahn cycles, inspect AST expression safety bounds, and execute
            arbitrary DAG transformations using local DuckDB Parquet checkpoints.
          </p>
        </div>

        {/* Engine Switcher */}
        <div className="flex flex-col gap-2 bg-zinc-950 border border-zinc-800 p-2.5 rounded-lg flex-shrink-0">
          <span className="text-[11px] font-mono uppercase text-zinc-400 font-semibold px-1 flex items-center gap-1.5">
            <Cpu className="w-3.5 h-3.5 text-emerald-400" /> Execution Engine
          </span>
          <div className="flex items-center bg-zinc-900 p-1 rounded-md border border-zinc-800">
            <button
              onClick={() => setEngineMode("browser")}
              className={`px-3 py-1.5 rounded text-xs font-mono font-medium flex items-center gap-1.5 transition-colors ${
                engineMode === "browser"
                  ? "bg-emerald-600 text-zinc-950 font-bold shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <Database className="w-3.5 h-3.5" /> Browser Wasm (Local ₹0)
            </button>
            <button
              onClick={() => setEngineMode("backend")}
              className={`px-3 py-1.5 rounded text-xs font-mono font-medium flex items-center gap-1.5 transition-colors ${
                engineMode === "backend"
                  ? "bg-emerald-600 text-zinc-950 font-bold shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <Cpu className="w-3.5 h-3.5" /> Python Backend API
            </button>
          </div>
        </div>
      </div>

      {/* Hosted Demo Policy Banner for Backend Mode */}
      {isHostedDemo && engineMode === "backend" && (
        <div className="bg-amber-950/60 border border-amber-800/80 rounded-xl p-4 text-xs font-mono text-amber-200 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold text-amber-100">Hosted Backend Demonstration Policy</p>
            <p className="text-amber-300/90 leading-relaxed font-sans text-xs">
              Ad-hoc pipeline execution on the remote backend is disabled in this public demonstration environment.
              Switch to <strong>Browser Wasm (Local ₹0)</strong> mode above to run unrestricted DAG execution
              directly inside your browser!
            </p>
          </div>
        </div>
      )}

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

          {/* Validation & Planning Result */}
          {validationResult && (
            <div
              className={`p-3 rounded text-xs font-mono border ${
                validationResult.valid
                  ? "bg-emerald-950/60 border-emerald-800 text-emerald-300"
                  : "bg-rose-950/60 border-rose-800 text-rose-300"
              }`}
            >
              {validationResult.valid ? (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span>
                      Valid DAG! Topological Order:{" "}
                      <strong>
                        {"topologicalOrder" in validationResult && validationResult.topologicalOrder
                          ? validationResult.topologicalOrder.join(" → ")
                          : "topological_order" in validationResult && validationResult.topological_order
                          ? validationResult.topological_order.join(" → ")
                          : executionPlan?.topologicalOrder.join(" → ")}
                      </strong>
                    </span>
                  </div>
                  {executionPlan && (
                    <div className="text-[11px] text-emerald-400/80 pt-1 border-t border-emerald-900/50 flex flex-wrap gap-2 items-center">
                      <span>Stages: {executionPlan.stages.map((stg, i) => `S${i}: [${stg.join(", ")}]`).join(" | ")}</span>
                      {executionPlan.tieBreakerApplied && (
                        <span className="text-amber-400 font-semibold">• Lexicographical Tie-breaking Applied</span>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
                  <span>
                    {"issues" in validationResult
                      ? validationResult.issues.map((i) => `[${i.code}] ${i.message}`).join("; ")
                      : validationResult.error_message}
                  </span>
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
              disabled={loading || (isHostedDemo && engineMode === "backend")}
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

          {/* Progress Banner */}
          {loading && progressText && (
            <div className="p-3 bg-zinc-950 border border-zinc-800 rounded text-xs font-mono text-emerald-400 flex items-center gap-2 animate-pulse">
              <Clock className="w-4 h-4 text-emerald-400 animate-spin" />
              <span>{progressText}</span>
            </div>
          )}

          {/* Execution Result Summary */}
          {executionResult && (
            <div className="p-3 bg-zinc-950 border border-zinc-800 rounded text-xs font-mono text-zinc-300 flex flex-col gap-2">
              <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
                <span className="text-emerald-400 font-bold flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4" /> Execution {executionResult.status}
                </span>
                <span className="text-zinc-500">
                  ID: {(executionResult.executionId || executionResult.run_id || "").slice(0, 8)}
                </span>
              </div>
              <div className="flex items-center justify-between text-[11px] text-zinc-400">
                <span>Duration: <TabularNum value={executionResult.durationMs ?? executionResult.duration_ms} /> ms</span>
                <span>Checkpoints: {Object.keys(executionResult.stepResults || executionResult.step_results || {}).length}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Intermediate Checkpoint Inspector (Browser Wasm Engine Results) */}
      {executionResult && executionResult.stepResults && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 shadow-xl flex flex-col gap-6">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-emerald-400" />
              <h2 className="text-lg font-bold text-zinc-100 font-mono">
                Intermediate Checkpoint & Hash Verification
              </h2>
            </div>
            <span className="text-xs font-mono text-zinc-400">
              SPEC-MOD-02 & SPEC-MOD-07 Checkpoints
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {executionResult.topologicalOrder?.map((stepId: string) => {
              const step = executionResult.stepResults[stepId];
              const isSelected = activePreviewStep === stepId;

              return (
                <div
                  key={stepId}
                  onClick={() => setActivePreviewStep(stepId)}
                  className={`p-4 rounded-lg border cursor-pointer transition-all ${
                    isSelected
                      ? "bg-zinc-800 border-emerald-500 shadow-md"
                      : "bg-zinc-950/70 border-zinc-800 hover:border-zinc-700"
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-mono font-bold text-zinc-200 truncate">{stepId}</span>
                    <span
                      className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold ${
                        step?.status === "SUCCESS"
                          ? "bg-emerald-950 text-emerald-400 border border-emerald-800"
                          : step?.status === "FAILED"
                          ? "bg-rose-950 text-rose-400 border border-rose-800"
                          : "bg-zinc-900 text-zinc-500 border border-zinc-800"
                      }`}
                    >
                      {step?.status || "UNKNOWN"}
                    </span>
                  </div>

                  <div className="space-y-1.5 text-[11px] font-mono text-zinc-400">
                    <div className="flex justify-between">
                      <span>Rows:</span>
                      <strong className="text-zinc-200"><TabularNum value={step?.rowCount ?? 0} /></strong>
                    </div>
                    <div className="flex justify-between">
                      <span>Columns:</span>
                      <strong className="text-zinc-200"><TabularNum value={step?.columnCount ?? 0} /></strong>
                    </div>
                    <div className="flex justify-between">
                      <span>Duration:</span>
                      <strong className="text-zinc-200"><TabularNum value={step?.durationMs ?? 0} /> ms</strong>
                    </div>
                    {step?.multisetHash && (
                      <div className="pt-2 border-t border-zinc-800 flex items-center justify-between text-[10px]">
                        <span className="flex items-center gap-1 text-zinc-500">
                          <Hash className="w-3 h-3 text-sky-400" /> Multiset:
                        </span>
                        <span className="font-mono text-sky-300 truncate max-w-[120px]" title={step.multisetHash}>
                          {step.multisetHash.slice(0, 10)}...
                        </span>
                      </div>
                    )}
                    {step?.error && (
                      <div className="pt-2 border-t border-rose-900/50 text-[10px] text-rose-400 font-mono break-words">
                        Error: {step.error.message}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Active Step Preview Rows */}
          {activePreviewStep && executionResult.stepResults[activePreviewStep] && (
            <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between border-b border-zinc-900 pb-2">
                <span className="text-xs font-mono text-zinc-300 font-semibold flex items-center gap-2">
                  <Database className="w-4 h-4 text-emerald-400" />
                  Materialized Parquet/Wasm Preview: <strong>{activePreviewStep}</strong>
                </span>
                <span className="text-[11px] font-mono text-zinc-500">
                  Showing first {executionResult.stepResults[activePreviewStep].previewRows?.length || 0} rows
                </span>
              </div>

              {executionResult.stepResults[activePreviewStep].previewRows?.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs font-mono text-zinc-300 border-collapse">
                    <thead>
                      <tr className="border-b border-zinc-800 text-zinc-400 bg-zinc-900/50">
                        {Object.keys(executionResult.stepResults[activePreviewStep].previewRows[0]).map((col) => (
                          <th key={col} className="p-2 font-medium">{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {executionResult.stepResults[activePreviewStep].previewRows.map((row: any, rIdx: number) => (
                        <tr key={rIdx} className="border-b border-zinc-900 hover:bg-zinc-900/30">
                          {Object.values(row).map((val: any, cIdx: number) => (
                            <td key={cIdx} className="p-2">
                              {val === null || val === undefined ? (
                                <span className="text-zinc-600 italic">null</span>
                              ) : (
                                String(val)
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-xs font-mono text-zinc-500 py-4 text-center">
                  No preview rows available for this step.
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
