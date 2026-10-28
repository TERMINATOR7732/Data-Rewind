import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VerificationHub } from "../features/verification/VerificationHub";
import { ForensicDossier } from "../types/api";

const mockDossier: ForensicDossier = {
  metadata: {
    dossier_id: "dossier-uuid-1234",
    pipeline_name: "Scenario SCN01",
    pipeline_version_hash: "hash_ver_1",
    investigator_session: "session-1",
    faulted_run_id: "r1-uuid",
    candidate_run_id: "r2-uuid",
    created_at: new Date().toISOString(),
  },
  verification: {
    verification_id: "verif-uuid-1",
    title: "Tri-Run Fix Verification: E-Commerce Revenue",
    faulted_run_id: "r1-uuid",
    candidate_run_id: "r2-uuid",
    verdict: "VERIFIED_CLEAN",
    verdict_meaning: "Defect remediated and baseline equivalence restored 100%.",
    verdict_reason_codes: ["EOD_REMEDIATED", "BASELINE_EQUIVALENCE_CONFIRMED"],
    dual_axis: {
      remediation_axis: {
        eod_step: "compute_net_revenue",
        eod_remediated: true,
        eod_severity_reduced: true,
        unresolved_eod_differences: [],
        explanation: "Sign error in formula was corrected.",
      },
      baseline_axis: {
        baseline_equivalent_at_sinks: true,
        baseline_equivalent_across_all_steps: true,
        collateral_regressions: [],
        sink_step_ids: ["daily_revenue_mart"],
        step_comparisons: {},
        explanation: "All sinks and intermediate nodes match baseline exactly.",
      },
    },
    evidence_chain: [
      {
        tier: "PROVEN_OBSERVATION",
        step_id: "compute_net_revenue",
        category: "FORMULA_DRIFT",
        description: "1,200 rows matched baseline exactly.",
        remediation_advice: "Deploy formula patch.",
      },
    ],
    missing_evidence: [],
    created_at: new Date().toISOString(),
    duration_ms: 14.5,
  },
  reproducibility_signatures: {},
  limitations_disclaimer: "Local deterministic verification.",
};

describe("VerificationHub Feature Component", () => {
  it("renders dual-axis verification and VERIFIED_CLEAN verdict card", () => {
    render(<VerificationHub currentDossier={mockDossier} onNavigateToReports={vi.fn()} />);

    expect(screen.getByText("Tri-Run Fix Verification: E-Commerce Revenue")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("VERIFIED CLEAN");
    expect(screen.getByText(/Defect remediated and baseline equivalence restored 100%/)).toBeInTheDocument();
    expect(screen.getByText("FAULT REMEDIATED")).toBeInTheDocument();
    expect(screen.getByText("100% EQUIVALENT")).toBeInTheDocument();
  });

  it("navigates to report studio when button clicked", () => {
    const handleReports = vi.fn();
    render(<VerificationHub currentDossier={mockDossier} onNavigateToReports={handleReports} />);

    fireEvent.click(screen.getByText("Open Report Studio"));
    expect(handleReports).toHaveBeenCalledWith("dossier-uuid-1234");
  });
});
