import React, { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { ForensicDossier, HealthResponse, Investigation } from "../../types/api";
import { WorkbenchTab } from "../../components/Header";
import { RunManifest } from "../../runtime/storage/run-manifest";
import { PipelineDefinition } from "../../runtime/contracts/index";
import { indexedDBStorage, DatasetMetadata, StoredInvestigation } from "../../runtime/storage/indexeddb";
import { ForensicInvestigationService } from "../../runtime/forensics/index";
import { api } from "../../lib/api";

export type ExecutionState = "IDLE" | "VALIDATING" | "RUNNING" | "COMPLETED" | "BLOCKED" | "FAILED";

export interface InvestigationContextValue {
  activeWorkspaceId: string;
  setActiveWorkspaceId: (id: string) => void;
  activeTab: WorkbenchTab;
  setActiveTab: (tab: WorkbenchTab) => void;
  health: HealthResponse | null;
  healthLoading: boolean;
  refreshHealth: () => Promise<void>;

  // Forensic artifacts
  currentInvestigation: Investigation | null;
  setCurrentInvestigation: (inv: Investigation | null) => void;
  currentDossier: ForensicDossier | null;
  setCurrentDossier: (dossier: ForensicDossier | null) => void;
  reportDossierId: string | null;
  setReportDossierId: (id: string | null) => void;

  // Pipeline & Runs
  baselineRun: RunManifest | null;
  setBaselineRun: (run: RunManifest | null) => void;
  candidateRun: RunManifest | null;
  setCandidateRun: (run: RunManifest | null) => void;
  activePipeline: PipelineDefinition | null;
  setActivePipeline: (pipeline: PipelineDefinition | null) => void;
  activeDataset: DatasetMetadata | null;
  setActiveDataset: (dataset: DatasetMetadata | null) => void;

  // Execution Lifecycle & Status
  executionState: ExecutionState;
  setExecutionState: (state: ExecutionState) => void;
  integrityWarnings: string[];
  dismissIntegrityWarning: (index: number) => void;

  // Unified Navigation Helpers
  navigateToInvestigation: (inv: Investigation) => void;
  navigateToVerification: (dossier?: ForensicDossier) => void;
  navigateToReports: (dossierId?: string) => void;
  navigateToCSV: () => void;
  navigateToDeveloper: () => void;
  navigateToDemo: () => void;
}

const InvestigationContext = createContext<InvestigationContextValue | undefined>(undefined);

export const InvestigationProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string>("default");
  const [activeTab, setActiveTab] = useState<WorkbenchTab>("demo");
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthLoading, setHealthLoading] = useState<boolean>(false);

  // Investigation & Verification Dossier
  const [currentInvestigation, setCurrentInvestigation] = useState<Investigation | null>(null);
  const [currentDossier, setCurrentDossier] = useState<ForensicDossier | null>(null);
  const [reportDossierId, setReportDossierId] = useState<string | null>(null);

  // Pipelines & Manifests
  const [baselineRun, setBaselineRun] = useState<RunManifest | null>(null);
  const [candidateRun, setCandidateRun] = useState<RunManifest | null>(null);
  const [activePipeline, setActivePipeline] = useState<PipelineDefinition | null>(null);
  const [activeDataset, setActiveDataset] = useState<DatasetMetadata | null>(null);

  // Lifecycle
  const [executionState, setExecutionState] = useState<ExecutionState>("IDLE");
  const [integrityWarnings, setIntegrityWarnings] = useState<string[]>([]);

  const refreshHealth = async () => {
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
    refreshHealth();
    const interval = setInterval(refreshHealth, 15000);
    return () => clearInterval(interval);
  }, []);

  // Restore workspace & investigations on startup
  useEffect(() => {
    const restoreSession = async () => {
      try {
        const invList = await indexedDBStorage.listInvestigations();
        if (invList && invList.length > 0) {
          // Sort by creation desc
          const sorted = [...invList].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
          const latestMeta: StoredInvestigation = sorted[0];
          // Try resolving full report from forensic service
          const localInv = ForensicInvestigationService.getInvestigation(latestMeta.investigationId);
          if (localInv) {
            setCurrentInvestigation(localInv);
          } else {
            // Check server fallback
            try {
              const remote = await api.getComparison(latestMeta.investigationId);
              if (remote) {
                setCurrentInvestigation(remote);
              }
            } catch {
              // Graceful notification without blocking
              setIntegrityWarnings((prev) => [
                ...prev,
                `Investigation record '${latestMeta.investigationId.slice(0, 8)}' references an unmaterialized session. Select a demo scenario to initiate a fresh investigation.`,
              ]);
            }
          }
        }
      } catch (err: any) {
        // Storage recovery failure should never block UI
        console.warn("Storage startup recovery notice:", err);
      }
    };
    restoreSession();
  }, []);

  const dismissIntegrityWarning = (index: number) => {
    setIntegrityWarnings((prev) => prev.filter((_, i) => i !== index));
  };

  // Cross-screen navigation actions
  const navigateToInvestigation = (inv: Investigation) => {
    setCurrentInvestigation(inv);
    setActiveTab("investigate");
  };

  const navigateToVerification = (dossier?: ForensicDossier) => {
    if (dossier) {
      setCurrentDossier(dossier);
    }
    setActiveTab("verify");
  };

  const navigateToReports = (dossierId?: string) => {
    if (dossierId) {
      setReportDossierId(dossierId);
    } else if (currentDossier) {
      setReportDossierId(currentDossier.metadata.dossier_id);
    }
    setActiveTab("reports");
  };

  const navigateToCSV = () => setActiveTab("csv");
  const navigateToDeveloper = () => setActiveTab("developer");
  const navigateToDemo = () => setActiveTab("demo");

  const value: InvestigationContextValue = {
    activeWorkspaceId,
    setActiveWorkspaceId,
    activeTab,
    setActiveTab,
    health,
    healthLoading,
    refreshHealth,
    currentInvestigation,
    setCurrentInvestigation,
    currentDossier,
    setCurrentDossier,
    reportDossierId,
    setReportDossierId,
    baselineRun,
    setBaselineRun,
    candidateRun,
    setCandidateRun,
    activePipeline,
    setActivePipeline,
    activeDataset,
    setActiveDataset,
    executionState,
    setExecutionState,
    integrityWarnings,
    dismissIntegrityWarning,
    navigateToInvestigation,
    navigateToVerification,
    navigateToReports,
    navigateToCSV,
    navigateToDeveloper,
    navigateToDemo,
  };

  return <InvestigationContext.Provider value={value}>{children}</InvestigationContext.Provider>;
};

export const useInvestigationContext = (): InvestigationContextValue => {
  const context = useContext(InvestigationContext);
  if (!context) {
    throw new Error("useInvestigationContext must be used within an InvestigationProvider");
  }
  return context;
};
