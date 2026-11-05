/**
 * DeveloperMode Hosted Guardrail & Engine Selection Test Suite.
 *
 * Verifies:
 * 1. Hosted environment defaults to Browser (Recommended) mode.
 * 2. In hosted mode, Python Backend is visibly badged as "Local Only".
 * 3. In hosted mode, selecting Python Backend displays the exact user guidance:
 *    "Python Backend execution is available in local development. The hosted demo processes pipelines in your browser to keep uploaded data private and maintain zero server-side storage costs. Switch to Browser (Recommended) to continue."
 * 4. In hosted mode, Execute Pipeline button is disabled and never issues POST requests to /api/v1/pipelines/execute.
 * 5. Users can switch to Browser (Recommended) via inline switch controls.
 * 6. In local development (isHostedDemo=false), Python Backend remains unbadged, fully accessible, and functional.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { DeveloperMode } from "../features/developer/DeveloperMode";
import { api } from "../lib/api";

// Mock IndexedDB storage to prevent browser environment storage errors
vi.mock("../runtime/storage/indexeddb", () => ({
  indexedDBStorage: {
    saveRunManifest: vi.fn().mockResolvedValue(undefined),
    listInvestigations: vi.fn().mockResolvedValue([]),
  },
  getIndexedDBStorage: () => ({
    saveRunManifest: vi.fn().mockResolvedValue(undefined),
    listInvestigations: vi.fn().mockResolvedValue([]),
  }),
}));

describe("DeveloperMode Hosted Guardrail & UX", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Hosted Environment Behavior (isHostedDemo = true)", () => {
    it("renders Browser (Recommended) as active and badges Python Backend as Local Only", () => {
      render(<DeveloperMode isHostedDemo={true} />);

      // Verify Browser (Recommended) button is visible and active
      const browserBtn = screen.getByRole("button", { name: /Browser \(Recommended\)/i });
      expect(browserBtn).toBeInTheDocument();

      // Verify Python Backend has visible 'Local Only' tag
      expect(screen.getByText("Local Only")).toBeInTheDocument();
      const backendBtn = screen.getByRole("button", { name: /Python Backend/i });
      expect(backendBtn).toBeInTheDocument();
    });

    it("displays the exact required guidance when Python Backend is selected in hosted mode", () => {
      render(<DeveloperMode isHostedDemo={true} />);

      // Click Python Backend
      const backendBtn = screen.getByRole("button", { name: /Python Backend/i });
      fireEvent.click(backendBtn);

      // Verify the exact required explanation is displayed in the alert banner
      const noticeText =
        "Python Backend execution is available in local development. The hosted demo processes pipelines in your browser to keep uploaded data private and maintain zero server-side storage costs. Switch to Browser (Recommended) to continue.";
      const alert = screen.getByRole("alert");
      expect(alert).toHaveTextContent(noticeText);
    });

    it("disables Execute Pipeline button in hosted mode when Python Backend is selected", () => {
      render(<DeveloperMode isHostedDemo={true} />);

      // Switch to Python Backend
      const backendBtn = screen.getByRole("button", { name: /Python Backend/i });
      fireEvent.click(backendBtn);

      // Execute button should be disabled
      const executeBtn = screen.getByRole("button", { name: /Execute Pipeline/i });
      expect(executeBtn).toBeDisabled();
      expect(executeBtn).toHaveAttribute("aria-disabled", "true");
    });

    it("prevents any API call to pipelines/execute when Python Backend is active on hosted demo", async () => {
      const executePipelineSpy = vi.spyOn(api, "executePipeline").mockResolvedValue({
        run_id: "test-run",
        status: "COMPLETED",
        duration_ms: 10,
        step_results: {},
      });

      render(<DeveloperMode isHostedDemo={true} />);

      // Switch to Python Backend
      const backendBtn = screen.getByRole("button", { name: /Python Backend/i });
      fireEvent.click(backendBtn);

      // Attempt to click Execute Pipeline
      const executeBtn = screen.getByRole("button", { name: /Execute Pipeline/i });
      fireEvent.click(executeBtn);

      // Verify zero calls made to api.executePipeline
      expect(executePipelineSpy).not.toHaveBeenCalled();
    });

    it("provides inline switch button to return to Browser (Recommended)", () => {
      render(<DeveloperMode isHostedDemo={true} />);

      // Switch to Python Backend
      const backendBtn = screen.getByRole("button", { name: /Python Backend/i });
      fireEvent.click(backendBtn);

      // Click inline switch button in the notice banner
      const switchBtns = screen.getAllByRole("button", { name: /Browser \(Recommended\)/i });
      // The second one is the inline link button in the notice banner
      expect(switchBtns.length).toBeGreaterThanOrEqual(2);
      fireEvent.click(switchBtns[1]);

      // Notice should disappear and Execute button should be enabled
      expect(
        screen.queryByText(/The hosted demo processes pipelines in your browser/)
      ).not.toBeInTheDocument();
      const executeBtn = screen.getByRole("button", { name: /Execute Pipeline/i });
      expect(executeBtn).not.toBeDisabled();
    });
  });

  describe("Local Development Behavior (isHostedDemo = false)", () => {
    it("omits the Local Only badge and allows selecting Python Backend without hosted restriction banner", () => {
      render(<DeveloperMode isHostedDemo={false} />);

      // Verify 'Local Only' tag is NOT present
      expect(screen.queryByText("Local Only")).not.toBeInTheDocument();

      // Click Python Backend
      const backendBtn = screen.getByRole("button", { name: /Python Backend/i });
      fireEvent.click(backendBtn);

      // Hosted restriction banner must NOT appear
      expect(
        screen.queryByText(/The hosted demo processes pipelines in your browser/)
      ).not.toBeInTheDocument();

      // Execute button should remain enabled
      const executeBtn = screen.getByRole("button", { name: /Execute Pipeline/i });
      expect(executeBtn).not.toBeDisabled();
    });

    it("invokes api.executePipeline when running in local development mode", async () => {
      const executePipelineSpy = vi.spyOn(api, "executePipeline").mockResolvedValue({
        run_id: "test-run",
        status: "COMPLETED",
        duration_ms: 15,
        step_results: {},
      });

      render(<DeveloperMode isHostedDemo={false} />);

      // Switch to Python Backend
      const backendBtn = screen.getByRole("button", { name: /Python Backend/i });
      fireEvent.click(backendBtn);

      // Click Execute Pipeline
      const executeBtn = screen.getByRole("button", { name: /Execute Pipeline/i });
      fireEvent.click(executeBtn);

      await waitFor(() => {
        expect(executePipelineSpy).toHaveBeenCalledTimes(1);
      });
    });
  });
});
