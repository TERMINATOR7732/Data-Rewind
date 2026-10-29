import React, { useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  FileSpreadsheet,
  FileUp,
  Play,
  Table,
  Upload,
} from "lucide-react";
import { api, ApiClientError } from "../../lib/api";
import { DatasetPreviewResponse, DatasetUploadResponse } from "../../types/api";
import { TabularNum } from "../../components/TabularNum";

interface CSVInvestigationProps {
  onDatasetReady?: (datasetId: string) => void;
  isHostedDemo?: boolean;
}

export const CSVInvestigation: React.FC<CSVInvestigationProps> = ({
  onDatasetReady,
  isHostedDemo = false,
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState<boolean>(false);
  const [uploadResult, setUploadResult] = useState<DatasetUploadResponse | null>(null);
  const [previewData, setPreviewData] = useState<DatasetPreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Pipeline Execution state
  const [predicate, setPredicate] = useState<string>("amount > 10.0");
  const [runningPipeline, setRunningPipeline] = useState<boolean>(false);
  const [pipelineOutcome, setPipelineOutcome] = useState<any | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setError(null);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setFile(e.dataTransfer.files[0]);
      setError(null);
    }
  };

  const handleUpload = async () => {
    if (!file) return;

    // Frontend pre-flight check
    if (file.size > 50_000_000) {
      setError("File exceeds the 50 MB local ingestion limit.");
      return;
    }

    try {
      setUploading(true);
      setError(null);
      const res = await api.uploadDataset(file);
      setUploadResult(res);
      if (onDatasetReady) onDatasetReady(res.dataset_id);

      // Load preview
      const prev = await api.previewDataset(res.dataset_id);
      setPreviewData(prev);
    } catch (err: any) {
      setError(err instanceof ApiClientError ? `${err.code}: ${err.message}` : "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  const handleExecuteFilter = async () => {
    if (!uploadResult) return;
    try {
      setRunningPipeline(true);
      setError(null);
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
    } catch (err: any) {
      setError(err instanceof ApiClientError ? `${err.code}: ${err.message}` : "Pipeline execution failed.");
    } finally {
      setRunningPipeline(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col gap-8 font-sans">
      {/* Header Banner */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 shadow-xl">
        <div className="max-w-3xl flex flex-col gap-2">
          <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-emerald-400">
            <FileSpreadsheet className="w-4 h-4" /> CSV Ingestion & Schema Inspector
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-100 sm:text-3xl">
            Ingest Raw CSV & Inspect Schemas
          </h1>
          <p className="text-sm text-zinc-400 leading-relaxed">
            Upload local CSV datasets. Bytes are preserved in <code className="text-zinc-200">raw_inputs/{`{sha256}`}.csv</code> with read-only permissions.
            DuckDB automatically infers column types and verifies limits.
          </p>
        </div>
      </div>

      {/* Hosted Demo Policy Banner */}
      {isHostedDemo && (
        <div className="bg-amber-950/60 border border-amber-800/80 rounded-xl p-4 text-xs font-mono text-amber-200 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold text-amber-100">Hosted Demonstration Environment Notice</p>
            <p className="text-amber-300/90 leading-relaxed font-sans text-xs">
              Custom CSV uploads are disabled in this public demonstration environment.
              To ingest custom datasets and evaluate live schema inspection, run the local Data Rewind desktop engine, or explore the 4 pre-loaded deterministic scenarios in the <strong>Demo Sandbox</strong>.
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
              <span className="text-zinc-500 block mb-1">Dataset UUID</span>
              <span className="text-xs text-zinc-400 truncate block">{uploadResult.dataset_id}</span>
            </div>
          </div>

          {/* Schema Columns Grid */}
          <div className="flex flex-col gap-2">
            <span className="text-xs font-mono font-semibold uppercase tracking-wider text-zinc-400">
              Inferred Column Types (DuckDB Catalog)
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

          {/* Transformation Step Runner */}
          <div className="flex flex-col gap-3 pt-4 border-t border-zinc-800">
            <span className="text-xs font-mono font-semibold uppercase tracking-wider text-zinc-400">
              Test Transformation Pipeline Step (filter_rows)
            </span>
            <div className="flex flex-col sm:flex-row items-center gap-3">
              <input
                type="text"
                value={predicate}
                onChange={(e) => setPredicate(e.target.value)}
                placeholder="Predicate, e.g. amount > 10.0 and category == 'Software'"
                className="flex-1 bg-zinc-950 border border-zinc-800 text-xs text-zinc-200 px-3 py-2 rounded font-mono focus:outline-none focus:border-emerald-600 w-full"
              />
              <button
                onClick={handleExecuteFilter}
                disabled={runningPipeline}
                className="px-4 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-mono text-xs font-bold border border-zinc-700 flex items-center gap-1.5 whitespace-nowrap"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                {runningPipeline ? "Executing..." : "Run Step"}
              </button>
            </div>

            {pipelineOutcome && (
              <div className="bg-zinc-950 p-3 rounded border border-zinc-800 text-xs font-mono text-zinc-300 flex items-center justify-between">
                <span>
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
          </div>
        </div>
      )}
    </div>
  );
};
