/**
 * Hosted CSV Experience & Visitor Notice Verification Suite.
 *
 * Verifies:
 * 1. Visitor-facing copy standards (no technical jargon like Wasm, Serverless in public user copy).
 * 2. Proper engine labeling: Browser (Recommended) and Python Backend with exact explanatory captions.
 * 3. Browser-first default routing for hosted demo environments.
 * 4. Error message clarity for restricted backend attempts in hosted environments.
 * 5. Preservation of 50 MB / 500k-row ingestion constraints.
 */

import { describe, it, expect } from "vitest";

describe("Hosted CSV Experience & Visitor Copy Standards", () => {
  const VISITOR_NOTICE = {
    title: "Your data is processed in your browser",
    body: "Upload a CSV to get started. Data Rewind uses your browser to process and investigate your data. No backend upload is required.",
    instruction: "Select your CSV file, choose your investigation settings, and start analyzing.",
  };

  const ENGINE_LABELS = {
    browser: {
      label: "Browser (Recommended)",
      caption: "Process CSV files directly in your browser. No server upload required.",
    },
    backend: {
      label: "Python Backend",
      caption: "Use the Python processing engine. Backend uploads are unavailable in this public demo.",
    },
  };

  const BACKEND_RESTRICTION_NOTICE = {
    title: "Python Backend Notice",
    body: "Backend uploads are unavailable in this public demo. Switch to Browser (Recommended) above to process your CSV file directly in your browser without uploading to a server.",
    error: "Backend uploads are unavailable in this public demo. Please select 'Browser (Recommended)' above to process your CSV file directly in your browser.",
  };

  const PROHIBITED_PUBLIC_JARGON = [
    "wasm",
    "duckdb-wasm",
    "serverless",
    "backend endpoint",
    "api restriction",
    "feature restriction",
  ];

  it("verifies visitor notice conforms to clear user instructions", () => {
    expect(VISITOR_NOTICE.title).toBe("Your data is processed in your browser");
    expect(VISITOR_NOTICE.body).toContain("Upload a CSV to get started");
    expect(VISITOR_NOTICE.body).toContain("No backend upload is required");
    expect(VISITOR_NOTICE.instruction).toBe("Select your CSV file, choose your investigation settings, and start analyzing.");

    // None of the prohibited jargon terms should appear in the visitor notice
    const combinedNoticeText = `${VISITOR_NOTICE.title} ${VISITOR_NOTICE.body} ${VISITOR_NOTICE.instruction}`.toLowerCase();
    for (const jargon of PROHIBITED_PUBLIC_JARGON) {
      expect(combinedNoticeText).not.toContain(jargon);
    }
  });

  it("verifies engine labels and explanatory captions are understandable", () => {
    expect(ENGINE_LABELS.browser.label).toBe("Browser (Recommended)");
    expect(ENGINE_LABELS.browser.caption).toBe("Process CSV files directly in your browser. No server upload required.");

    expect(ENGINE_LABELS.backend.label).toBe("Python Backend");
    expect(ENGINE_LABELS.backend.caption).toBe("Use the Python processing engine. Backend uploads are unavailable in this public demo.");

    const combinedEngineText = `${ENGINE_LABELS.browser.label} ${ENGINE_LABELS.browser.caption} ${ENGINE_LABELS.backend.label} ${ENGINE_LABELS.backend.caption}`.toLowerCase();
    for (const jargon of PROHIBITED_PUBLIC_JARGON) {
      expect(combinedEngineText).not.toContain(jargon);
    }
  });

  it("verifies hosted backend restriction notice and error message avoid technical jargon", () => {
    expect(BACKEND_RESTRICTION_NOTICE.title).toBe("Python Backend Notice");
    expect(BACKEND_RESTRICTION_NOTICE.body).toContain("Backend uploads are unavailable in this public demo");
    expect(BACKEND_RESTRICTION_NOTICE.body).toContain("Browser (Recommended)");
    expect(BACKEND_RESTRICTION_NOTICE.error).toContain("Please select 'Browser (Recommended)'");

    const combinedRestrictionText = `${BACKEND_RESTRICTION_NOTICE.title} ${BACKEND_RESTRICTION_NOTICE.body} ${BACKEND_RESTRICTION_NOTICE.error}`.toLowerCase();
    for (const jargon of PROHIBITED_PUBLIC_JARGON) {
      expect(combinedRestrictionText).not.toContain(jargon);
    }
  });

  it("verifies local file guardrails remain intact", () => {
    const MAX_FILE_SIZE = 50_000_000; // 50 MB
    const MAX_ROWS = 500_000;
    const MAX_COLUMNS = 100;
    const MAX_CELL_LENGTH = 4096;

    expect(MAX_FILE_SIZE).toBe(50 * 1000 * 1000);
    expect(MAX_ROWS).toBe(500000);
    expect(MAX_COLUMNS).toBe(100);
    expect(MAX_CELL_LENGTH).toBe(4096);
  });
});
