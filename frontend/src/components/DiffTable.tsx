import React, { useState } from "react";
import { ChevronLeft, ChevronRight, Filter, Search } from "lucide-react";
import { StepDiffPage, TabularDiffResult } from "../types/api";
import { StatusBadge } from "./StatusBadge";
import { TabularNum } from "./TabularNum";

interface DiffTableProps {
  stepId: string;
  diffSummary?: TabularDiffResult;
  diffPage: StepDiffPage | null;
  loading: boolean;
  onFilterChange: (status: string, page: number) => void;
}

export const DiffTable: React.FC<DiffTableProps> = ({
  stepId,
  diffSummary,
  diffPage,
  loading,
  onFilterChange,
}) => {
  const [activeFilter, setActiveFilter] = useState<string>("ALL");
  const [searchTerm, setSearchTerm] = useState<string>("");

  const handleFilterClick = (status: string) => {
    setActiveFilter(status);
    onFilterChange(status, 1);
  };

  const handlePageChange = (newPage: number) => {
    onFilterChange(activeFilter, newPage);
  };

  const filterTabs = [
    { id: "ALL", label: "All Rows", count: diffSummary ? diffSummary.target_row_count : undefined },
    { id: "MODIFIED", label: "Modified", count: diffSummary?.modified_count },
    { id: "ADDED", label: "Added", count: diffSummary?.added_count },
    { id: "REMOVED", label: "Removed", count: diffSummary?.removed_count },
    { id: "IDENTICAL", label: "Identical", count: diffSummary?.identical_count },
  ];

  const columns = diffPage?.columns || [];
  const primaryKeys = diffPage?.primary_keys || [];
  const rows = diffPage?.rows || [];

  const filteredRows = rows.filter((r) => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return Object.values(r).some((val) => String(val).toLowerCase().includes(term));
  });

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden flex flex-col h-full shadow-lg">
      {/* Top Controls: Filter Pills & Search */}
      <div className="p-4 border-b border-zinc-800 bg-zinc-900/80 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-zinc-400 font-mono mr-1 flex items-center gap-1">
            <Filter className="w-3.5 h-3.5" /> Filter:
          </span>
          {filterTabs.map((tab) => {
            const active = activeFilter === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => handleFilterClick(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-mono transition-colors ${
                  active
                    ? "bg-zinc-800 text-zinc-100 border border-zinc-700 shadow-sm"
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850"
                }`}
              >
                <span>{tab.label}</span>
                {tab.count !== undefined && (
                  <span
                    className={`px-1.5 py-0.2 rounded text-[10px] ${
                      active ? "bg-zinc-700 text-zinc-200" : "bg-zinc-800 text-zinc-400"
                    }`}
                  >
                    <TabularNum value={tab.count} />
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Search Input */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-2.5" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search rows..."
            className="bg-zinc-950 border border-zinc-800 text-xs text-zinc-200 pl-8 pr-3 py-1.5 rounded w-48 sm:w-64 focus:outline-none focus:border-emerald-600 font-mono"
          />
        </div>
      </div>

      {/* Table Container */}
      <div className="flex-1 overflow-auto relative min-h-[300px]">
        {loading ? (
          <div className="absolute inset-0 bg-zinc-950/60 backdrop-blur-xs flex items-center justify-center z-10">
            <div className="flex items-center gap-3 text-zinc-400 text-xs font-mono">
              <span className="w-3 h-3 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
              Loading row diffs for step <code className="text-zinc-200">{stepId}</code>...
            </div>
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center p-8 text-center text-zinc-500">
            <p className="text-sm font-mono">No rows match the current diff filter ({activeFilter}).</p>
            {activeFilter !== "ALL" && (
              <button
                onClick={() => handleFilterClick("ALL")}
                className="mt-3 text-xs text-emerald-400 hover:underline font-mono"
              >
                Reset filter to view all rows
              </button>
            )}
          </div>
        ) : (
          <table className="w-full text-left text-xs border-collapse">
            <thead className="sticky top-0 bg-zinc-950 text-zinc-400 border-b border-zinc-800 font-mono select-none z-10 shadow-sm">
              <tr>
                <th className="py-2.5 px-3 font-semibold text-zinc-400 w-28 bg-zinc-950">Diff Status</th>
                {primaryKeys.map((pk) => (
                  <th
                    key={pk}
                    className="py-2.5 px-3 font-semibold text-emerald-400 border-r border-zinc-800 bg-zinc-950/90 sticky left-0"
                  >
                    PK: {pk}
                  </th>
                ))}
                {columns
                  .filter((c) => !primaryKeys.includes(c))
                  .map((col) => (
                    <th key={col} className="py-2.5 px-3 font-semibold text-zinc-300">
                      {col}
                    </th>
                  ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60 font-mono">
              {filteredRows.map((row, idx) => {
                const diffStatus = row._diff_status;
                const fieldDiffs = row._field_diffs || [];
                const diffMap = new Map(fieldDiffs.map((fd) => [fd.column, fd]));

                return (
                  <tr
                    key={idx}
                    className={`hover:bg-zinc-800/40 transition-colors ${
                      diffStatus === "MODIFIED"
                        ? "bg-amber-950/15"
                        : diffStatus === "ADDED"
                        ? "bg-sky-950/15"
                        : diffStatus === "REMOVED"
                        ? "bg-rose-950/15 line-through opacity-75"
                        : ""
                    }`}
                  >
                    <td className="py-2 px-3 whitespace-nowrap">
                      <StatusBadge status={diffStatus} size="sm" />
                    </td>

                    {/* Primary Key Columns (Sticky) */}
                    {primaryKeys.map((pk) => {
                      const val = row[pk] ?? row._key_values?.[pk];
                      return (
                        <td
                          key={pk}
                          className="py-2 px-3 font-bold text-zinc-200 border-r border-zinc-800/80 bg-zinc-900/90 whitespace-nowrap sticky left-0"
                        >
                          {String(val ?? "—")}
                        </td>
                      );
                    })}

                    {/* Non-Key Columns */}
                    {columns
                      .filter((c) => !primaryKeys.includes(c))
                      .map((col) => {
                        const cellVal = row[col];
                        const drift = diffMap.get(col);

                        if (drift) {
                          return (
                            <td
                              key={col}
                              className="py-2 px-3 bg-amber-950/40 border border-amber-800/60 rounded text-amber-200"
                              title={`Drifted: Baseline was '${drift.baseline_value}', Target is '${drift.target_value}'`}
                            >
                              <div className="flex flex-col">
                                <span className="font-semibold text-amber-100">{String(cellVal ?? "NULL")}</span>
                                <span className="text-[10px] text-zinc-400 line-through">
                                  {String(drift.baseline_value ?? "NULL")}
                                </span>
                              </div>
                            </td>
                          );
                        }

                        return (
                          <td key={col} className="py-2 px-3 text-zinc-300 whitespace-nowrap">
                            {cellVal === null || cellVal === undefined ? (
                              <span className="text-zinc-600">NULL</span>
                            ) : (
                              String(cellVal)
                            )}
                          </td>
                        );
                      })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination Footer */}
      {diffPage && diffPage.total_pages > 1 && (
        <div className="p-3 border-t border-zinc-800 bg-zinc-950 flex items-center justify-between text-xs font-mono text-zinc-400">
          <div>
            Showing rows <TabularNum value={(diffPage.page - 1) * diffPage.page_size + 1} /> -{" "}
            <TabularNum value={Math.min(diffPage.page * diffPage.page_size, diffPage.total_matching_rows)} /> of{" "}
            <TabularNum value={diffPage.total_matching_rows} />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handlePageChange(diffPage.page - 1)}
              disabled={diffPage.page <= 1 || loading}
              className="p-1 rounded bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed"
              title="Previous Page"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span>
              Page <TabularNum value={diffPage.page} /> / <TabularNum value={diffPage.total_pages} />
            </span>
            <button
              onClick={() => handlePageChange(diffPage.page + 1)}
              disabled={diffPage.page >= diffPage.total_pages || loading}
              className="p-1 rounded bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed"
              title="Next Page"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
