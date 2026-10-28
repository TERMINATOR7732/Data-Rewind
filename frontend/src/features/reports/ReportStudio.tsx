import React, { useEffect, useState } from "react";
import {
  Download,
  FileSpreadsheet,
  FileText,
  FileJson,
} from "lucide-react";
import { api, ApiClientError } from "../../lib/api";
import { ForensicDossier } from "../../types/api";
import { StatusBadge } from "../../components/StatusBadge";

interface ReportStudioProps {
  initialDossierId?: string | null;
}

export const ReportStudio: React.FC<ReportStudioProps> = ({ initialDossierId }) => {
  const [dossierId, setDossierId] = useState<string>(initialDossierId || "");
  const [dossier, setDossier] = useState<ForensicDossier | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [exporting, setExporting] = useState<boolean>(false);
  const [format, setFormat] = useState<"markdown" | "json" | "safe_csv" | "raw_csv">("markdown");
  const [stepId, setStepId] = useState<string>("");
  const [previewContent, setPreviewContent] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialDossierId) {
      setDossierId(initialDossierId);
      loadDossier(initialDossierId);
    }
  }, [initialDossierId]);

  const loadDossier = async (id: string) => {
    if (!id) return;
    try {
      setLoading(true);
      setError(null);
      const data = await api.getDossier(id);
      setDossier(data);
      if (data.verification.dual_axis.baseline_axis?.step_comparisons) {
        const steps = Object.keys(data.verification.dual_axis.baseline_axis.step_comparisons);
        if (steps.length > 0) setStepId(steps[0]);
      }
      setPreviewContent(JSON.stringify(data, null, 2));
    } catch (err: any) {
      setError(err instanceof ApiClientError ? `${err.code}: ${err.message}` : "Failed to load dossier.");
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async () => {
    if (!dossier) return;
    try {
      setExporting(true);
      setError(null);
      await api.exportReport(dossier.metadata.dossier_id, format, stepId || undefined);
    } catch (err: any) {
      setError(err instanceof ApiClientError ? err.message : "Export failed.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col gap-8 font-sans">
      {/* Top Banner */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 shadow-xl">
        <div className="max-w-3xl flex flex-col gap-2">
          <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-emerald-400">
            <FileText className="w-4 h-4" /> Forensic Report Studio (SPEC-MOD-05 §2)
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-100 sm:text-3xl">
            Export Signed Forensic Dossiers
          </h1>
          <p className="text-sm text-zinc-400 leading-relaxed">
            Download audit-ready dossiers in JSON, Markdown, Spreadsheet-Safe CSV (with type-aware formula injection defense), or raw CSV.
            All reports include cryptographic fingerprints and evidence segregation.
          </p>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="bg-rose-950/80 border border-rose-800 rounded-lg p-3 text-xs font-mono text-rose-200 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="font-bold text-rose-400 hover:text-rose-200">
            Dismiss
          </button>
        </div>
      )}

      {/* Lookup input if no dossier selected */}
      {!dossier && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 flex flex-col gap-4">
          <label className="text-xs font-mono text-zinc-300 font-semibold uppercase">
            Lookup Dossier by UUID
          </label>
          <div className="flex flex-col sm:flex-row items-center gap-3">
            <input
              type="text"
              value={dossierId}
              onChange={(e) => setDossierId(e.target.value)}
              placeholder="Enter Dossier or Verification UUID..."
              className="flex-1 bg-zinc-950 border border-zinc-800 text-xs text-zinc-200 px-3 py-2 rounded font-mono focus:outline-none focus:border-emerald-600 w-full"
            />
            <button
              onClick={() => loadDossier(dossierId)}
              disabled={!dossierId || loading}
              className="px-5 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-mono text-xs font-bold border border-zinc-700 disabled:opacity-50"
            >
              {loading ? "Loading..." : "Load Dossier"}
            </button>
          </div>
        </div>
      )}

      {dossier && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Export Controls (Left Column) */}
          <div className="flex flex-col gap-6 bg-zinc-900 border border-zinc-800 rounded-xl p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <span className="font-mono text-xs text-zinc-400 font-bold uppercase">Configure Export</span>
              <StatusBadge status={dossier.verification.verdict} size="sm" />
            </div>

            <div className="flex flex-col gap-4">
              {/* Format selection */}
              <div className="flex flex-col gap-2">
                <span className="text-xs font-mono text-zinc-400">Export Format:</span>
                <div className="grid grid-cols-1 gap-2">
                  <label className="flex items-center gap-2 p-2.5 rounded bg-zinc-950 border border-zinc-800 cursor-pointer text-xs font-mono text-zinc-200 hover:border-zinc-700">
                    <input
                      type="radio"
                      name="report-format"
                      value="markdown"
                      checked={format === "markdown"}
                      onChange={() => setFormat("markdown")}
                      className="accent-emerald-500"
                    />
                    <FileText className="w-4 h-4 text-emerald-400" />
                    <span>Markdown Dossier (.md)</span>
                  </label>
                  <label className="flex items-center gap-2 p-2.5 rounded bg-zinc-950 border border-zinc-800 cursor-pointer text-xs font-mono text-zinc-200 hover:border-zinc-700">
                    <input
                      type="radio"
                      name="report-format"
                      value="json"
                      checked={format === "json"}
                      onChange={() => setFormat("json")}
                      className="accent-emerald-500"
                    />
                    <FileJson className="w-4 h-4 text-sky-400" />
                    <span>Machine JSON (.json)</span>
                  </label>
                  <label className="flex items-center gap-2 p-2.5 rounded bg-zinc-950 border border-zinc-800 cursor-pointer text-xs font-mono text-zinc-200 hover:border-zinc-700">
                    <input
                      type="radio"
                      name="report-format"
                      value="safe_csv"
                      checked={format === "safe_csv"}
                      onChange={() => setFormat("safe_csv")}
                      className="accent-emerald-500"
                    />
                    <FileSpreadsheet className="w-4 h-4 text-amber-400" />
                    <span>Spreadsheet-Safe CSV (.csv)</span>
                  </label>
                  <label className="flex items-center gap-2 p-2.5 rounded bg-zinc-950 border border-zinc-800 cursor-pointer text-xs font-mono text-zinc-200 hover:border-zinc-700">
                    <input
                      type="radio"
                      name="report-format"
                      value="raw_csv"
                      checked={format === "raw_csv"}
                      onChange={() => setFormat("raw_csv")}
                      className="accent-emerald-500"
                    />
                    <FileSpreadsheet className="w-4 h-4 text-zinc-400" />
                    <span>Raw Bit-for-Bit CSV (.csv)</span>
                  </label>
                </div>
              </div>

              {/* Step diff selection for CSV */}
              {(format === "safe_csv" || format === "raw_csv") && (
                <div className="flex flex-col gap-1.5 pt-2 border-t border-zinc-800">
                  <span className="text-xs font-mono text-zinc-400">Target Pipeline Step:</span>
                  <select
                    value={stepId}
                    onChange={(e) => setStepId(e.target.value)}
                    className="bg-zinc-950 border border-zinc-800 text-xs text-zinc-200 px-3 py-2 rounded font-mono focus:outline-none focus:border-emerald-600"
                  >
                    {Object.keys(
                      dossier.verification.dual_axis.baseline_axis?.step_comparisons || {}
                    ).map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Formula injection disclaimer */}
              {format === "safe_csv" && (
                <div className="p-3 bg-amber-950/40 border border-amber-800/80 rounded text-[11px] font-mono text-amber-300">
                  <span className="font-bold block mb-0.5">Type-Aware Protection:</span>
                  Numeric values preserved without escaping. Non-numeric formula triggers (=, +, -, @) prefixed with apostrophe.
                </div>
              )}

              {/* Download Action */}
              <button
                onClick={handleDownload}
                disabled={exporting}
                className="w-full mt-2 py-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-zinc-950 font-bold font-mono text-xs flex items-center justify-center gap-2 shadow-md disabled:opacity-50"
              >
                {exporting ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-zinc-950 border-t-transparent rounded-full animate-spin" />
                    Generating Report...
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    Download Signed Dossier
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Dossier Telemetry & Live Preview (Right Column, Span 2) */}
          <div className="lg:col-span-2 flex flex-col gap-4 bg-zinc-900 border border-zinc-800 rounded-xl p-6 shadow-xl font-mono text-xs">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <span className="font-semibold text-zinc-200">Dossier Structure & Integrity Signatures</span>
              <span className="text-zinc-500">ID: {dossier.metadata.dossier_id}</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="bg-zinc-950 p-3 rounded border border-zinc-800">
                <span className="text-zinc-500 block mb-1">Pipeline Name</span>
                <span className="text-zinc-200 font-bold">{dossier.metadata.pipeline_name}</span>
              </div>
              <div className="bg-zinc-950 p-3 rounded border border-zinc-800">
                <span className="text-zinc-500 block mb-1">Created At</span>
                <span className="text-zinc-200">
                  {new Date(dossier.metadata.created_at).toLocaleString()}
                </span>
              </div>
            </div>

            {/* In-Browser JSON Preview */}
            <div className="flex flex-col gap-1.5 pt-2">
              <span className="text-zinc-400 font-semibold uppercase text-[11px]">
                Payload Inspection (Read-Only Preview)
              </span>
              <pre className="bg-zinc-950 border border-zinc-800 rounded p-4 text-[11px] text-zinc-300 overflow-auto max-h-96 leading-relaxed select-all">
                {previewContent}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
