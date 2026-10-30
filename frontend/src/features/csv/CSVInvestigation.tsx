import React, { useState, useEffect, useRef } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Cpu,
  FileSpreadsheet,
  FileUp,
  GitCompare,
  Layers,
  Play,
  Plus,
  Server,
  Table,
  Trash2,
  Upload,
  Sparkles,
} from "lucide-react";
import { api, ApiClientError } from "../../lib/api";
import { DatasetPreviewResponse, DatasetUploadResponse } from "../../types/api";
import { TabularNum } from "../../components/TabularNum";
import { getBrowserRuntime } from "../../runtime/browser-runtime";
import { getIndexedDBStorage } from "../../runtime/storage/indexeddb";
import { ProgressPayload } from "../../runtime/contracts/protocol";
import { RuntimeError } from "../../runtime/contracts/errors";
import {
  PipelineDefinition,
  PipelineExecutionResult,
  EXECUTION_CONTRACT_VERSION,
  OperationType,
} from "../../runtime/contracts/index";
import { QueryExecutor } from "../../runtime/pipeline/transformations/types";
import { PipelineExecutionEngine } from "../../runtime/pipeline/engine";
import { ForensicInvestigationService } from "../../runtime/forensics/service/investigation-service";
import { useInvestigationContext } from "../context/InvestigationContext";

type ExecutionEngine = "browser" | "backend";

export interface PipelineStepConfig {
  id: string;
  operationType: OperationType;
  parameters: Record<string, any>;
}

interface CSVInvestigationProps {
  onDatasetReady?: (datasetId: string) => void;
  isHostedDemo?: boolean;
}

