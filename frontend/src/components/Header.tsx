import React from "react";
import {
  Activity,
  AlertTriangle,
  Code2,
  Compass,
  FileSpreadsheet,
  FileText,
  GitCompare,
  HardDrive,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { HealthResponse } from "../types/api";
import { Logo } from "./Logo";

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
  onStartTour?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  onTabChange,
  health,
  healthLoading,
  onRefreshHealth,
  onStartTour,
}) => {
  const isConnected = health !== null && health.status === "ok";

  const navItems: { id: WorkbenchTab; label: string; icon: React.ReactNode }[] = [
    { id: "demo", label: "Demo Sandbox", icon: <Activity className="w-4 h-4 flex-shrink-0" /> },
    { id: "csv", label: "CSV Ingestion", icon: <FileSpreadsheet className="w-4 h-4 flex-shrink-0" /> },
    { id: "investigate", label: "Investigation & Lineage", icon: <GitCompare className="w-4 h-4 flex-shrink-0" /> },
    { id: "verify", label: "Fix Verification", icon: <ShieldCheck className="w-4 h-4 flex-shrink-0" /> },
    { id: "reports", label: "Report Studio", icon: <FileText className="w-4 h-4 flex-shrink-0" /> },
    { id: "developer", label: "Developer Mode", icon: <Code2 className="w-4 h-4 flex-shrink-0" /> },
    { id: "settings", label: "Workspace", icon: <HardDrive className="w-4 h-4 flex-shrink-0" /> },
  ];

  return (
    <header className="border-b border-zinc-800/80 bg-zinc-900/95 backdrop-blur-md sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-3">
          {/* Logo & Tagline */}
          <div className="flex items-center gap-3 flex-shrink-0">
            <Logo size={36} className="w-9 h-9" />
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold tracking-tight text-zinc-100 text-base">DATA REWIND</span>
                <span className="text-[11px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700 font-mono">
                  v0.1.0
                </span>
              </div>
              <p className="text-[11px] text-zinc-400 hidden sm:block">Understand the past. Verify the present.</p>
            </div>
          </div>

          {/* Navigation Tabs - Gracefully scrollable on smaller viewports */}
          <nav
            className="flex items-center space-x-1 overflow-x-auto py-1 scrollbar-none max-w-full"
            aria-label="Workbench navigation"
          >
            {navItems.map((item) => {
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onTabChange(item.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                    active
                      ? "bg-zinc-800 text-zinc-100 shadow-sm border border-zinc-700"
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

          {/* Right Header Actions: Interactive Tour & Connection Indicator */}
          <div className="flex items-center gap-2.5 flex-shrink-0">
            {onStartTour && (
              <button
                onClick={onStartTour}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-zinc-800 hover:bg-zinc-750 text-zinc-200 border border-zinc-700 hover:border-emerald-500/50 transition-all shadow-sm"
                title="Start Guided Interactive Tour"
                aria-label="Start interactive guided tour"
              >
                <Compass className="w-3.5 h-3.5 text-emerald-400" />
                <span className="hidden md:inline">Guided Tour</span>
              </button>
            )}

            <button
              onClick={onRefreshHealth}
              disabled={healthLoading}
              title="Click to refresh backend connection status"
              className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-mono border transition-all ${
                isConnected
                  ? "bg-emerald-950/50 border-emerald-800/70 text-emerald-300 hover:bg-emerald-900/50"
                  : "bg-rose-950/50 border-rose-800/70 text-rose-300 hover:bg-rose-900/50"
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  isConnected ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" : "bg-rose-400 animate-pulse"
                }`}
              />
              <span className="hidden lg:inline text-[11px]">
                {isConnected
                  ? (health.profile === "hosted_demo" ? "API Online (hosted demo)" : `127.0.0.1:8000 (${health.profile})`)
                  : (healthLoading ? "Connecting..." : "Disconnected")}
              </span>
              <RefreshCw className={`w-3 h-3 flex-shrink-0 ${healthLoading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Disconnected Warning Banner */}
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
