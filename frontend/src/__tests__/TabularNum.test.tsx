import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TabularNum } from "../components/TabularNum";

describe("TabularNum Component", () => {
  it("formats integers with locale grouping", () => {
    render(<TabularNum value={500000} format="integer" />);
    expect(screen.getByText("500,000")).toBeInTheDocument();
    expect(screen.getByText("500,000")).toHaveClass("tabular-nums");
  });

  it("formats byte sizes correctly", () => {
    const { rerender } = render(<TabularNum value={50000000} format="bytes" />);
    expect(screen.getByText("50.00 MB")).toBeInTheDocument();

    rerender(<TabularNum value={64000} format="bytes" />);
    expect(screen.getByText("64.0 KB")).toBeInTheDocument();
  });

  it("formats percentages correctly", () => {
    render(<TabularNum value={0.875} format="percentage" />);
    expect(screen.getByText("87.5%")).toBeInTheDocument();
  });

  it("handles null and undefined gracefully with em dash", () => {
    const { rerender } = render(<TabularNum value={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();

    rerender(<TabularNum value={undefined} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
