/**
 * Data Rewind — In-Browser Paged Diff Service
 * Provides in-memory filtering and pagination over RowDiff results for the DiffTable UI.
 */

import { RowDiff } from "../contracts";
import { StepDiffPage } from "../../../types/api";

export interface PagedDiffOptions {
  stepId: string;
  rows: RowDiff[];
  columns: string[];
  primaryKeys: string[];
  filterStatus?: string;
  page?: number;
  pageSize?: number;
}

export class PagedDiffService {
  /**
   * Filter and paginate row diffs.
   */
  public static getPage(options: PagedDiffOptions): StepDiffPage {
    const {
      stepId,
      rows,
      columns,
      primaryKeys,
      filterStatus = "ALL",
      page = 1,
      pageSize = 50,
    } = options;

    const normalizedFilter = filterStatus.toUpperCase();

    // Filter rows by _diff_status or category
    const filtered = rows.filter((r) => {
      const status = (r._diff_status || r.category || "").toUpperCase();
      if (normalizedFilter === "ALL") return true;
      if (normalizedFilter === "MODIFIED") return status === "MODIFIED";
      if (normalizedFilter === "ADDED") return status === "ADDED";
      if (normalizedFilter === "REMOVED") return status === "REMOVED";
      if (normalizedFilter === "IDENTICAL") return status === "IDENTICAL";
      return true;
    });

    const totalMatching = filtered.length;
    const safePageSize = Math.max(1, pageSize);
    const totalPages = Math.max(1, Math.ceil(totalMatching / safePageSize));
    const safePage = Math.min(Math.max(1, page), totalPages);

    const startIndex = (safePage - 1) * safePageSize;
    const pagedRows = filtered.slice(startIndex, startIndex + safePageSize);

    return {
      step_id: stepId,
      filter_status: normalizedFilter,
      total_matching_rows: totalMatching,
      page: safePage,
      page_size: safePageSize,
      total_pages: totalPages,
      columns,
      primary_keys: primaryKeys,
      rows: pagedRows,
    };
  }
}
