import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DiffTable } from "../components/DiffTable";
import { StepDiffPage, TabularDiffResult } from "../types/api";

const mockDiffSummary: TabularDiffResult = {
  is_equal: false,
  case_classifications: ["CASE_1_KEYED_PK"],
  schema_diff: {
    added_columns: [],
    removed_columns: [],
    common_columns: ["id", "val"],
    type_changes: {},
    has_breaking_type_drift: false,
  },
  baseline_fingerprint: {
    schema_hash: "hash_s1",
    multiset_hash: "hash_m1",
    row_count: 2,
    fingerprint_hash: "hash_f1",
  },
  target_fingerprint: {
    schema_hash: "hash_s2",
    multiset_hash: "hash_m2",
    row_count: 2,
    fingerprint_hash: "hash_f2",
  },
  identical_count: 1,
  modified_count: 1,
  added_count: 0,
  removed_count: 0,
  baseline_row_count: 2,
  target_row_count: 2,
  warnings: [],
  execution_duration_ms: 1.2,
};

const mockDiffPage: StepDiffPage = {
  step_id: "test_step",
  filter_status: "ALL",
  total_matching_rows: 2,
  page: 1,
  page_size: 50,
  total_pages: 1,
  columns: ["id", "val"],
  primary_keys: ["id"],
  rows: [
    {
      _diff_status: "MODIFIED",
      _key_values: { id: 101 },
      id: 101,
      val: 200,
      _field_diffs: [
        {
          column: "val",
          baseline_value: 100,
          target_value: 200,
          is_numeric_tolerant_match: false,
          is_null_transition: false,
          is_numeric_corruption: false,
        },
      ],
    },
    {
      _diff_status: "IDENTICAL",
      _key_values: { id: 102 },
      id: 102,
      val: 50,
      _field_diffs: [],
    },
  ],
};

describe("DiffTable Component", () => {
  it("renders row diffs with pinned primary key and drift highlights", () => {
    render(
      <DiffTable
        stepId="test_step"
        diffSummary={mockDiffSummary}
        diffPage={mockDiffPage}
        loading={false}
        onFilterChange={vi.fn()}
      />
    );

    expect(screen.getByText("PK: id")).toBeInTheDocument();
    expect(screen.getByText("MODIFIED")).toBeInTheDocument();
    expect(screen.getByText("IDENTICAL")).toBeInTheDocument();
    expect(screen.getByText("200")).toBeInTheDocument();
    expect(screen.getByText("100")).toBeInTheDocument(); // baseline value struck through
  });

  it("triggers filter callback when clicking status pills", () => {
    const handleFilterChange = vi.fn();
    render(
      <DiffTable
        stepId="test_step"
        diffSummary={mockDiffSummary}
        diffPage={mockDiffPage}
        loading={false}
        onFilterChange={handleFilterChange}
      />
    );

    fireEvent.click(screen.getByText("Modified"));
    expect(handleFilterChange).toHaveBeenCalledWith("MODIFIED", 1);
  });
});
