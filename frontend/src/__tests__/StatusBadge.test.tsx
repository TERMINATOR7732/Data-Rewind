import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusBadge } from "../components/StatusBadge";

describe("StatusBadge Component", () => {
  it("renders VERIFIED_CLEAN with emerald styling", () => {
    render(<StatusBadge status="VERIFIED_CLEAN" />);
    const badge = screen.getByRole("status");
    expect(badge).toHaveTextContent("VERIFIED CLEAN");
    expect(badge).toHaveClass("bg-emerald-950/80");
  });

  it("renders NEW_FAULT_INTRODUCED with rose styling and pulse icon", () => {
    render(<StatusBadge status="NEW_FAULT_INTRODUCED" />);
    const badge = screen.getByRole("status");
    expect(badge).toHaveTextContent("NEW FAULT INTRODUCED");
    expect(badge).toHaveClass("bg-rose-950/90");
  });

  it("renders INTENTIONAL_UPDATE correctly", () => {
    render(<StatusBadge status="INTENTIONAL_UPDATE" />);
    const badge = screen.getByRole("status");
    expect(badge).toHaveTextContent("INTENTIONAL UPDATE");
    expect(badge).toHaveClass("bg-sky-950/80");
  });

  it("renders PARTIAL_RESTORATION with amber styling", () => {
    render(<StatusBadge status="PARTIAL_RESTORATION" />);
    const badge = screen.getByRole("status");
    expect(badge).toHaveTextContent("PARTIAL RESTORATION");
    expect(badge).toHaveClass("bg-amber-950/80");
  });

  it("renders diff categories IDENTICAL and MODIFIED", () => {
    const { rerender } = render(<StatusBadge status="IDENTICAL" />);
    expect(screen.getByRole("status")).toHaveTextContent("IDENTICAL");

    rerender(<StatusBadge status="MODIFIED" />);
    expect(screen.getByRole("status")).toHaveTextContent("MODIFIED");
  });
});