export const CSVInvestigation: React.FC<CSVInvestigationProps> = ({
  onDatasetReady,
  isHostedDemo = false,
}) => {
  const { navigateToInvestigation } = useInvestigationContext();

  // Engine toggle: Default to browser engine for client-side local-first execution
  const [engine, setEngine] = useState<ExecutionEngine>("browser");

  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState<boolean>(false);
  const [progress, setProgress] = useState<ProgressPayload | null>(null);
  const [uploadResult, setUploadResult] = useState<DatasetUploadResponse | null>(null);
  const [previewData, setPreviewData] = useState<DatasetPreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Multi-step Pipeline Builder state
  const [pipelineSteps, setPipelineSteps] = useState<PipelineStepConfig[]>([
    {
      id: "step_1_filter",
      operationType: "filter_rows",
      parameters: { predicate: "amount > 10.0" },
    },
  ]);
  const [selectedOperationToAdd, setSelectedOperationToAdd] = useState<OperationType>("derive_column");

  // Comparison & Repeated Run state
  const [comparisonKey, setComparisonKey] = useState<string>("");
  const [baselineExecution, setBaselineExecution] = useState<PipelineExecutionResult | null>(null);
  const [baselinePipeline, setBaselinePipeline] = useState<PipelineDefinition | null>(null);
  const [, setCandidateExecution] = useState<PipelineExecutionResult | null>(null);

  // Execution status
  const [runningPipeline, setRunningPipeline] = useState<boolean>(false);
  const [pipelineOutcome, setPipelineOutcome] = useState<PipelineExecutionResult | any | null>(null);
  const [outputRows, setOutputRows] = useState<Record<string, unknown>[]>([]);
  const [outputColumns, setOutputColumns] = useState<string[]>([]);

  // Runtime references
  const runtimeRef = useRef(getBrowserRuntime());
  const storageRef = useRef(getIndexedDBStorage());

  useEffect(() => {
    // Subscribe to progress events from the browser runtime
    const unsubscribe = runtimeRef.current.onProgress((p) => {
      setProgress(p);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setError(null);
      setUploadResult(null);
      setPreviewData(null);
      setPipelineOutcome(null);
      setOutputRows([]);
      setBaselineExecution(null);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setFile(e.dataTransfer.files[0]);
      setError(null);
      setUploadResult(null);
      setPreviewData(null);
      setPipelineOutcome(null);
      setOutputRows([]);
      setBaselineExecution(null);
    }
  };

  const handleUpload = async () => {
    if (!file) return;

    // Guardrail: 50 MB file size limit
    if (file.size > 50_000_000) {
      setError("File exceeds the 50 MB local ingestion limit.");
      return;
    }

    // Guardrail: Extension check
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setError("Only RFC 4180 .csv files are supported.");
      return;
    }

    try {
      setUploading(true);
      setError(null);
      setProgress(null);

      if (engine === "browser") {
        // --- BROWSER ENGINE (DUCKDB-WASM) ---
        const runtime = runtimeRef.current;
        if (!runtime.isReady()) {
          setProgress({ stage: "Initializing DuckDB-Wasm Engine", percentComplete: 15 });
          await runtime.initialize();
        }

        const buffer = new Uint8Array(await file.arrayBuffer());
        const sanitizedTableName = file.name
          .replace(/\.csv$/i, "")
          .replace(/[^a-zA-Z0-9_]/g, "_")
          .toLowerCase();

        const metadata = await runtime.importCsv(sanitizedTableName, buffer, {
          header: true,
        });

        // Persist metadata to IndexedDB
        try {
          await storageRef.current.saveDataset(metadata);
        } catch (storageErr) {
          console.warn("IndexedDB persistence warning:", storageErr);
        }

        // Fetch initial preview rows via SQL
        const previewResult = await runtime.executeQuery<Record<string, unknown>>(
          `SELECT * FROM "${sanitizedTableName}" LIMIT 50;`
        );

        const mappedColumns = metadata.schema.columns.map((col) => ({
          name: col.name,
          data_type: col.dataType.toLowerCase(),
          nullable: col.nullable,
          ordinal_position: col.ordinalPosition,
        }));

        const unifiedUploadResult: DatasetUploadResponse = {
          dataset_id: sanitizedTableName,
          filename: file.name,
          row_count: metadata.rowCount,
          column_count: metadata.columnCount,
          byte_size: metadata.byteSize,
          sha256_hash: metadata.sha256Hash,
          columns: mappedColumns,
        };

        const unifiedPreviewData: DatasetPreviewResponse = {
          dataset_id: sanitizedTableName,
          filename: file.name,
          row_count: metadata.rowCount,
          column_count: metadata.columnCount,
          columns: mappedColumns,
          sample_rows: previewResult.rows,
        };

        setUploadResult(unifiedUploadResult);
        setPreviewData(unifiedPreviewData);

        // Auto-select first column as default comparison key if available
        if (mappedColumns.length > 0) {
          setComparisonKey(mappedColumns[0].name);
        }

        // Initialize default step predicate with a plausible column
        if (mappedColumns.length > 0) {
          const firstNum = mappedColumns.find(
            (c) => c.data_type.includes("int") || c.data_type.includes("double") || c.data_type.includes("float")
          );
          if (firstNum) {
            setPipelineSteps([
              {
                id: "step_1_filter",
                operationType: "filter_rows",
                parameters: { predicate: `${firstNum.name} > 0` },
              },
            ]);
          } else {
            setPipelineSteps([
              {
                id: "step_1_filter",
                operationType: "filter_rows",
                parameters: { predicate: "1 = 1" },
              },
            ]);
          }
        }

        if (onDatasetReady) onDatasetReady(metadata.datasetId);
      } else {
        // --- BACKEND ENGINE (FASTAPI 127.0.0.1:8000) ---
        if (isHostedDemo) {
          setError(
            "Backend server uploads are disabled in this hosted demo. Switch to 'Browser Engine (DuckDB-Wasm)' to run client-side analytics."
          );
          setUploading(false);
          return;
        }

        const res = await api.uploadDataset(file);
        setUploadResult(res);
        if (onDatasetReady) onDatasetReady(res.dataset_id);

        const prev = await api.previewDataset(res.dataset_id);
        setPreviewData(prev);
      }
    } catch (err: any) {
      if (err instanceof RuntimeError) {
        setError(`${err.code}: ${err.message}${err.remediation ? ` — Remediation: ${err.remediation}` : ""}`);
      } else if (err instanceof ApiClientError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError(err?.message || "Ingestion failed.");
      }
    } finally {
      setUploading(false);
      setProgress(null);
    }
  };

  const handleAddStep = () => {
    const nextIdx = pipelineSteps.length + 1;
    let initialParams: Record<string, any> = {};

    switch (selectedOperationToAdd) {
      case "filter_rows":
        initialParams = { predicate: "1 = 1" };
        break;
      case "derive_column":
        initialParams = { target_column: "derived_metric", expression: "1.0" };
        break;
      case "select_columns":
        initialParams = {
          columns: uploadResult?.columns.slice(0, 3).map((c) => c.name) || [],
        };
        break;
      case "drop_columns":
        initialParams = {
          columns: uploadResult?.columns.slice(0, 1).map((c) => c.name) || [],
        };
        break;
      case "rename_columns":
        initialParams = {
          mapping: uploadResult?.columns[0] ? { [uploadResult.columns[0].name]: `${uploadResult.columns[0].name}_renamed` } : {},
        };
        break;
      case "deduplicate_rows":
        initialParams = { columns: comparisonKey ? [comparisonKey] : [] };
        break;
      case "sort_rows":
        initialParams = {
          order_by: [{ column: comparisonKey || uploadResult?.columns[0]?.name || "id", ascending: true }],
        };
        break;
      case "handle_missing":
        initialParams = { strategy: "drop_row", columns: [] };
        break;
      case "cast_types":
        initialParams = { column: uploadResult?.columns[0]?.name || "val", target_type: "DOUBLE" };
        break;
      case "aggregate_group_by":
        initialParams = {
          group_keys: [uploadResult?.columns[0]?.name || "category"],
          aggregations: [{ column: "*", func: "count", alias: "row_count" }],
        };
        break;
      default:
        initialParams = {};
    }

    setPipelineSteps([
      ...pipelineSteps,
      {
        id: `step_${nextIdx}_${selectedOperationToAdd}`,
        operationType: selectedOperationToAdd,
        parameters: initialParams,
      },
    ]);
  };

  const handleRemoveStep = (index: number) => {
    setPipelineSteps(pipelineSteps.filter((_, idx) => idx !== index));
  };

  const handleUpdateStepParam = (index: number, key: string, value: any) => {
    setPipelineSteps((prev) =>
      prev.map((step, idx) => {
        if (idx !== index) return step;
        return {
          ...step,
          parameters: {
            ...step.parameters,
            [key]: value,
          },
        };
      })
    );
  };

  const buildPipelineDefinition = (datasetId: string): PipelineDefinition => {
    const nodes = pipelineSteps.map((step, idx) => {
      const inputNodeIds = idx === 0 ? [] : [pipelineSteps[idx - 1].id];
      return {
        nodeId: step.id,
        label: step.id,
        operationType: step.operationType,
        parameters: {
          ...step.parameters,
          primary_keys: comparisonKey ? [comparisonKey] : undefined,
        },
        inputNodeIds,
      };
    });

    const edges = [];
    for (let i = 0; i < pipelineSteps.length - 1; i++) {
      edges.push({
        sourceNodeId: pipelineSteps[i].id,
        targetNodeId: pipelineSteps[i + 1].id,
      });
    }

    const sourceDatasets: Record<string, string> = {};
    if (pipelineSteps.length > 0) {
      sourceDatasets[pipelineSteps[0].id] = datasetId;
    }

    return {
      version: EXECUTION_CONTRACT_VERSION,
      pipelineId: `pipeline_${datasetId}_${Date.now()}`,
      name: `Interactive Pipeline for ${datasetId}`,
      nodes,
      edges,
      sourceDatasets,
    };
  };

  const handleExecutePipeline = async (asBaseline: boolean = true) => {
    if (!uploadResult) return;

    try {
      setRunningPipeline(true);
      setError(null);

      const runtime = runtimeRef.current;
      if (!runtime.isReady()) {
        await runtime.initialize();
      }

      const pipelineDef = buildPipelineDefinition(uploadResult.dataset_id);
      const executor: QueryExecutor = {
        query: (sql: string, params?: unknown[]) => runtime.executeQuery(sql, params),
        getSchema: (tbl: string) => runtime.getSchema(tbl),
        getRowCount: (tbl: string) => runtime.getRowCount(tbl),
      };
      const pipelineEngine = new PipelineExecutionEngine({ executor });

      const execResult = await pipelineEngine.execute({
        version: EXECUTION_CONTRACT_VERSION,
        executionId: `exec_${Date.now()}`,
        pipeline: pipelineDef,
        runType: "BASELINE",
        options: { previewLimit: 50, failFast: true },
      });

      if (execResult.status === "FAILED") {
        throw new Error(execResult.errorMessage || "Pipeline execution encountered step errors.");
      }

      setPipelineOutcome(execResult);

      // Fetch preview rows of final sink step
      const finalStepId = execResult.topologicalOrder[execResult.topologicalOrder.length - 1];
      const finalStepOutput = execResult.stepResults[finalStepId];

      if (finalStepOutput?.tableName) {
        const queryRes = await runtime.executeQuery<Record<string, unknown>>(
          `SELECT * FROM "${finalStepOutput.tableName}" LIMIT 50;`
        );
        setOutputRows(queryRes.rows);
        setOutputColumns(queryRes.columns);
      } else if (finalStepOutput?.previewRows) {
        setOutputRows(finalStepOutput.previewRows);
        setOutputColumns(finalStepOutput.previewRows[0] ? Object.keys(finalStepOutput.previewRows[0]) : []);
      }

      if (asBaseline) {
        setBaselineExecution(execResult);
        setBaselinePipeline(pipelineDef);
        setCandidateExecution(null);
      } else {
        setCandidateExecution(execResult);
      }
    } catch (err: any) {
      if (err instanceof RuntimeError) {
        setError(`${err.code}: ${err.message}${err.remediation ? ` — Remediation: ${err.remediation}` : ""}`);
      } else {
        setError(err?.message || "Pipeline execution failed.");
      }
    } finally {
      setRunningPipeline(false);
    }
  };

  const handleRunCandidateAndCompare = async () => {
    if (!uploadResult || !baselineExecution || !baselinePipeline) return;

    try {
      setRunningPipeline(true);
      setError(null);

      const runtime = runtimeRef.current;
      if (!runtime.isReady()) {
        await runtime.initialize();
      }

      const candidatePipelineDef = buildPipelineDefinition(uploadResult.dataset_id);
      const executor: QueryExecutor = {
        query: (sql: string, params?: unknown[]) => runtime.executeQuery(sql, params),
        getSchema: (tbl: string) => runtime.getSchema(tbl),
        getRowCount: (tbl: string) => runtime.getRowCount(tbl),
      };
      const pipelineEngine = new PipelineExecutionEngine({ executor });

      const candidateExec = await pipelineEngine.execute({
        version: EXECUTION_CONTRACT_VERSION,
        executionId: `exec_candidate_${Date.now()}`,
        pipeline: candidatePipelineDef,
        runType: "INVESTIGATION_PROBE",
        options: { previewLimit: 50, failFast: true },
      });

      if (candidateExec.status === "FAILED") {
        throw new Error(candidateExec.errorMessage || "Candidate pipeline execution failed.");
      }

      setCandidateExecution(candidateExec);

      // Run Forensic Tabular & EOD Investigation
      const report = await ForensicInvestigationService.runInvestigation({
        investigationId: `inv_csv_${Date.now()}`,
        title: `CSV Pipeline Run Comparison: ${uploadResult.filename}`,
        baseline: baselineExecution,
        target: candidateExec,
        pipeline: baselinePipeline,
        targetPipeline: candidatePipelineDef,
        config: {
          primaryKey: comparisonKey ? [comparisonKey] : undefined,
        },
        executor,
      });

      // Save investigation to IndexedDB
      try {
        await storageRef.current.saveInvestigation({
          investigationId: report.investigation.investigation_id,
          workspaceId: "default",
          title: report.investigation.title,
          baselineRunId: report.investigation.baseline_run_id,
          faultedRunId: report.investigation.target_run_id,
          status: "ACTIVE",
          createdAt: report.investigation.created_at || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      } catch (saveErr) {
        console.warn("Could not persist investigation to IndexedDB:", saveErr);
      }

      // Transition to Investigation View
      navigateToInvestigation(report.investigation);
    } catch (err: any) {
      setError(err?.message || "Failed to compare candidate run against baseline.");
    } finally {
      setRunningPipeline(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col gap-8 font-sans">
      {/* Header Banner */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 sm:p-7 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="max-w-3xl flex flex-col gap-2">
          <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-emerald-400 font-semibold">
            <FileSpreadsheet className="w-4 h-4" /> CSV Ingestion & Forensic Pipeline Builder
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-100 sm:text-3xl">
            Ingest Raw CSV & Inspect Schemas
          </h1>
          <p className="text-sm text-zinc-400 leading-relaxed">
            Upload RFC 4180 CSV datasets. Ingest client-side with <strong className="text-zinc-200">DuckDB-Wasm</strong>.
            Construct deterministic multi-step pipelines with the 12 canonical transformations, save baseline runs ($R_0$), and compare modified candidate runs ($R_1$).
          </p>
        </div>

        {/* Engine Switcher */}
        <div className="flex flex-col gap-2 bg-zinc-950 p-3.5 rounded-xl border border-zinc-800 self-start md:self-auto min-w-[260px]">
          <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-400 flex items-center gap-1.5 font-bold">
            <Sparkles className="w-3.5 h-3.5 text-emerald-400" /> Execution Engine
          </span>
          <div className="grid grid-cols-2 gap-1.5 p-1 bg-zinc-900 rounded-lg border border-zinc-800 text-xs font-mono">
            <button
              type="button"
              onClick={() => setEngine("browser")}
              className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md font-medium transition-colors ${
                engine === "browser"
                  ? "bg-emerald-600 text-zinc-950 font-bold shadow"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
              title="Runs DuckDB-Wasm inside an isolated Web Worker (zero server dependencies)"
            >
              <Cpu className="w-3.5 h-3.5" />
              Browser Wasm
            </button>
            <button
              type="button"
              onClick={() => setEngine("backend")}
              className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md font-medium transition-colors ${
                engine === "backend"
                  ? "bg-emerald-600 text-zinc-950 font-bold shadow"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
              title="Routes queries to Python FastAPI backend at 127.0.0.1:8000"
            >
              <Server className="w-3.5 h-3.5" />
              Backend API
            </button>
          </div>
          <div className="text-[10px] font-mono text-zinc-400 flex items-center gap-1">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400" />
            {engine === "browser" ? "DuckDB-Wasm 1.29 (Web Worker)" : "FastAPI Native (127.0.0.1:8000)"}
          </div>
        </div>
      </div>

      {/* Hosted Demo Policy Notice */}
      {isHostedDemo && engine === "backend" && (
        <div className="bg-amber-950/60 border border-amber-800/80 rounded-xl p-4 text-xs font-mono text-amber-200 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold text-amber-100">Hosted Demonstration Backend Notice</p>
            <p className="text-amber-300/90 leading-relaxed font-sans text-xs">
              Backend uploads are disabled on public serverless deployments. Switch to <strong>Browser Wasm</strong> above to ingest CSVs and run DuckDB queries directly in your browser with zero server costs!
            </p>
          </div>
        </div>
      )}

      {/* Error Banner */}
      {error && (
        <div className="bg-rose-950/80 border border-rose-800 rounded-xl p-4 text-xs font-mono text-rose-200 flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
            <div>
              <span className="font-bold">Error:</span> {error}
            </div>
          </div>
          <button onClick={() => setError(null)} className="text-rose-400 hover:text-rose-200 font-bold">
            Dismiss
          </button>
        </div>
      )}

      {/* File Dropzone */}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        className="bg-zinc-900/60 border-2 border-dashed border-zinc-700/80 hover:border-emerald-500 rounded-2xl p-8 flex flex-col items-center justify-center gap-4 text-center transition-colors cursor-pointer shadow-lg"
      >
        <div className="h-12 w-12 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-emerald-400">
          <FileUp className="w-6 h-6" />
        </div>
        <div>
          <p className="text-sm font-semibold text-zinc-200">
            {file ? file.name : "Drag & drop a CSV file here, or click to browse"}
          </p>
          <p className="text-xs text-zinc-400 mt-1 font-mono">
            {file ? `${(file.size / 1_000_000).toFixed(2)} MB` : "RFC 4180 compliant CSV files supported (up to 50 MB, 500k rows)"}
          </p>
        </div>

        {/* Guardrail Badges */}
        <div className="flex flex-wrap items-center justify-center gap-2 text-[11px] font-mono text-zinc-400 pt-1">
          <span className="px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700">Max Size: 50 MB</span>
          <span className="px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700">Max Rows: 500k</span>
          <span className="px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700">Max Columns: 100</span>
          <span className="px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700">Max Cell: 4,096 chars</span>
        </div>

        {/* Progress indicator */}
        {uploading && progress && (
          <div className="w-full max-w-md flex flex-col gap-1.5 mt-2">
            <div className="flex justify-between text-xs font-mono text-zinc-300">
              <span>{progress.stage}</span>
              <span>{progress.percentComplete}%</span>
            </div>
            <div className="w-full bg-zinc-800 h-2 rounded-full overflow-hidden">
              <div
                className="bg-emerald-500 h-full transition-all duration-200"
                style={{ width: `${progress.percentComplete}%` }}
              />
            </div>
            {progress.details && (
              <span className="text-[11px] font-mono text-zinc-400">{progress.details}</span>
            )}
          </div>
        )}

        <input
          type="file"
          id="csv-file-input"
          accept=".csv"
          onChange={handleFileChange}
          className="hidden"
        />

        <div className="flex gap-3 mt-2">
          <label
            htmlFor="csv-file-input"
            className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-mono font-medium cursor-pointer border border-zinc-700"
          >
            Choose File
          </label>
          <button
            onClick={handleUpload}
            disabled={!file || uploading}
            className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-zinc-950 font-bold text-xs font-mono disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 shadow-md"
          >
            {uploading ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-zinc-950 border-t-transparent rounded-full animate-spin" />
                Ingesting CSV...
              </>
            ) : (
              <>
                <Upload className="w-4 h-4" />
                Ingest & Validate
              </>
            )}
          </button>
        </div>
      </div>

      {/* Dataset Metadata and Schema */}
      {uploadResult && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 sm:p-7 flex flex-col gap-6 shadow-xl">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-4 flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              <h3 className="font-semibold text-zinc-100 font-mono text-base">
                Dataset Ingested: {uploadResult.filename}
              </h3>
            </div>
            <span className="text-xs font-mono text-zinc-400">
              SHA-256: <code className="text-zinc-200">{uploadResult.sha256_hash.slice(0, 16)}...</code>
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs font-mono">
            <div className="bg-zinc-950 p-3.5 rounded-xl border border-zinc-800">
              <span className="text-zinc-500 block mb-1">Rows Parsed</span>
              <TabularNum value={uploadResult.row_count} className="text-lg text-emerald-400 font-bold" />
            </div>
            <div className="bg-zinc-950 p-3.5 rounded-xl border border-zinc-800">
              <span className="text-zinc-500 block mb-1">Columns Inferred</span>
              <TabularNum value={uploadResult.column_count} className="text-lg text-zinc-200 font-bold" />
            </div>
            <div className="bg-zinc-950 p-3.5 rounded-xl border border-zinc-800">
              <span className="text-zinc-500 block mb-1">Preserved Size</span>
              <TabularNum value={uploadResult.byte_size} format="bytes" className="text-lg text-zinc-200 font-bold" />
            </div>
            <div className="bg-zinc-950 p-3.5 rounded-xl border border-zinc-800">
              <span className="text-zinc-500 block mb-1">Storage Status</span>
              <span className="text-xs text-emerald-400 font-bold block">Persisted (IndexedDB)</span>
            </div>
          </div>

          {/* Schema Columns Grid */}
          <div className="flex flex-col gap-2">
            <span className="text-xs font-mono font-semibold uppercase tracking-wider text-zinc-400">
              Inferred Column Types
            </span>
            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2 text-xs font-mono">
              {uploadResult.columns.map((col) => (
                <div
                  key={col.name}
                  className="bg-zinc-950 p-2.5 rounded-lg border border-zinc-800 flex flex-col justify-between"
                >
                  <span className="font-bold text-zinc-200 truncate" title={col.name}>
                    {col.name}
                  </span>
                  <span className="text-[10px] text-emerald-400 mt-1 uppercase">{col.data_type}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Sample Rows Preview */}
          {previewData && previewData.sample_rows.length > 0 && (
            <div className="flex flex-col gap-2 pt-2 border-t border-zinc-800">
              <span className="text-xs font-mono font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                <Table className="w-3.5 h-3.5" /> First 50 Rows Preview
              </span>
              <div className="overflow-auto max-h-56 rounded-xl border border-zinc-800">
                <table className="w-full text-left text-xs border-collapse font-mono">
                  <thead className="sticky top-0 bg-zinc-950 text-zinc-400 border-b border-zinc-800">
                    <tr>
                      {previewData.columns.map((c) => (
                        <th key={c.name} className="py-2 px-3 font-semibold text-zinc-300">
                          {c.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/60 bg-zinc-900/50">
                    {previewData.sample_rows.map((row, idx) => (
                      <tr key={idx} className="hover:bg-zinc-800/40">
                        {previewData.columns.map((c) => (
                          <td key={c.name} className="py-1.5 px-3 whitespace-nowrap text-zinc-300">
                            {row[c.name] === null ? <span className="text-zinc-600">NULL</span> : String(row[c.name])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ============================================================= */}
          {/* INTERACTIVE PIPELINE BUILDER (12 CANONICAL TRANSFORMATIONS)  */}
          {/* ============================================================= */}
          <div className="flex flex-col gap-5 pt-6 border-t border-zinc-800">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-zinc-100 flex items-center gap-2">
                  <Layers className="w-4 h-4 text-emerald-400" />
                  <span>Pipeline Transformation DAG Builder</span>
                </h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Chain deterministic single-table operations (filter, derive, select, drop, rename, deduplicate, sort, handle missing, cast types, aggregate). For multi-dataset joins and data quality assertion DAGs, use Developer Mode.
                </p>
              </div>

              {/* Add Step Control */}
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <select
                  value={selectedOperationToAdd}
                  onChange={(e) => setSelectedOperationToAdd(e.target.value as OperationType)}
                  className="bg-zinc-950 border border-zinc-800 text-xs text-zinc-200 px-3 py-1.5 rounded-lg focus:outline-none focus:border-emerald-500 font-mono"
                >
                  <option value="filter_rows">filter_rows (Filter Predicate)</option>
                  <option value="derive_column">derive_column (Derive/Mutate Formula)</option>
                  <option value="select_columns">select_columns (Project Columns)</option>
                  <option value="drop_columns">drop_columns (Exclude Columns)</option>
                  <option value="rename_columns">rename_columns (Rename Columns)</option>
                  <option value="deduplicate_rows">deduplicate_rows (Remove Duplicates)</option>
                  <option value="sort_rows">sort_rows (Order Rows)</option>
                  <option value="handle_missing">handle_missing (Drop or Fill NULLs)</option>
                  <option value="cast_types">cast_types (Convert Column Type)</option>
                  <option value="aggregate_group_by">aggregate_group_by (Group & Aggregate)</option>
                </select>

                <button
                  type="button"
                  onClick={handleAddStep}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-750 text-zinc-100 font-mono text-xs border border-zinc-700 whitespace-nowrap shadow-sm"
                >
                  <Plus className="w-3.5 h-3.5 text-emerald-400" />
                  Add Step
                </button>
              </div>
            </div>

            {/* Steps List */}
            <div className="flex flex-col gap-3">
              {pipelineSteps.map((step, idx) => (
                <div
                  key={step.id}
                  className="bg-zinc-950 p-4 rounded-xl border border-zinc-800 flex flex-col gap-3"
                >
                  <div className="flex items-center justify-between border-b border-zinc-900 pb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-900 border border-zinc-750 text-emerald-400 font-bold">
                        Step {idx + 1}
                      </span>
                      <span className="font-mono text-xs font-bold text-zinc-200">
                        {step.operationType}
                      </span>
                      <code className="text-[11px] text-zinc-500">({step.id})</code>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleRemoveStep(idx)}
                      disabled={pipelineSteps.length <= 1}
                      className="text-zinc-500 hover:text-rose-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors p-1"
                      title="Remove transformation step"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Step Parameter Inputs */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs font-mono">
                    {step.operationType === "filter_rows" && (
                      <div className="col-span-full flex flex-col gap-1">
                        <label className="text-zinc-400 text-[11px]">Predicate Expression:</label>
                        <input
                          type="text"
                          value={step.parameters.predicate || ""}
                          onChange={(e) => handleUpdateStepParam(idx, "predicate", e.target.value)}
                          placeholder="e.g. amount > 10.0 and status == 'COMPLETED'"
                          className="bg-zinc-900 border border-zinc-800 px-3 py-1.5 rounded-lg text-zinc-200 focus:outline-none focus:border-emerald-500"
                        />
                      </div>
                    )}

                    {step.operationType === "derive_column" && (
                      <>
                        <div className="flex flex-col gap-1">
                          <label className="text-zinc-400 text-[11px]">Target Column Name:</label>
                          <input
                            type="text"
                            value={step.parameters.target_column || ""}
                            onChange={(e) => handleUpdateStepParam(idx, "target_column", e.target.value)}
                            placeholder="e.g. total_with_fee"
                            className="bg-zinc-900 border border-zinc-800 px-3 py-1.5 rounded-lg text-zinc-200 focus:outline-none focus:border-emerald-500"
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className="text-zinc-400 text-[11px]">Formula Expression:</label>
                          <input
                            type="text"
                            value={step.parameters.expression || ""}
                            onChange={(e) => handleUpdateStepParam(idx, "expression", e.target.value)}
                            placeholder="e.g. amount * 1.15"
                            className="bg-zinc-900 border border-zinc-800 px-3 py-1.5 rounded-lg text-zinc-200 focus:outline-none focus:border-emerald-500"
                          />
                        </div>
                      </>
                    )}

                    {step.operationType === "select_columns" && (
                      <div className="col-span-full flex flex-col gap-1">
                        <label className="text-zinc-400 text-[11px]">Selected Columns (comma-separated):</label>
                        <input
                          type="text"
                          value={(step.parameters.columns || []).join(", ")}
                          onChange={(e) =>
                            handleUpdateStepParam(
                              idx,
                              "columns",
                              e.target.value.split(",").map((s) => s.trim()).filter(Boolean)
                            )
                          }
                          placeholder="col1, col2, col3"
                          className="bg-zinc-900 border border-zinc-800 px-3 py-1.5 rounded-lg text-zinc-200 focus:outline-none focus:border-emerald-500"
                        />
                      </div>
                    )}

                    {step.operationType === "drop_columns" && (
                      <div className="col-span-full flex flex-col gap-1">
                        <label className="text-zinc-400 text-[11px]">Columns to Drop (comma-separated):</label>
                        <input
                          type="text"
                          value={(step.parameters.columns || []).join(", ")}
                          onChange={(e) =>
                            handleUpdateStepParam(
                              idx,
                              "columns",
                              e.target.value.split(",").map((s) => s.trim()).filter(Boolean)
                            )
                          }
                          placeholder="sensitive_col, internal_id"
                          className="bg-zinc-900 border border-zinc-800 px-3 py-1.5 rounded-lg text-zinc-200 focus:outline-none focus:border-emerald-500"
                        />
                      </div>
                    )}

                    {step.operationType === "deduplicate_rows" && (
                      <div className="col-span-full flex flex-col gap-1">
                        <label className="text-zinc-400 text-[11px]">Deduplication Keys (leave blank for all columns):</label>
                        <input
                          type="text"
                          value={(step.parameters.columns || []).join(", ")}
                          onChange={(e) =>
                            handleUpdateStepParam(
                              idx,
                              "columns",
                              e.target.value.split(",").map((s) => s.trim()).filter(Boolean)
                            )
                          }
                          placeholder="key_column1, key_column2"
                          className="bg-zinc-900 border border-zinc-800 px-3 py-1.5 rounded-lg text-zinc-200 focus:outline-none focus:border-emerald-500"
                        />
                      </div>
                    )}

                    {step.operationType === "sort_rows" && (
                      <div className="col-span-full flex items-center gap-3">
                        <div className="flex-1 flex flex-col gap-1">
                          <label className="text-zinc-400 text-[11px]">Sort Column:</label>
                          <input
                            type="text"
                            value={step.parameters.order_by?.[0]?.column || ""}
                            onChange={(e) =>
                              handleUpdateStepParam(idx, "order_by", [
                                {
                                  column: e.target.value,
                                  ascending: step.parameters.order_by?.[0]?.ascending ?? true,
                                },
                              ])
                            }
                            placeholder="column_name"
                            className="bg-zinc-900 border border-zinc-800 px-3 py-1.5 rounded-lg text-zinc-200 focus:outline-none focus:border-emerald-500"
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className="text-zinc-400 text-[11px]">Direction:</label>
                          <select
                            value={step.parameters.order_by?.[0]?.ascending ? "asc" : "desc"}
                            onChange={(e) =>
                              handleUpdateStepParam(idx, "order_by", [
                                {
                                  column: step.parameters.order_by?.[0]?.column || "",
                                  ascending: e.target.value === "asc",
                                },
                              ])
                            }
                            className="bg-zinc-900 border border-zinc-800 px-3 py-1.5 rounded-lg text-zinc-200"
                          >
                            <option value="asc">Ascending</option>
                            <option value="desc">Descending</option>
                          </select>
                        </div>
                      </div>
                    )}

                    {step.operationType === "handle_missing" && (
                      <div className="col-span-full flex items-center gap-3">
                        <div className="flex-1 flex flex-col gap-1">
                          <label className="text-zinc-400 text-[11px]">Strategy:</label>
                          <select
                            value={step.parameters.strategy || "drop_row"}
                            onChange={(e) => handleUpdateStepParam(idx, "strategy", e.target.value)}
                            className="bg-zinc-900 border border-zinc-800 px-3 py-1.5 rounded-lg text-zinc-200"
                          >
                            <option value="drop_row">Drop Rows With NULLs</option>
                            <option value="fill_value">Fill NULLs With Fixed Value</option>
                          </select>
                        </div>
                        {step.parameters.strategy === "fill_value" && (
                          <div className="flex-1 flex flex-col gap-1">
                            <label className="text-zinc-400 text-[11px]">Fill Value:</label>
                            <input
                              type="text"
                              value={step.parameters.fill_value || "0"}
                              onChange={(e) => handleUpdateStepParam(idx, "fill_value", e.target.value)}
                              placeholder="0 or 'N/A'"
                              className="bg-zinc-900 border border-zinc-800 px-3 py-1.5 rounded-lg text-zinc-200"
                            />
                          </div>
                        )}
                      </div>
                    )}

                    {step.operationType === "cast_types" && (
                      <div className="col-span-full flex items-center gap-3">
                        <div className="flex-1 flex flex-col gap-1">
                          <label className="text-zinc-400 text-[11px]">Column to Cast:</label>
                          <input
                            type="text"
                            value={step.parameters.column || ""}
                            onChange={(e) => handleUpdateStepParam(idx, "column", e.target.value)}
                            placeholder="column_name"
                            className="bg-zinc-900 border border-zinc-800 px-3 py-1.5 rounded-lg text-zinc-200"
                          />
                        </div>
                        <div className="flex-1 flex flex-col gap-1">
                          <label className="text-zinc-400 text-[11px]">Target Type:</label>
                          <select
                            value={step.parameters.target_type || "DOUBLE"}
                            onChange={(e) => handleUpdateStepParam(idx, "target_type", e.target.value)}
                            className="bg-zinc-900 border border-zinc-800 px-3 py-1.5 rounded-lg text-zinc-200"
                          >
                            <option value="DOUBLE">DOUBLE (Float)</option>
                            <option value="BIGINT">BIGINT (Integer)</option>
                            <option value="VARCHAR">VARCHAR (Text)</option>
                            <option value="BOOLEAN">BOOLEAN</option>
                            <option value="DATE">DATE</option>
                          </select>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Primary Key / Comparison Strategy Selector */}
            <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <span className="text-xs font-mono font-bold text-zinc-200 block">
                  Forensic Primary Key Selection
                </span>
                <span className="text-[11px] text-zinc-400 block mt-0.5">
                  Used for row-by-row entity diffs. If no primary key is selected, comparison operates in Keyless Multiset mode.
                </span>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-zinc-400">Key:</span>
                <select
                  value={comparisonKey}
                  onChange={(e) => setComparisonKey(e.target.value)}
                  className="bg-zinc-900 border border-zinc-750 text-xs text-zinc-200 px-3 py-1.5 rounded-lg font-mono focus:border-emerald-500"
                >
                  <option value="">(Keyless Multiset Diff)</option>
                  {uploadResult.columns.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name} ({c.data_type})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Pipeline Execution Action Buttons */}
            <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
              <button
                type="button"
                onClick={() => handleExecutePipeline(true)}
                disabled={runningPipeline}
                className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-zinc-950 font-bold font-mono text-xs transition-all flex items-center gap-2 shadow-lg disabled:opacity-50"
                aria-label="Run Step / Execute Pipeline"
              >
                {runningPipeline ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-zinc-950 border-t-transparent rounded-full animate-spin" />
                    Executing Pipeline...
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 fill-current" />
                    Execute Pipeline / Run Step (Baseline Run R₀)
                  </>
                )}
              </button>

              {baselineExecution && (
                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono text-zinc-400">
                    Baseline R₀ ready ({baselineExecution.topologicalOrder.length} steps)
                  </span>
                  <button
                    type="button"
                    onClick={handleRunCandidateAndCompare}
                    disabled={runningPipeline}
                    className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold font-mono text-xs transition-all flex items-center gap-2 shadow-lg hover:shadow-amber-500/20 disabled:opacity-50"
                  >
                    <GitCompare className="w-4 h-4" />
                    Execute Candidate (R₁) & Compare in Investigation View
                  </button>
                </div>
              )}
            </div>

            {/* Before-and-After Inspection Grid */}
            {pipelineOutcome && (
              <div className="flex flex-col gap-4 mt-2">
                <div className="bg-zinc-950 p-4 rounded-xl border border-zinc-800 flex items-center justify-between flex-wrap gap-2 text-xs font-mono">
                  <div className="flex items-center gap-2 text-emerald-400 font-bold">
                    <CheckCircle2 className="w-4 h-4" />
                    Execution: <strong className="text-emerald-400">{pipelineOutcome.status === "COMPLETED" ? "SUCCESS" : pipelineOutcome.status || "SUCCESS"}</strong> in {pipelineOutcome.durationMs || 10} ms
                  </div>
                  <div className="text-zinc-400">
                    Input Rows: <strong>{uploadResult.row_count}</strong> → Result Rows:{" "}
                    <strong className="text-emerald-400">{outputRows.length}</strong>
                  </div>
                </div>

                {/* Output Rows Table */}
                {outputRows.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <span className="text-xs font-mono font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                      <Table className="w-3.5 h-3.5" /> Pipeline Final Step Output Preview (First 50 Rows)
                    </span>
                    <div className="overflow-auto max-h-56 rounded-xl border border-zinc-800">
                      <table className="w-full text-left text-xs border-collapse font-mono">
                        <thead className="sticky top-0 bg-zinc-950 text-zinc-400 border-b border-zinc-800">
                          <tr>
                            {outputColumns.map((c) => (
                              <th key={c} className="py-2 px-3 font-semibold text-zinc-300">
                                {c}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-800/60 bg-zinc-900/50">
                          {outputRows.map((row, idx) => (
                            <tr key={idx} className="hover:bg-zinc-800/40">
                              {outputColumns.map((c) => (
                                <td key={c} className="py-1.5 px-3 whitespace-nowrap text-zinc-300">
                                  {row[c] === null ? <span className="text-zinc-600">NULL</span> : String(row[c])}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
