import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GuidedTour } from "../components/GuidedTour";
import { WelcomeModal } from "../components/WelcomeModal";

describe("GuidedTour Component", () => {
  it("renders when open and advances through tour steps", () => {
    const handleClose = vi.fn();
    const handleNavigate = vi.fn();

    render(
      <GuidedTour
        activeTab="demo"
        onNavigateTab={handleNavigate}
        isOpen={true}
        onClose={handleClose}
      />
    );

    // Initial step 1
    expect(screen.getByText("Step 1 of 5")).toBeInTheDocument();
    expect(screen.getByText("Choose a Pipeline Failure Scenario")).toBeInTheDocument();

    // Click Next
    const nextBtn = screen.getByRole("button", { name: /Next/i });
    fireEvent.click(nextBtn);

    // Step 2
    expect(screen.getByText("Step 2 of 5")).toBeInTheDocument();
    expect(screen.getByText("Execute Forensic Investigation")).toBeInTheDocument();

    // Click Skip Tour
    const skipBtn = screen.getByRole("button", { name: /Skip Tour/i });
    fireEvent.click(skipBtn);
    expect(handleClose).toHaveBeenCalled();
  });

  it("handles keyboard Escape key to close", () => {
    const handleClose = vi.fn();
    render(
      <GuidedTour
        activeTab="demo"
        onNavigateTab={vi.fn()}
        isOpen={true}
        onClose={handleClose}
      />
    );

    fireEvent.keyDown(window, { key: "Escape" });
    expect(handleClose).toHaveBeenCalled();
  });
});

describe("WelcomeModal Component", () => {
  it("renders value proposition and provides start and dismiss actions", () => {
    const handleStartTour = vi.fn();
    const handleDismiss = vi.fn();

    render(
      <WelcomeModal
        isOpen={true}
        onStartTour={handleStartTour}
        onDismiss={handleDismiss}
      />
    );

    expect(screen.getByText("Welcome to Data Rewind")).toBeInTheDocument();
    expect(screen.getByText(/Investigate a data pipeline failure/)).toBeInTheDocument();

    // Test actions
    fireEvent.click(screen.getByRole("button", { name: /Start Guided Tour/i }));
    expect(handleStartTour).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /Skip for now/i }));
    expect(handleDismiss).toHaveBeenCalledTimes(1);
  });
});
