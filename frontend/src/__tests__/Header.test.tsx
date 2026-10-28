import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Header } from "../components/Header";
import { HealthResponse } from "../types/api";

const mockHealth: HealthResponse = {
  status: "ok",
  app_name: "Data Rewind",
  version: "0.1.0",
  profile: "local",
  limits: {
    max_raw_csv_bytes: 50000000,
    max_dataset_rows: 500000,
    max_column_count: 100,
    max_cell_length_chars: 4096,
    max_line_length_bytes: 65536,
    max_process_rss_mib: 512,
    duckdb_max_memory_mib: 256,
    step_timeout_seconds: 120,
  },
  free_disk_mb: 25000,
  rss_mib: 85.5,
};

describe("Header Component", () => {
  it("renders branding and connection status when connected", () => {
    render(
      <Header
        activeTab="demo"
        onTabChange={vi.fn()}
        health={mockHealth}
        healthLoading={false}
        onRefreshHealth={vi.fn()}
      />
    );

    expect(screen.getByText("DATA REWIND")).toBeInTheDocument();
    expect(screen.getByText("Understand the past. Verify the present.")).toBeInTheDocument();
    expect(screen.getByText("127.0.0.1:8000 (local)")).toBeInTheDocument();
  });

  it("renders disconnected warning when health is null", () => {
    render(
      <Header
        activeTab="demo"
        onTabChange={vi.fn()}
        health={null}
        healthLoading={false}
        onRefreshHealth={vi.fn()}
      />
    );

    expect(screen.getByText("Disconnected")).toBeInTheDocument();
    expect(screen.getByText(/Backend Disconnected — ensure Uvicorn is running/)).toBeInTheDocument();
  });

  it("handles tab switching clicks", () => {
    const handleTabChange = vi.fn();
    render(
      <Header
        activeTab="demo"
        onTabChange={handleTabChange}
        health={mockHealth}
        healthLoading={false}
        onRefreshHealth={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText("CSV Ingestion"));
    expect(handleTabChange).toHaveBeenCalledWith("csv");

    fireEvent.click(screen.getByText("Fix Verification"));
    expect(handleTabChange).toHaveBeenCalledWith("verify");
  });
});
