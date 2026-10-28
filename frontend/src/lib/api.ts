/**
 * Data Rewind Typed REST API Client.
 * Connects directly to local-first backend on 127.0.0.1:8000 (SPEC-MOD-07 §3).
 */

import {
  ApiError,
  DatasetPreviewResponse,
  DatasetUploadResponse,
  ForensicDossier,
  HealthResponse,
  Investigation,
  InvestigationSummary,
  ScenarioDetail,
  ScenarioSummary,
  StepDiffPage,
  TransformationStep,
  VerificationSummary,
  WorkspaceInfo,
  WorkspacePurgeResponse,
} from "../types/api";

const API_BASE = import.meta.env.VITE_API_URL || "/api/v1";

export class ApiClientError extends Error {
  code: string;
  details?: Record<string, any>;
  remediation?: string;
  statusCode?: number;

  constructor(error: ApiError, statusCode?: number) {
    super(error.message);
    this.name = "ApiClientError";
    this.code = error.code;
    this.details = error.details;
    this.remediation = error.remediation;
    this.statusCode = statusCode;
  }
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let errBody: any;
    try {
      errBody = await res.json();
    } catch {
      throw new ApiClientError(
        {
          code: `HTTP_${res.status}`,
          message: res.statusText || "Server communication error",
        },
        res.status
      );
    }

    if (errBody && errBody.error) {
      throw new ApiClientError(errBody.error, res.status);
    } else if (errBody && errBody.detail) {
      if (typeof errBody.detail === "object") {
        throw new ApiClientError(
          {
            code: errBody.detail.code || `HTTP_${res.status}`,
            message: errBody.detail.message || "An error occurred",
            details: errBody.detail.details,
            remediation: errBody.detail.remediation,
          },
          res.status
        );
      }
      throw new ApiClientError(
        { code: `HTTP_${res.status}`, message: String(errBody.detail) },
        res.status
      );
    }
    throw new ApiClientError(
      { code: `HTTP_${res.status}`, message: "Unexpected server response" },
      res.status
    );
  }
  return res.json() as Promise<T>;
}

