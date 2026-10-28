import React from "react";
import {
  Activity,
  AlertTriangle,
  Code2,
  FileSpreadsheet,
  FileText,
  GitCompare,
  HardDrive,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { HealthResponse } from "../types/api";

export type WorkbenchTab =
  | "demo"
  | "csv"
  | "investigate"
  | "verify"
  | "reports"
  | "developer"
  | "settings";

interface HeaderProps {
  activeTab: WorkbenchTab;
  onTabChange: (tab: WorkbenchTab) => void;
  health: HealthResponse | null;
  healthLoading: boolean;
  onRefreshHealth: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  onTabChange,
  health,
  healthLoading,
  onRefreshHealth,
}) => {
  const isConnected = health !== null && health.status === "ok";

  const navItems: { id: WorkbenchTab; label: string; icon: React.ReactNode }[] = [
    { id: "demo", label: "Demo Sandbox", icon: <Activity className="w-4 h-4" /> },
    { id: "csv", label: "CSV Ingestion", icon: <FileSpreadsheet className="w-4 h-4" /> },
    { id: "investigate", label: "Investigation & Lineage", icon: <GitCompare className="w-4 h-4" /> },
    { id: "verify", label: "Fix Verification", icon: <ShieldCheck className="w-4 h-4" /> },
    { id: "reports", label: "Report Studio", icon: <FileText className="w-4 h-4" /> },
    { id: "developer", label: "Developer Mode", icon: <Code2 className="w-4 h-4" /> },
    { id: "settings", label: "Workspace", icon: <HardDrive className="w-4 h-4" /> },
  ];

  return (
    <header className="border-b border-zinc-800 bg-zinc-900/90 backdrop-blur sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo & Tagline */}
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center text-emerald-400 font-mono font-bold text-lg shadow-inner">
              DR
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold tracking-tight text-zinc-100 text-base">DATA REWIND</span>
                <span className="text-xs px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700 font-mono">
                  v0.1.0
                </span>
              </div>
              <p className="text-xs text-zinc-400 hidden sm:block">Understand the past. Verify the present.</p>
            </div>
          </div>

          {/* Navigation Tabs */}
          <nav className="flex space-x-1 overflow-x-auto py-2" aria-label="Workbench navigation">
            {navItems.map((item) => {
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onTabChange(item.id)}
                  className={`flex items-center gap-2 px-3 py-1.5 text-xs sm:text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
                    active
                      ? "bg-zinc-800 text-zinc-100 shadow border border-zinc-700"
                      : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850"
                  }`}
                  aria-current={active ? "page" : undefined}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Backend Connection Indicator */}
          <div className="flex items-center gap-2">
            <button
              onClick={onRefreshHealth}
              disabled={healthLoading}
              title="Click to re-check local backend on 127.0.0.1:8000"
              className={`flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-mono border transition-all ${
                isConnected
                  ? "bg-emerald-950/60 border-emerald-800/80 text-emerald-300 hover:bg-emerald-900/60"
                  : "bg-rose-950/60 border-rose-800/80 text-rose-300 hover:bg-rose-900/60"
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  isConnected ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" : "bg-rose-400 animate-pulse"
                }`}
              />
              <span className="hidden md:inline">
                {isConnected ? `127.0.0.1:8000 (${health.profile})` : "Disconnected"}
              </span>
              <RefreshCw className={`w-3 h-3 ${healthLoading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>
      </div>
      {!isConnected && !healthLoading && (
        <div className="bg-rose-950/90 border-t border-rose-900 text-rose-200 px-4 py-2 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0" />
            <span>
              Backend Disconnected — ensure Uvicorn is running on <strong>127.0.0.1:8000</strong> (run{" "}
              <code className="bg-rose-900/50 px-1 rounded">run.bat</code> or{" "}
              <code className="bg-rose-900/50 px-1 rounded">python -m data_rewind.cli serve</code>).
            </span>
          </div>
          <button
            onClick={onRefreshHealth}
            className="underline hover:text-white font-medium ml-4 whitespace-nowrap"
          >
            Retry Connection
          </button>
        </div>
      )}
    </header>
  );
};
