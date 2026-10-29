import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Compass,
  X,
} from "lucide-react";

export interface TourStep {
  id: string;
  targetSelector: string;
  fallbackTab?: string;
  title: string;
  description: string;
  badge?: string;
}

const TOUR_STEPS: TourStep[] = [
  {
    id: "step-scenarios",
    targetSelector: '[data-tour="scenario-selector"]',
    fallbackTab: "demo",
    badge: "Step 1 of 5",
    title: "Choose a Pipeline Failure Scenario",
    description:
      "Select from 4 deterministic regression scenarios modeling real-world pipeline failures: upstream vendor drift, arithmetic formula mutation, join key dropouts, or null sentinel surges.",
  },
  {
    id: "step-run",
    targetSelector: '[data-tour="run-investigation"]',
    fallbackTab: "demo",
    badge: "Step 2 of 5",
    title: "Execute Forensic Investigation",
    description:
      "Run the full investigation. Data Rewind replays both baseline (clean) and faulted runs step-by-step through DuckDB and Parquet checkpoints, capturing structural hashes and row deltas.",
  },
  {
    id: "step-eod",
    targetSelector: '[data-tour="eod-card"]',
    fallbackTab: "investigate",
    badge: "Step 3 of 5",
    title: "Identify Earliest Observable Divergence (EOD)",
    description:
      "Data Rewind pinpoints the exact first DAG step where outputs deviated from baseline. Instead of guessing downstream, you know immediately where the failure originated.",
  },
  {
    id: "step-evidence",
    targetSelector: '[data-tour="evidence-panel"]',
    fallbackTab: "investigate",
    badge: "Step 4 of 5",
    title: "Inspect Evidence & Lineage Graph",
    description:
      "Examine row-level diff partitions (modified, added, removed) and trace downstream taint propagation across the pipeline dependency graph to measure the exact blast radius.",
  },
  {
    id: "step-verify",
    targetSelector: '[data-tour="verify-section"]',
    fallbackTab: "demo",
    badge: "Step 5 of 5",
    title: "Verify Candidate Fix with Tri-Run Evaluation",
    description:
      "Validate candidate patches across dual axes: Remediation (does the patch resolve the original failure?) and Baseline Equivalence (does it preserve all other expected outputs without regressions?).",
  },
];

const STORAGE_KEY = "data_rewind_tour_completed";

interface GuidedTourProps {
  activeTab: string;
  onNavigateTab: (tab: any) => void;
  isOpen: boolean;
  onClose: () => void;
}

export const GuidedTour: React.FC<GuidedTourProps> = ({
  activeTab,
  onNavigateTab,
  isOpen,
  onClose,
}) => {
  const [stepIndex, setStepIndex] = useState<number>(0);
  const popoverRef = useRef<HTMLDivElement>(null);

  const currentStep = TOUR_STEPS[stepIndex];

  // Update target positioning when step changes or window resizes
  const updatePosition = useCallback(() => {
    if (!isOpen || !currentStep) return;

    const el = document.querySelector(currentStep.targetSelector);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });

      // Add visual active class
      document.querySelectorAll(".tour-target-active").forEach((node) => {
        node.classList.remove("tour-target-active");
      });
      el.classList.add("tour-target-active");
    }
  }, [isOpen, currentStep]);

  useEffect(() => {
    if (!isOpen) {
      document.querySelectorAll(".tour-target-active").forEach((node) => {
        node.classList.remove("tour-target-active");
      });
      return;
    }

    // If step belongs to another tab, navigate there first
    if (currentStep && currentStep.fallbackTab && currentStep.fallbackTab !== activeTab) {
      onNavigateTab(currentStep.fallbackTab);
    }

    const timer = setTimeout(updatePosition, 300);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [isOpen, stepIndex, activeTab, currentStep, onNavigateTab, updatePosition]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleDismiss();
      } else if (e.key === "ArrowRight" || e.key === "Enter") {
        if (stepIndex < TOUR_STEPS.length - 1) {
          handleNext();
        } else {
          handleDismiss();
        }
      } else if (e.key === "ArrowLeft" && stepIndex > 0) {
        handlePrev();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, stepIndex]);

  const handleNext = () => {
    if (stepIndex < TOUR_STEPS.length - 1) {
      setStepIndex((prev) => prev + 1);
    } else {
      handleDismiss();
    }
  };

  const handlePrev = () => {
    if (stepIndex > 0) {
      setStepIndex((prev) => prev - 1);
    }
  };

  const handleDismiss = () => {
    try {
      localStorage.setItem(STORAGE_KEY, "true");
    } catch {
      // Ignore localStorage restrictions
    }
    document.querySelectorAll(".tour-target-active").forEach((node) => {
      node.classList.remove("tour-target-active");
    });
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tour-dialog-title"
    >
      <div
        ref={popoverRef}
        className="w-full max-w-lg bg-zinc-900 border border-zinc-700/80 rounded-xl p-6 shadow-2xl flex flex-col gap-5 text-zinc-100 font-sans animate-in fade-in zoom-in-95 duration-200"
      >
        {/* Header with Step Count & Close */}
        <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded text-xs font-mono font-bold bg-emerald-950 text-emerald-400 border border-emerald-800">
              {currentStep.badge}
            </span>
            <span className="text-xs font-mono text-zinc-400">Interactive Tour</span>
          </div>
          <button
            onClick={handleDismiss}
            className="text-zinc-400 hover:text-zinc-200 p-1 rounded hover:bg-zinc-800 transition-colors"
            aria-label="Close tour"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex flex-col gap-2">
          <h2 id="tour-dialog-title" className="text-lg font-bold text-zinc-100 flex items-center gap-2">
            <Compass className="w-5 h-5 text-emerald-400 flex-shrink-0" />
            {currentStep.title}
          </h2>
          <p className="text-sm text-zinc-300 leading-relaxed">
            {currentStep.description}
          </p>
        </div>

        {/* Step Indicators */}
        <div className="flex items-center justify-center gap-1.5 py-1">
          {TOUR_STEPS.map((step, idx) => (
            <button
              key={step.id}
              onClick={() => setStepIndex(idx)}
              className={`h-1.5 rounded-full transition-all ${
                idx === stepIndex
                  ? "w-6 bg-emerald-400"
                  : idx < stepIndex
                  ? "w-2 bg-emerald-800"
                  : "w-2 bg-zinc-700"
              }`}
              aria-label={`Jump to step ${idx + 1}: ${step.title}`}
            />
          ))}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between pt-2 border-t border-zinc-800">
          <button
            onClick={handleDismiss}
            className="text-xs font-medium text-zinc-400 hover:text-zinc-200 px-3 py-1.5 rounded hover:bg-zinc-800 transition-colors"
          >
            Skip Tour
          </button>

          <div className="flex items-center gap-2">
            {stepIndex > 0 && (
              <button
                onClick={handlePrev}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:text-zinc-100 bg-zinc-800 hover:bg-zinc-750 border border-zinc-700 rounded-lg transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Back
              </button>
            )}

            <button
              onClick={handleNext}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-zinc-950 bg-emerald-400 hover:bg-emerald-300 rounded-lg transition-colors shadow-sm"
            >
              {stepIndex === TOUR_STEPS.length - 1 ? (
                <>
                  <Check className="w-4 h-4" /> Finish Tour
                </>
              ) : (
                <>
                  Next <ArrowRight className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
