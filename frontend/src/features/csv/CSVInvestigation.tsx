import React, { useState, useEffect, useRef } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Cpu,
  FileSpreadsheet,
  FileUp,
  Play,
  Server,
  Table,
  Upload,
  Clock,
  Sparkles,
} from "lucide-react";
import { api, ApiClientError } from "../../lib/api";
import { DatasetPreviewResponse, DatasetUploadResponse } from "../../types/api";
import { TabularNum } from "../../components/TabularNum";
import { getBrowserRuntime } from "../../runtime/browser-runtime";
import { getIndexedDBStorage } from "../../runtime/storage/indexeddb";
import { ProgressPayload, QueryResult } from "../../runtime/contracts/protocol";
import { RuntimeError } from "../../runtime/contracts/errors";

type ExecutionEngine = "browser" | "backend";

interface CSVInvestigationProps {
  onDatasetReady?: (datasetId: string) => void;
  isHostedDemo?: boolean;
}

export const CSVInvestigation: React.FC<CSVInvestigationProps> = ({
  onDatasetReady,
  isHostedDemo = false,
}) => {
  // Engine toggle: Default to browser engine for client-side local-first execution
  const [engine, setEngine] = useState<ExecutionEngine>("browser");

  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState<boolean>(false);
  const [progress, setProgress] = useState<ProgressPayload | null>(null);
  const [uploadResult, setUploadResult] = useState<DatasetUploadResponse | null>(null);
  const [previewData, setPreviewData] = useState<DatasetPreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // SQL & Transformation Execution state
  const [predicate, setPredicate] = useState<string>("amount > 10.0");
  const [customSql, setCustomSql] = useState<string>("");
  const [useRawSql, setUseRawSql] = useState<boolean>(false);
  const [runningPipeline, setRunningPipeline] = useState<boolean>(false);
  const [pipelineOutcome, setPipelineOutcome] = useState<any | null>(null);
  const [queryResultTable, setQueryResultTable] = useState<QueryResult | null>(null);

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
      setQueryResultTable(null);
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
      setQueryResultTable(null);
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
          dataset_id: metadata.datasetId,
          filename: file.name,
          row_count: metadata.rowCount,
          column_count: metadata.columnCount,
          byte_size: metadata.byteSize,
          sha256_hash: metadata.sha256Hash,
          columns: mappedColumns,
        };

        const unifiedPreviewData: DatasetPreviewResponse = {
          dataset_id: metadata.datasetId,
          filename: file.name,
          row_count: metadata.rowCount,
          column_count: metadata.columnCount,
          columns: mappedColumns,
          sample_rows: previewResult.rows,
        };

        setUploadResult(unifiedUploadResult);
        setPreviewData(unifiedPreviewData);
        setCustomSql(`SELECT * FROM "${sanitizedTableName}" WHERE amount > 10.0;`);
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
        setCustomSql(`SELECT * FROM "${res.dataset_id}" WHERE ${predicate};`);
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

  const handleExecuteQuery = async () => {
    if (!uploadResult) return;

    try {
      setRunningPipeline(true);
      setError(null);
      setQueryResultTable(null);

      if (engine === "browser") {
        const runtime = runtimeRef.current;
        const sql = useRawSql
          ? customSql
          : `SELECT * FROM "${uploadResult.dataset_id}" WHERE ${predicate};`;

        const startTime = performance.now();
        const res = await runtime.executeQuery(sql);
        const duration = Math.round(performance.now() - startTime);

        setQueryResultTable(res);
        setPipelineOutcome({
          status: "SUCCESS",
          duration_ms: duration,
          step_results: {
            user_filter: {
              row_count: res.rowCount,
              column_count: res.columns.length,
            },
          },
        });
      } else {
        // Backend pipeline execution
        const outcome = await api.executePipeline(
          [
            {
              step_id: "user_filter",
              operation_type: "filter_rows",
              input_step_ids: ["source_csv"],
              parameters: { predicate },
            },
          ],
          {},
          { source_csv: uploadResult.dataset_id }
        );
        setPipelineOutcome(outcome);
      }
    } catch (err: any) {
      if (err instanceof RuntimeError) {
        setError(`${err.code}: ${err.message}`);
      } else if (err instanceof ApiClientError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError(err?.message || "Query execution failed.");
      }
    } finally {
      setRunningPipeline(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col gap-8 font-sans">
      {/* Header Banner */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="max-w-3xl flex flex-col gap-2">
          <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-emerald-400">
            <FileSpreadsheet className="w-4 h-4" /> CSV Ingestion & Schema Inspector
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-100 sm:text-3xl">
            Ingest Raw CSV & Inspect Schemas
          </h1>
          <p className="text-sm text-zinc-400 leading-relaxed">
            Upload RFC 4180 CSV datasets. Ingest client-side with <strong className="text-zinc-200">DuckDB-Wasm</strong> or route to the local Python engine.
            Infers column types, validates RFC 4180 constraints, and enforces deterministic SHA-256 hashes.
          </p>
        </div>

        {/* Engine Switcher */}
        <div className="flex flex-col gap-2 bg-zinc-950 p-3 rounded-lg border border-zinc-800 self-start md:self-auto min-w-[260px]">
          <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-emerald-400" /> Execution Engine
          </span>
          <div className="grid grid-cols-2 gap-1.5 p-1 bg-zinc-900 rounded border border-zinc-800/80 text-xs font-mono">
            <button
              type="button"
              onClick={() => setEngine("browser")}
              className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded font-medium transition-colors ${
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
              className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded font-medium transition-colors ${
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
        <div className="bg-rose-950/80 border border-rose-800 rounded-lg p-4 text-xs font-mono text-rose-200 flex items-start justify-between gap-3">
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
        className="bg-zinc-900/60 border-2 border-dashed border-zinc-700/80 hover:border-emerald-500 rounded-xl p-8 flex flex-col items-center justify-center gap-4 text-center transition-colors cursor-pointer"
      >
        <div className="h-12 w-12 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-emerald-400">
          <FileUp className="w-6 h-6" />
        </div>
        <div>
          <p className="text-sm font-semibold text-zinc-200">
            {file ? file.name : "Drag & drop a CSV file here, or click to browse"}
          </p>
          <p className="text-xs text-zinc-500 mt-1 font-mono">
            {file ? `${(file.size / 1_000_000).toFixed(2)} MB` : "RFC 4180 compliant CSV files supported"}
          </p>
        </div>

        {/* Guardrail Badges */}
        <div className="flex flex-wrap items-center justify-center gap-2 text-[11px] font-mono text-zinc-400 pt-2">
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
            className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-mono font-medium cursor-pointer border border-zinc-700"
          >
            Choose File
          </label>
          <button
            onClick={handleUpload}
            disabled={!file || uploading}
            className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-zinc-950 font-bold text-xs font-mono disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
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

      {/* Dataset Metadata and Inferred Schema */}
      {uploadResult && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 flex flex-col gap-6 shadow-xl">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
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
            <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-800">
              <span className="text-zinc-500 block mb-1">Rows Parsed</span>
              <TabularNum value={uploadResult.row_count} className="text-lg text-emerald-400 font-bold" />
            </div>
            <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-800">
              <span className="text-zinc-500 block mb-1">Columns Inferred</span>
              <TabularNum value={uploadResult.column_count} className="text-lg text-zinc-200 font-bold" />
            </div>
            <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-800">
              <span className="text-zinc-500 block mb-1">Preserved Size</span>
              <TabularNum value={uploadResult.byte_size} format="bytes" className="text-lg text-zinc-200 font-bold" />
            </div>
            <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-800">
              <span className="text-zinc-500 block mb-1">Dataset ID</span>
              <span className="text-xs text-zinc-400 truncate block">{uploadResult.dataset_id}</span>
            </div>
          </div>

          {/* Schema Columns Grid */}
          <div className="flex flex-col gap-2">
            <span className="text-xs font-mono font-semibold uppercase tracking-wider text-zinc-400">
              Inferred Column Types ({engine === "browser" ? "DuckDB-Wasm Catalog" : "FastAPI Native"})
            </span>
            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2 text-xs font-mono">
              {uploadResult.columns.map((col) => (
                <div
                  key={col.name}
                  className="bg-zinc-950 p-2 rounded border border-zinc-800 flex flex-col justify-between"
                >
                  <span className="font-bold text-zinc-200 truncate" title={col.name}>
                    {col.name}
                  </span>
                  <span className="text-[10px] text-emerald-400 mt-1 uppercase">{col.data_type}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Sample Rows Preview Table */}
          {previewData && previewData.sample_rows.length > 0 && (
            <div className="flex flex-col gap-2 pt-4 border-t border-zinc-800">
              <span className="text-xs font-mono font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                <Table className="w-3.5 h-3.5" /> First 50 Rows Preview
              </span>
              <div className="overflow-auto max-h-64 rounded border border-zinc-800">
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

          {/* Transformation Step / SQL Query Runner */}
          <div className="flex flex-col gap-3 pt-4 border-t border-zinc-800">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono font-semibold uppercase tracking-wider text-zinc-400">
                {useRawSql ? "Execute SQL Query" : "Test Transformation Pipeline Step (filter_rows)"}
              </span>
              {engine === "browser" && (
                <button
                  type="button"
                  onClick={() => setUseRawSql(!useRawSql)}
                  className="text-xs font-mono text-emerald-400 hover:text-emerald-300 underline"
                >
                  {useRawSql ? "Switch to Simple Predicate" : "Switch to Raw SQL"}
                </button>
              )}
            </div>

            <div className="flex flex-col sm:flex-row items-center gap-3">
              {useRawSql ? (
                <input
                  type="text"
                  value={customSql}
                  onChange={(e) => setCustomSql(e.target.value)}
                  placeholder={`SELECT * FROM "${uploadResult.dataset_id}" WHERE amount > 10.0;`}
                  className="flex-1 bg-zinc-950 border border-zinc-800 text-xs text-zinc-200 px-3 py-2 rounded font-mono focus:outline-none focus:border-emerald-600 w-full"
                />
              ) : (
                <input
                  type="text"
                  value={predicate}
                  onChange={(e) => setPredicate(e.target.value)}
                  placeholder="Predicate, e.g. amount > 10.0 and category == 'Software'"
                  className="flex-1 bg-zinc-950 border border-zinc-800 text-xs text-zinc-200 px-3 py-2 rounded font-mono focus:outline-none focus:border-emerald-600 w-full"
                />
              )}
              <button
                onClick={handleExecuteQuery}
                disabled={runningPipeline}
                className="px-4 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-mono text-xs font-bold border border-zinc-700 flex items-center gap-1.5 whitespace-nowrap"
              >
                <Play className="w-3.5 h-3.5 fill-current text-emerald-400" />
                {runningPipeline ? "Executing..." : useRawSql ? "Run SQL" : "Run Step"}
              </button>
            </div>

            {/* Pipeline Outcome Banner */}
            {pipelineOutcome && (
              <div className="bg-zinc-950 p-3 rounded border border-zinc-800 text-xs font-mono text-zinc-300 flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Clock className="w-3.5 h-3.5 text-zinc-400" />
                  Execution: <strong className="text-emerald-400">{pipelineOutcome.status}</strong> in{" "}
                  <TabularNum value={pipelineOutcome.duration_ms} /> ms
                </span>
                <span>
                  Result Rows:{" "}
                  <TabularNum
                    value={pipelineOutcome.step_results?.user_filter?.row_count}
                    className="text-emerald-400 font-bold"
                  />
                </span>
              </div>
            )}

            {/* Query Result Grid (Browser mode) */}
            {queryResultTable && queryResultTable.rows.length > 0 && (
              <div className="overflow-auto max-h-56 rounded border border-zinc-800 mt-2">
                <table className="w-full text-left text-xs border-collapse font-mono">
                  <thead className="sticky top-0 bg-zinc-950 text-zinc-400 border-b border-zinc-800">
                    <tr>
                      {queryResultTable.columns.map((c) => (
                        <th key={c} className="py-2 px-3 font-semibold text-zinc-300">
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/60 bg-zinc-900/50">
                    {queryResultTable.rows.slice(0, 50).map((row: any, idx) => (
                      <tr key={idx} className="hover:bg-zinc-800/40">
                        {queryResultTable.columns.map((c) => (
                          <td key={c} className="py-1.5 px-3 whitespace-nowrap text-zinc-300">
                            {row[c] === null ? <span className="text-zinc-600">NULL</span> : String(row[c])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