export const api = {
  // System Health
  async getHealth(): Promise<HealthResponse> {
    const res = await fetch(`${API_BASE}/health`);
    return handleResponse<HealthResponse>(res);
  },

  // Demonstration Scenarios
  async getScenarios(): Promise<ScenarioSummary[]> {
    const res = await fetch(`${API_BASE}/scenarios`);
    return handleResponse<ScenarioSummary[]>(res);
  },

  async getScenario(scenarioId: string): Promise<ScenarioDetail> {
    const res = await fetch(`${API_BASE}/scenarios/${encodeURIComponent(scenarioId)}`);
    return handleResponse<ScenarioDetail>(res);
  },

  async runScenario(scenarioId: string): Promise<Investigation> {
    const res = await fetch(`${API_BASE}/scenarios/${encodeURIComponent(scenarioId)}/run`, {
      method: "POST",
    });
    return handleResponse<Investigation>(res);
  },

  async verifyScenario(
    scenarioId: string,
    fixMode: string = "clean",
    intentionalContract?: Record<string, any>
  ): Promise<ForensicDossier> {
    const res = await fetch(`${API_BASE}/scenarios/${encodeURIComponent(scenarioId)}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scenario_id: scenarioId,
        fix_mode: fixMode,
        intentional_contract: intentionalContract,
      }),
    });
    return handleResponse<ForensicDossier>(res);
  },

  // Datasets
  async uploadDataset(file: File): Promise<DatasetUploadResponse> {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch(`${API_BASE}/datasets/upload`, {
      method: "POST",
      body: formData,
    });
    return handleResponse<DatasetUploadResponse>(res);
  },

  async listDatasets(): Promise<DatasetUploadResponse[]> {
    const res = await fetch(`${API_BASE}/datasets`);
    return handleResponse<DatasetUploadResponse[]>(res);
  },

  async previewDataset(datasetId: string): Promise<DatasetPreviewResponse> {
    const res = await fetch(`${API_BASE}/datasets/${encodeURIComponent(datasetId)}/preview`);
    return handleResponse<DatasetPreviewResponse>(res);
  },

  // Pipelines
  async validatePipeline(
    steps: TransformationStep[],
    inputs: string[] = []
  ): Promise<{ valid: boolean; topological_order?: string[]; error_message?: string }> {
    const res = await fetch(`${API_BASE}/pipelines/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ steps, inputs }),
    });
    return handleResponse<{ valid: boolean; topological_order?: string[]; error_message?: string }>(
      res
    );
  },

  async executePipeline(
    steps: TransformationStep[],
    inputs: Record<string, any[]> = {},
    datasetIds: Record<string, string> = {}
  ): Promise<{
    run_id: string;
    status: string;
    duration_ms: number;
    step_results: Record<string, any>;
  }> {
    const res = await fetch(`${API_BASE}/pipelines/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ steps, inputs, dataset_ids: datasetIds }),
    });
    return handleResponse(res);
  },

  // Investigations & Comparisons
  async listComparisons(): Promise<InvestigationSummary[]> {
    const res = await fetch(`${API_BASE}/comparisons`);
    return handleResponse<InvestigationSummary[]>(res);
  },

  async getComparison(investigationId: string): Promise<Investigation> {
    const res = await fetch(`${API_BASE}/comparisons/${encodeURIComponent(investigationId)}`);
    return handleResponse<Investigation>(res);
  },

  async getStepDiff(
    investigationId: string,
    stepId: string,
    status: string = "ALL",
    page: number = 1,
    pageSize: number = 50
  ): Promise<StepDiffPage> {
    const url = new URL(
      `${API_BASE}/comparisons/${encodeURIComponent(investigationId)}/steps/${encodeURIComponent(
        stepId
      )}/diff`,
      window.location.origin
    );
    url.searchParams.set("status", status);
    url.searchParams.set("page", String(page));
    url.searchParams.set("page_size", String(pageSize));

    const res = await fetch(url.toString());
    return handleResponse<StepDiffPage>(res);
  },

  // Verifications
  async listVerifications(): Promise<VerificationSummary[]> {
    const res = await fetch(`${API_BASE}/verifications`);
    return handleResponse<VerificationSummary[]>(res);
  },

  async getDossier(dossierId: string): Promise<ForensicDossier> {
    const res = await fetch(`${API_BASE}/verifications/dossiers/${encodeURIComponent(dossierId)}`);
    return handleResponse<ForensicDossier>(res);
  },

  // Report Export & Download
  async exportReport(
    dossierId: string,
    format: "json" | "markdown" | "safe_csv" | "raw_csv" = "markdown",
    stepId?: string
  ): Promise<void> {
    const url = new URL(
      `${API_BASE}/reports/${encodeURIComponent(dossierId)}/export`,
      window.location.origin
    );
    url.searchParams.set("format", format);
    if (stepId) url.searchParams.set("step_id", stepId);

    const res = await fetch(url.toString());
    if (!res.ok) {
      await handleResponse(res);
      return;
    }

    const blob = await res.blob();
    const disposition = res.headers.get("Content-Disposition");
    let filename = `forensic_report.${format === "markdown" ? "md" : format === "json" ? "json" : "csv"}`;
    if (disposition && disposition.includes("filename=")) {
      const match = disposition.match(/filename="?([^";]+)"?/);
      if (match && match[1]) filename = match[1];
    }

    const downloadUrl = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = downloadUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(downloadUrl);
    document.body.removeChild(a);
  },

  // Workspace Retention & Purge
  async getWorkspaceInfo(): Promise<WorkspaceInfo> {
    const res = await fetch(`${API_BASE}/workspaces`);
    return handleResponse<WorkspaceInfo>(res);
  },

  async purgeWorkspace(): Promise<WorkspacePurgeResponse> {
    const res = await fetch(`${API_BASE}/workspaces/purge`, {
      method: "DELETE",
    });
    return handleResponse<WorkspacePurgeResponse>(res);
  },
};
