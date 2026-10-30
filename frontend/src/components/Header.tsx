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
    <header className="border-b border-zinc-800/80 bg-zinc-900/95 backdrop-blur-md sticky top-0 z-40 w-full">
      <div className="w-full px-3 sm:px-4 xl:px-2 2xl:px-6">
        <div className="flex flex-wrap xl:flex-nowrap items-center justify-between min-h-[4rem] py-2 xl:py-0 gap-y-2.5 gap-x-2 w-full">
          {/* Logo & Tagline (Top-Left) */}
          <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
            <Logo size={28} className="w-7 h-7 flex-shrink-0" />
            <div className="flex flex-col justify-center">
              <div className="flex items-center gap-1.5 leading-none">
                <span className="font-bold tracking-tight text-zinc-100 text-sm whitespace-nowrap">
                  DATA REWIND
                </span>
                <span className="text-[10px] px-1 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-750 font-mono">
                  v0.1.0
                </span>
              </div>
              <p className="text-[10px] text-zinc-400 hidden sm:block whitespace-nowrap leading-none mt-1">
                Understand the past. Verify the present.
              </p>
            </div>
          </div>

          {/* Navigation Tabs - Arranged horizontally in single row, responsive wrapping on tablet/mobile */}
          <nav
            className="order-3 xl:order-2 w-full xl:w-auto flex items-center justify-start xl:justify-center gap-0.5 2xl:gap-1 overflow-x-auto xl:overflow-x-visible py-1 xl:py-0 scrollbar-none min-w-0"
            aria-label="Workbench navigation"
          >
            {navItems.map((item) => {
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onTabChange(item.id)}
                  className={`flex items-center gap-1 2xl:gap-1.5 px-1 xl:px-1 2xl:px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap flex-shrink-0 ${
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

          {/* Right Header Actions: Connection Indicator & Guided Tour (Top-Right) */}
          <div className="order-2 xl:order-3 flex items-center gap-1.5 sm:gap-2 flex-shrink-0 justify-end">
            <button
              onClick={onRefreshHealth}
              disabled={healthLoading}
              title="Click to refresh backend connection status"
              className={`flex items-center gap-1.5 px-1.5 xl:px-1.5 2xl:px-2 py-1.5 rounded-lg text-xs font-mono border transition-all ${
                isConnected
                  ? "bg-emerald-950/40 border-emerald-800/60 text-emerald-300 hover:bg-emerald-900/40"
                  : "bg-rose-950/40 border-rose-800/60 text-rose-300 hover:bg-rose-900/40"
              }`}
              aria-label="Server connection status"
            >
              <span
                className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  isConnected ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" : "bg-rose-400 animate-pulse"
                }`}
              />
              <span className="hidden sm:inline text-[11px] font-mono">
                {isConnected ? (
                  health.profile === "hosted_demo" ? (
                    "API Online"
                  ) : (
                    `127.0.0.1:8000 (${health.profile})`
                  )
                ) : (
                  healthLoading ? "Connecting..." : "Disconnected"
                )}
              </span>
              <RefreshCw className={`w-3 h-3 flex-shrink-0 ${healthLoading ? "animate-spin" : ""}`} />
            </button>

            {onStartTour && (
              <button
                onClick={onStartTour}
                className="flex items-center gap-1.5 px-2 xl:px-2 2xl:px-3 py-1.5 rounded-lg text-xs font-semibold bg-zinc-800 hover:bg-zinc-750 text-zinc-100 border border-zinc-700 hover:border-emerald-500/50 transition-all shadow-sm focus-visible:ring-2 focus-visible:ring-emerald-500"
                title="Start Guided Interactive Tour"
                aria-label="Start interactive guided tour"
              >
                <Compass className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                <span className="whitespace-nowrap">Guided Tour</span>
              </button>
            )}
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
