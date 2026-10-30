import React, { useEffect, useState } from "react";
import { Header } from "./components/Header";
import { DemoHub } from "./features/demo/DemoHub";
import { CSVInvestigation } from "./features/csv/CSVInvestigation";
import { InvestigationView } from "./features/investigation/InvestigationView";
import { VerificationHub } from "./features/verification/VerificationHub";
import { ReportStudio } from "./features/reports/ReportStudio";
import { DeveloperMode } from "./features/developer/DeveloperMode";
import { WorkspaceSettings } from "./features/settings/WorkspaceSettings";
import { GuidedTour } from "./components/GuidedTour";
import { WelcomeModal } from "./components/WelcomeModal";
import {
  InvestigationProvider,
  useInvestigationContext,
} from "./features/context/InvestigationContext";
import { AlertTriangle } from "lucide-react";

const TOUR_STORAGE_KEY = "data_rewind_tour_completed";

const AppContent: React.FC = () => {
  const {
    activeTab,
    setActiveTab,
    health,
    healthLoading,
    refreshHealth,
    currentInvestigation,
    setCurrentInvestigation,
    currentDossier,
    reportDossierId,
    integrityWarnings,
    dismissIntegrityWarning,
    navigateToInvestigation,
    navigateToVerification,
    navigateToReports,
  } = useInvestigationContext();

  // Onboarding Guided Tour state
  const [showWelcome, setShowWelcome] = useState<boolean>(false);
  const [showTour, setShowTour] = useState<boolean>(false);

  // Check if first-time visitor
  useEffect(() => {
    try {
      const completed = localStorage.getItem(TOUR_STORAGE_KEY);
      if (!completed) {
        setShowWelcome(true);
      }
    } catch {
      // LocalStorage access may fail in restricted sandboxes; gracefully ignore
    }
  }, []);

  const handleStartTour = () => {
    setShowWelcome(false);
    setShowTour(true);
  };

  const handleDismissWelcome = () => {
    try {
      localStorage.setItem(TOUR_STORAGE_KEY, "true");
    } catch {
      // Ignore storage restrictions
    }
    setShowWelcome(false);
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans selection:bg-emerald-500 selection:text-zinc-950">
      {/* Shell Header */}
      <Header
        activeTab={activeTab}
        onTabChange={setActiveTab}
        health={health}
        healthLoading={healthLoading}
        onRefreshHealth={refreshHealth}
        onStartTour={() => setShowTour(true)}
      />

      {/* Startup Integrity Warnings */}
      {integrityWarnings.length > 0 && (
        <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 pt-4">
          {integrityWarnings.map((warning, idx) => (
            <div
              key={idx}
              className="mb-2 p-3 rounded-xl bg-amber-950/80 border border-amber-800 text-amber-200 text-xs font-mono flex items-center justify-between"
            >
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
                <span>{warning}</span>
              </div>
              <button
                onClick={() => dismissIntegrityWarning(idx)}
                className="font-bold text-amber-400 hover:text-amber-200 px-2"
              >
                Dismiss
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Main Workbench Body */}
      <main className="flex-1 w-full pb-16">
        {activeTab === "demo" && (
          <DemoHub
            onInvestigationLoaded={navigateToInvestigation}
            onDossierLoaded={navigateToVerification}
            onStartTour={() => setShowTour(true)}
          />
        )}

        {activeTab === "csv" && (
          <CSVInvestigation isHostedDemo={health?.profile === "hosted_demo"} />
        )}

        {activeTab === "investigate" && (
          <InvestigationView
            currentInvestigation={currentInvestigation}
            onSelectInvestigation={setCurrentInvestigation}
          />
        )}

        {activeTab === "verify" && (
          <VerificationHub
            currentDossier={currentDossier}
            onNavigateToReports={navigateToReports}
          />
        )}

        {activeTab === "reports" && <ReportStudio initialDossierId={reportDossierId} />}

        {activeTab === "developer" && (
          <DeveloperMode isHostedDemo={health?.profile === "hosted_demo"} />
        )}

        {activeTab === "settings" && <WorkspaceSettings />}
      </main>

      {/* Professional Engineering Footer */}
      <footer className="border-t border-zinc-800/80 bg-zinc-900/60 py-4 px-6 text-xs font-mono text-zinc-500 flex flex-col sm:flex-row items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span>DATA REWIND • Forensic Pipeline Workbench</span>
          <span>•</span>
          <span className="text-emerald-400/90 font-medium">Offline-First Evidence Engine</span>
        </div>
        <div className="flex items-center gap-3 text-zinc-400">
          <span>Zero External Telemetry</span>
          <span>•</span>
          <span>Local Parquet & SQLite WAL</span>
        </div>
      </footer>

      {/* First-Time Welcome Modal */}
      <WelcomeModal
        isOpen={showWelcome}
        onStartTour={handleStartTour}
        onDismiss={handleDismissWelcome}
      />

      {/* Guided Interactive Tour */}
      <GuidedTour
        activeTab={activeTab}
        onNavigateTab={setActiveTab}
        isOpen={showTour}
        onClose={() => setShowTour(false)}
      />
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <InvestigationProvider>
      <AppContent />
    </InvestigationProvider>
  );
};

export default App;
