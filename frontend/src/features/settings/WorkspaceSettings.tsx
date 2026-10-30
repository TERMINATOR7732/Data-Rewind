import React, { useEffect, useState } from "react";
import {
  AlertCircle,
  Archive,
  CheckCircle2,
  Download,
  HardDrive,
  RefreshCw,
  ShieldAlert,
  Trash2,
  Upload,
} from "lucide-react";
import { api, ApiClientError } from "../../lib/api";
import { WorkspaceInfo, WorkspacePurgeResponse } from "../../types/api";
import { TabularNum } from "../../components/TabularNum";
import { storageManager } from "../../runtime/storage/storage-manager";
import { ArchiveService } from "../../runtime/archive/archive-service";
import { indexedDBStorage } from "../../runtime/storage/indexeddb";

export const WorkspaceSettings: React.FC = () => {
  const [workspaceInfo, setWorkspaceInfo] = useState<WorkspaceInfo | null>(null);
  const [purging, setPurging] = useState<boolean>(false);
  const [showConfirm, setShowConfirm] = useState<boolean>(false);
  const [purgeResult, setPurgeResult] = useState<WorkspacePurgeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Portable Archive (.drz) state
  const [availableInvestigations, setAvailableInvestigations] = useState<{ id: string; title: string }[]>([]);
  const [selectedExportInvId, setSelectedExportInvId] = useState<string>("");
  const [archiveStatus, setArchiveStatus] = useState<string | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [importingArchive, setImportingArchive] = useState<boolean>(false);
  const [exportingArchive, setExportingArchive] = useState<boolean>(false);

  useEffect(() => {
    loadInfo();
  }, []);

  const loadInfo = async () => {
    try {
      setError(null);
      const data = await api.getWorkspaceInfo();
      setWorkspaceInfo(data);
    } catch {
      // Fallback to browser runtime storage telemetry
      try {
        const telemetry = await storageManager.getTelemetry("default");
        setWorkspaceInfo({
          workspace_path: "Browser OPFS & IndexedDB Sandbox",
          total_storage_bytes: telemetry.totalDiskBytes,
          total_storage_mb: +(telemetry.totalDiskBytes / (1024 * 1024)).toFixed(2),
          file_count: telemetry.totalArtifacts,
          investigations_db_bytes: 0,
          verifications_db_bytes: 0,
        });
      } catch {
        setError("Failed to load workspace storage telemetry.");
      }
    }

    // Load available investigations for archive export
    try {
      const invList = await indexedDBStorage.listInvestigations();
      const mapped = invList.map((inv) => ({
        id: inv.investigationId,
        title: inv.title || inv.investigationId,
      }));
      setAvailableInvestigations(mapped);
      if (mapped.length > 0 && !selectedExportInvId) {
        setSelectedExportInvId(mapped[0].id);
      }
    } catch (e) {
      console.warn("Could not list investigations for archive export:", e);
    }
  };

  const handleExportArchive = async () => {
    if (!selectedExportInvId) {
      setArchiveError("Select an investigation to export.");
      return;
    }
    try {
      setExportingArchive(true);
      setArchiveError(null);
      setArchiveStatus("Packaging portable investigation archive bundle...");

      const archiveService = new ArchiveService();
      const bundle = await archiveService.exportArchive(selectedExportInvId);

      const jsonStr = JSON.stringify(bundle, null, 2);
      const blob = new Blob([jsonStr], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `investigation_${selectedExportInvId.slice(0, 12)}.drz`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setArchiveStatus(`Investigation archive '${bundle.investigation.investigationId}' exported successfully.`);
      setTimeout(() => setArchiveStatus(null), 5000);
    } catch (err: any) {
      setArchiveError(err?.message || "Failed to export archive.");
    } finally {
      setExportingArchive(false);
    }
  };

  const handleImportArchive = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      try {
        setImportingArchive(true);
        setArchiveError(null);
        setArchiveStatus(`Validating and importing archive '${file.name}'...`);

        const reader = new FileReader();
        reader.onload = async (event) => {
          try {
            const content = event.target?.result as string;
            const bundle = JSON.parse(content);

            const archiveService = new ArchiveService();
            const result = await archiveService.importArchive(bundle, {
              conflictStrategy: "RENAME_ON_CONFLICT",
            });

            setArchiveStatus(
              `Archive imported successfully: ${result.importedArtifactsCount} artifact(s) restored for investigation '${result.investigationId}'.`
            );
            await loadInfo();
            setTimeout(() => setArchiveStatus(null), 6000);
          } catch (importErr: any) {
            setArchiveError(`Archive import failed: ${importErr.message}`);
          } finally {
            setImportingArchive(false);
          }
        };
        reader.readAsText(file);
      } catch (err: any) {
        setArchiveError(err?.message || "Failed to read archive file.");
        setImportingArchive(false);
      }
    }
  };

  const handleGarbageCollect = async () => {
    try {
      setPurging(true);
      setError(null);
      const result = await storageManager.collectGarbage();
      setPurgeResult({
        purged_bytes: result.collectedBytes,
        unlinked_files_count: result.collectedArtifactIds.length,
        vacuum_completed: true,
        message: `Reference-aware Garbage Collection freed ${result.collectedArtifactIds.length} unreferenced artifact(s). Retained ${result.retainedArtifactIds.length} artifact(s).`,
      });
      await loadInfo();
    } catch (err: any) {
      setError(err?.message || "Garbage collection failed.");
    } finally {
      setPurging(false);
    }
  };

  const handlePurge = async () => {
    try {
      setPurging(true);
      setError(null);
      const res = await api.purgeWorkspace();
      setPurgeResult(res);
      setShowConfirm(false);
      await loadInfo();
    } catch (err: any) {
      setError(err instanceof ApiClientError ? `${err.code}: ${err.message}` : "Purge operation failed.");
    } finally {
      setPurging(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col gap-8 font-sans">
      {/* Top Banner */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 shadow-xl">
        <div className="max-w-3xl flex flex-col gap-2">
          <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-emerald-400">
            <HardDrive className="w-4 h-4" /> Local Storage & Workspace Retention
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-100 sm:text-3xl">
            Workspace Storage & Data Privacy
          </h1>
          <p className="text-sm text-zinc-400 leading-relaxed">
            Data Rewind operates with 100% local persistence. Checkpoint files, raw inputs, and SQLite database
            catalogs reside exclusively on your host workstation. Manage local disk usage or perform application-managed purges.
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

      {/* Purge Success Banner */}
      {purgeResult && (
        <div className="bg-emerald-950/80 border border-emerald-800 rounded-lg p-4 text-xs font-mono text-emerald-200 flex items-start gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
          <div className="flex flex-col gap-1">
            <span className="font-bold text-emerald-100">{purgeResult.message}</span>
            <span className="text-zinc-300">
              Unlinked <TabularNum value={purgeResult.unlinked_files_count} /> files (
              <TabularNum value={purgeResult.purged_bytes} format="bytes" /> freed). SQLite VACUUM complete.
            </span>
          </div>
        </div>
      )}

      {/* Storage Gauges Grid */}
      {workspaceInfo && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 shadow-lg font-mono">
            <span className="text-xs text-zinc-400 block mb-1">Total Workspace Disk</span>
            <div className="text-2xl font-bold text-zinc-100">
              <TabularNum value={workspaceInfo.total_storage_mb} format="decimal" /> MB
            </div>
            <span className="text-[11px] text-zinc-500 mt-1 block">
              <TabularNum value={workspaceInfo.total_storage_bytes} format="bytes" />
            </span>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 shadow-lg font-mono">
            <span className="text-xs text-zinc-400 block mb-1">Retained Files</span>
            <div className="text-2xl font-bold text-zinc-100">
              <TabularNum value={workspaceInfo.file_count} />
            </div>
            <span className="text-[11px] text-zinc-500 mt-1 block">CSVs, Parquets, Checkpoints</span>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 shadow-lg font-mono">
            <span className="text-xs text-zinc-400 block mb-1">Investigations Catalog</span>
            <div className="text-2xl font-bold text-zinc-100">
              <TabularNum value={workspaceInfo.investigations_db_bytes} format="bytes" />
            </div>
            <span className="text-[11px] text-zinc-500 mt-1 block">SQLite 3 (WAL Mode)</span>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 shadow-lg font-mono">
            <span className="text-xs text-zinc-400 block mb-1">Verifications Catalog</span>
            <div className="text-2xl font-bold text-zinc-100">
              <TabularNum value={workspaceInfo.verifications_db_bytes} format="bytes" />
            </div>
            <span className="text-[11px] text-zinc-500 mt-1 block">SQLite 3 (WAL Mode)</span>
          </div>
        </div>
      )}

      {/* Workspace Directory Location */}
      {workspaceInfo && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 font-mono text-xs flex flex-col gap-2">
          <span className="text-zinc-500 font-semibold uppercase">Local Storage Directory Root</span>
          <code className="text-emerald-400 select-all p-2 rounded bg-zinc-950 border border-zinc-800">
            {workspaceInfo.workspace_path}
          </code>
        </div>
      )}

      {/* Maintenance Zone: Reference-Aware Garbage Collection */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 shadow-xl flex flex-col sm:flex-row items-center justify-between gap-4">
        <div>
          <h4 className="font-semibold text-zinc-100 font-mono text-sm flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-emerald-400" /> Reference-Aware Garbage Collection
          </h4>
          <p className="text-xs text-zinc-400 mt-1">
            Safely discovers and removes orphaned or unreferenced artifacts from local storage while strictly preserving all artifacts tied to retained runs, datasets, and investigations.
          </p>
        </div>
        <button
          onClick={handleGarbageCollect}
          disabled={purging}
          className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-mono text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap disabled:opacity-50 border border-zinc-700"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${purging ? "animate-spin text-emerald-400" : ""}`} />
          Run Garbage Collection
        </button>
      </div>

      {/* Archive Zone: Portable Investigation Archives (.drz) */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 shadow-xl flex flex-col gap-5">
        <div className="flex items-center justify-between border-b border-zinc-800 pb-3 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Archive className="w-4 h-4 text-emerald-400" />
            <h4 className="font-semibold text-zinc-100 font-mono text-sm">
              Portable Investigation Archives (.drz)
            </h4>
          </div>
          <span className="text-xs text-zinc-400 font-mono">SPEC-MOD-04 §3 Spec</span>
        </div>

        <p className="text-xs text-zinc-400 leading-relaxed font-sans">
          Export fully self-contained investigation dossiers with manifests, cell-level diffs, and intermediate verification evidence.
          Import verified archives from peers with staged checksum and path-traversal validation.
        </p>

        {archiveStatus && (
          <div className="p-3 bg-emerald-950/80 border border-emerald-800 rounded-lg text-xs font-mono text-emerald-200 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
            <span>{archiveStatus}</span>
          </div>
        )}

        {archiveError && (
          <div className="p-3 bg-rose-950/80 border border-rose-800 rounded-lg text-xs font-mono text-rose-200 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
              <span>{archiveError}</span>
            </div>
            <button
              onClick={() => setArchiveError(null)}
              className="text-rose-400 hover:text-rose-200 font-bold"
            >
              Dismiss
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
          {/* Export Archive */}
          <div className="bg-zinc-950 p-4 rounded-xl border border-zinc-800 flex flex-col gap-3">
            <span className="text-xs font-mono font-bold text-zinc-200">Export Investigation Archive</span>
            <div className="flex flex-col gap-2">
              <label className="text-[11px] text-zinc-400 font-mono">Select Investigation:</label>
              {availableInvestigations.length > 0 ? (
                <select
                  value={selectedExportInvId}
                  onChange={(e) => setSelectedExportInvId(e.target.value)}
                  className="bg-zinc-900 border border-zinc-800 text-xs text-zinc-200 p-2 rounded-lg font-mono focus:border-emerald-500 truncate"
                >
                  {availableInvestigations.map((inv) => (
                    <option key={inv.id} value={inv.id}>
                      {inv.title} ({inv.id.slice(0, 8)})
                    </option>
                  ))}
                </select>
              ) : (
                <div className="text-xs text-zinc-500 font-mono italic p-2 bg-zinc-900 rounded border border-zinc-850">
                  No saved investigations found in workspace.
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={handleExportArchive}
              disabled={exportingArchive || availableInvestigations.length === 0}
              className="mt-1 px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-750 text-zinc-100 font-mono text-xs font-semibold flex items-center justify-center gap-2 border border-zinc-700 disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5 text-emerald-400" />
              <span>{exportingArchive ? "Packaging Archive..." : "Export .drz Bundle"}</span>
            </button>
          </div>

          {/* Import Archive */}
          <div className="bg-zinc-950 p-4 rounded-xl border border-zinc-800 flex flex-col gap-3">
            <span className="text-xs font-mono font-bold text-zinc-200">Import Investigation Archive</span>
            <p className="text-[11px] text-zinc-400 font-sans leading-relaxed">
              Upload a portable <code className="text-zinc-300">.drz</code> archive. Validates cryptographic checksums, DAG invariants, and isolates files against directory traversal.
            </p>

            <label className="mt-auto px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-750 text-zinc-100 font-mono text-xs font-semibold flex items-center justify-center gap-2 border border-zinc-700 cursor-pointer">
              <Upload className="w-3.5 h-3.5 text-emerald-400" />
              <span>{importingArchive ? "Validating..." : "Choose .drz File to Import"}</span>
              <input
                type="file"
                accept=".drz,.json"
                onChange={handleImportArchive}
                disabled={importingArchive}
                className="hidden"
              />
            </label>
          </div>
        </div>
      </div>

      {/* Danger Zone: Application-Managed Purge */}
      <div className="bg-zinc-900 border border-rose-900/60 rounded-xl p-6 shadow-xl flex flex-col gap-5">
        <div className="flex items-center gap-2 border-b border-rose-950 pb-3">
          <Trash2 className="w-4 h-4 text-rose-400" />
          <h3 className="text-sm font-semibold text-rose-200 font-mono uppercase tracking-wider">
            Danger Zone: Purge Workspace Data
          </h3>
        </div>

        <p className="text-xs text-zinc-300 leading-relaxed font-sans">
          This operation permanently deletes all preserved raw input CSV files, intermediate Parquet checkpoints,
          persisted investigation diffs, and tri-run fix verification records, executing a full SQLite{" "}
          <code className="font-mono text-zinc-100">VACUUM</code>.
        </p>

        {/* Mandatory Forensic Disclaimer (SPEC-MOD-06 §3) */}
        <div className="p-3.5 bg-zinc-950 border border-zinc-800 rounded-lg text-[11px] font-mono text-zinc-400 flex items-start gap-2.5">
          <ShieldAlert className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
          <div>
            <strong className="text-zinc-300">Forensic Sanitization Disclaimer (SPEC-MOD-06 §3):</strong>
            <p className="mt-1 leading-relaxed">
              The application executes operating-system file unlinking (<code className="text-zinc-300">unlink()</code>)
              and database zero-wipes. It does not provide cryptographic or magnetic sanitization against solid-state drive
              (SSD) wear-leveling remapping, filesystem journaling artifacts, or OS volume shadow copies.
            </p>
          </div>
        </div>

        <div>
          {!showConfirm ? (
            <button
              onClick={() => setShowConfirm(true)}
              className="px-4 py-2 rounded-lg bg-rose-950 hover:bg-rose-900 border border-rose-800 text-rose-200 font-mono text-xs font-bold transition-all flex items-center gap-2"
            >
              <Trash2 className="w-4 h-4" />
              Delete All Workspace Data
            </button>
          ) : (
            <div className="flex items-center gap-3 bg-rose-950/80 p-3 rounded-lg border border-rose-800">
              <span className="text-xs font-mono text-rose-200 font-bold">Are you absolutely sure?</span>
              <button
                onClick={handlePurge}
                disabled={purging}
                className="px-3 py-1.5 rounded bg-rose-600 hover:bg-rose-500 text-white font-mono text-xs font-bold disabled:opacity-50"
              >
                {purging ? "Purging..." : "Confirm Delete"}
              </button>
              <button
                onClick={() => setShowConfirm(false)}
                disabled={purging}
                className="px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-mono text-xs"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
