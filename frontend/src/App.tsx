import React, { useEffect, useState } from "react";
import { Header, WorkbenchTab } from "./components/Header";
import { DemoHub } from "./features/demo/DemoHub";
import { CSVInvestigation } from "./features/csv/CSVInvestigation";
import { InvestigationView } from "./features/investigation/InvestigationView";
import { VerificationHub } from "./features/verification/VerificationHub";
import { ReportStudio } from "./features/reports/ReportStudio";
import { DeveloperMode } from "./features/developer/DeveloperMode";
import { WorkspaceSettings } from "./features/settings/WorkspaceSettings";
import { api } from "./lib/api";
import { ForensicDossier, HealthResponse, Investigation } from "./types/api";

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<WorkbenchTab>("demo");
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthLoading, setHealthLoading] = useState<boolean>(false);

  // Cross-screen investigation & verification state
  const [currentInvestigation, setCurrentInvestigation] = useState<Investigation | null>(null);
  const [currentDossier, setCurrentDossier] = useState<ForensicDossier | null>(null);
  const [reportDossierId, setReportDossierId] = useState<string | null>(null);

  const fetchHealth = async () => {
    try {
      setHealthLoading(true);
      const h = await api.getHealth();
      setHealth(h);
    } catch {
      setHealth(null);
    } finally {
      setHealthLoading(false);
    }
  };

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 15000);
    return () => clearInterval(interval);
  }, []);

  // Handlers for cross-screen transitions
  const handleInvestigationLoaded = (inv: Investigation) => {
    setCurrentInvestigation(inv);
    setActiveTab("investigate");
  };

  const handleDossierLoaded = (dossier: ForensicDossier) => {
    setCurrentDossier(dossier);
    setActiveTab("verify");
  };

  const handleNavigateToReports = (dossierId: string) => {
    setReportDossierId(dossierId);
    setActiveTab("reports");
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans selection:bg-emerald-500 selection:text-zinc-950">
      {/* Shell Header */}
      <Header
        activeTab={activeTab}
        onTabChange={setActiveTab}
        health={health}
        healthLoading={healthLoading}
        onRefreshHealth={fetchHealth}
      />

      {/* Main Workbench Body */}
      <main className="flex-1 w-full pb-16">
        {activeTab === "demo" && (
          <DemoHub
            onInvestigationLoaded={handleInvestigationLoaded}
            onDossierLoaded={handleDossierLoaded}
          />
        )}

        {activeTab === "csv" && <CSVInvestigation />}

        {activeTab === "investigate" && (
          <InvestigationView
            currentInvestigation={currentInvestigation}
            onSelectInvestigation={setCurrentInvestigation}
          />
        )}

        {activeTab === "verify" && (
          <VerificationHub
            currentDossier={currentDossier}
            onNavigateToReports={handleNavigateToReports}
          />
        )}

        {activeTab === "reports" && <ReportStudio initialDossierId={reportDossierId} />}

        {activeTab === "developer" && <DeveloperMode />}

        {activeTab === "settings" && <WorkspaceSettings />}
      </main>

      {/* Local-First Footer */}
      <footer className="border-t border-zinc-850 bg-zinc-900/60 py-4 px-6 text-xs font-mono text-zinc-500 flex flex-col sm:flex-row items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span>DATA REWIND • Engineering Forensic Workbench</span>
          <span>•</span>
          <span className="text-emerald-500/80">100% Local-First (₹0 Budget)</span>
        </div>
        <div className="flex items-center gap-3 text-zinc-400">
          <span>Loopback: 127.0.0.1:8000</span>
          <span>•</span>
          <span>Zero External Telemetry</span>
        </div>
      </footer>
    </div>
  );
};

export default App;
