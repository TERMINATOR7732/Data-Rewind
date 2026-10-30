/**
 * Data Rewind CSV Forensic Exporter.
 * Conforms strictly to SPEC-MOD-05 §2.2.
 *
 * Implements type-aware formula injection defense for spreadsheet applications,
 * with support for both Spreadsheet-Safe mode and Raw Export mode.
 */

import { CSVFormulaEscaper } from "./formula-escaper";

export interface CSVExportOptions {
  mode?: "safe" | "raw";
  includeHeaderComment?: boolean;
  columnTypes?: Record<string, string>; // colName -> DataType string
}

export class CSVExporter {
  /**
   * Export an array of tabular objects to RFC 4180 CSV string.
   */
  static exportRows(
    rows: Record<string, unknown>[],
    columns?: string[],
    options: CSVExportOptions = {}
  ): { csvContent: string; escapedCount: number } {
    const mode = options.mode || "safe";
    const colTypes = options.columnTypes || {};

    if (rows.length === 0) {
      const headerLine = (columns || []).join(",");
      return { csvContent: headerLine ? `${headerLine}\n` : "", escapedCount: 0 };
    }

    const cols = columns || Object.keys(rows[0]);
    const lines: string[] = [];
    let totalEscaped = 0;

    // Optional advisory comment header
    if (options.includeHeaderComment && mode === "safe") {
      lines.push("# Exported by Data Rewind with Type-Aware Spreadsheet-Safe Formula Protection");
    } else if (options.includeHeaderComment && mode === "raw") {
      lines.push("# WARNING: Raw Export Mode - Leading formula triggers (=, +, -, @) are NOT escaped");
    }

    // CSV Header line
    lines.push(CSVFormulaEscaper.formatCsvRow(cols));

    // Data lines
    for (const row of rows) {
      const rowValues: string[] = [];
      for (const col of cols) {
        const val = row[col];
        const type = colTypes[col];
        const [sanitized, escaped] = CSVFormulaEscaper.sanitizeCell(val, type, mode);
        if (escaped) totalEscaped++;
        rowValues.push(sanitized);
      }
      lines.push(CSVFormulaEscaper.formatCsvRow(rowValues));
    }

    return {
      csvContent: lines.join("\n") + "\n",
      escapedCount: totalEscaped,
    };
  }
}
