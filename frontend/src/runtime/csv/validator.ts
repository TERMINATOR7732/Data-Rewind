/**
 * Data Rewind CSV Ingestion Guardrails & Validator.
 * Enforces SPEC-MOD-01 & SPEC-MOD-07 dataset constraints:
 * - Max file size: 50 MB (50,000,000 bytes)
 * - Max rows: 500,000
 * - Max columns: 100
 * - Max cell length: 4,096 characters
 * - CSV only (rejects Excel or binary formats)
 * - Duplicate column detection
 * - RFC 4180 structure verification
 */

import { ERROR_CODES, RuntimeError } from "../contracts/errors";

export const CSV_CONSTRAINTS = {
  MAX_FILE_BYTES: 50_000_000, // 50 MB
  MAX_ROWS: 500_000,
  MAX_COLUMNS: 100,
  MAX_CELL_CHARS: 4_096,
  ALLOWED_EXTENSIONS: [".csv"],
  KNOWN_CSV_MIME_TYPES: [
    "text/csv",
    "text/plain",
    "application/csv",
    "application/x-csv",
    "text/x-csv",
    "text/comma-separated-values",
    "text/x-comma-separated-values",
  ],
} as const;

export interface ValidationProgress {
  rowsScanned: number;
  bytesScanned: number;
  percent: number;
}

export interface CsvValidationResult {
  valid: boolean;
  columnCount: number;
  columnNames: string[];
  estimatedRowCount: number;
  byteSize: number;
  delimiter: string;
}

export class CsvValidator {
  /**
   * Fast pre-flight check on file size, extension, and mime-type.
   */
  static validatePreflight(
    byteSize: number,
    fileName: string,
    mimeType?: string
  ): void {
    const name = fileName.toLowerCase();
    const hasValidExt = CSV_CONSTRAINTS.ALLOWED_EXTENSIONS.some((ext) =>
      name.endsWith(ext)
    );
    if (!hasValidExt) {
      throw new RuntimeError(
        ERROR_CODES.CSV_INVALID_FILE_TYPE,
        `Invalid file extension '${fileName}'. Only RFC 4180 CSV (.csv) files are supported.`,
        { filename: fileName, extension: name.split(".").pop() },
        "Please select a valid CSV file with .csv extension."
      );
    }

    if (
      mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      mimeType === "application/vnd.ms-excel"
    ) {
      throw new RuntimeError(
        ERROR_CODES.CSV_INVALID_FILE_TYPE,
        "Excel (.xlsx/.xls) files are not supported in Data Rewind v1.0. Please export as CSV.",
        { mimeType },
        "Export your workbook as an RFC 4180 CSV file and re-upload."
      );
    }

    if (byteSize > CSV_CONSTRAINTS.MAX_FILE_BYTES) {
      throw new RuntimeError(
        ERROR_CODES.CSV_FILE_TOO_LARGE,
        `File size (${(byteSize / 1_000_000).toFixed(2)} MB) exceeds the maximum allowed limit of 50 MB.`,
        { fileSize: byteSize, maxSizeBytes: CSV_CONSTRAINTS.MAX_FILE_BYTES },
        "Reduce dataset size or filter rows prior to ingestion."
      );
    }

    if (byteSize === 0) {
      throw new RuntimeError(
        ERROR_CODES.CSV_MALFORMED,
        "The supplied CSV file is empty (0 bytes).",
        { fileSize: 0 },
        "Provide a non-empty CSV file containing at least a header row and data rows."
      );
    }
  }

  static validatePreFlight = CsvValidator.validatePreflight;

  /**
   * Fast pre-flight check on File object before reading data.
   */
  static validateFilePreFlight(file: File): void {
    CsvValidator.validatePreFlight(file.size, file.name, file.type);
  }

  /**
   * Validates header columns: checks count <= 100, detects duplicates, detects empty names.
   */
  static validateHeader(headers: string[]): void {
    if (headers.length === 0) {
      throw new RuntimeError(
        ERROR_CODES.CSV_MALFORMED,
        "CSV header row is empty or could not be detected.",
        undefined,
        "Ensure the CSV file begins with a valid header row."
      );
    }

    if (headers.length > CSV_CONSTRAINTS.MAX_COLUMNS) {
      throw new RuntimeError(
        ERROR_CODES.CSV_MAX_COLUMNS_EXCEEDED,
        `CSV contains ${headers.length} columns, exceeding the maximum allowed limit of ${CSV_CONSTRAINTS.MAX_COLUMNS}.`,
        { columnCount: headers.length, maxColumns: CSV_CONSTRAINTS.MAX_COLUMNS },
        `Restrict input dataset to at most ${CSV_CONSTRAINTS.MAX_COLUMNS} columns.`
      );
    }

    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (let i = 0; i < headers.length; i++) {
      const col = headers[i];
      if (col === undefined || col.trim() === "") {
        throw new RuntimeError(
          ERROR_CODES.CSV_EMPTY_COLUMN_NAME,
          `Column at index ${i} has an empty or whitespace-only name.`,
          { columnIndex: i },
          "Provide distinct, non-empty column names for all headers."
        );
      }
      if (seen.has(col)) {
        duplicates.push(col);
      } else {
        seen.add(col);
      }
    }

    if (duplicates.length > 0) {
      throw new RuntimeError(
        ERROR_CODES.CSV_DUPLICATE_COLUMNS,
        `Duplicate column names detected: ${[...new Set(duplicates)].join(", ")}.`,
        { duplicateColumns: [...new Set(duplicates)] },
        "Rename duplicate columns so every header is unique."
      );
    }
  }

  /**
   * Validates a single row against schema constraints (column count, max cell length).
   */
  static validateRow(
    row: string[],
    rowIndex: number,
    expectedColumnCount: number
  ): void {
    if (row.length !== expectedColumnCount) {
      throw new RuntimeError(
        ERROR_CODES.CSV_MALFORMED,
        `Row ${rowIndex} has ${row.length} columns, but header defines ${expectedColumnCount} columns.`,
        { rowIndex, expectedColumnCount, actualColumnCount: row.length },
        "Check for unquoted commas or unescaped quotes on this row."
      );
    }

    for (let c = 0; c < row.length; c++) {
      const cell = row[c];
      if (cell && cell.length > CSV_CONSTRAINTS.MAX_CELL_CHARS) {
        throw new RuntimeError(
          ERROR_CODES.CSV_OVERSIZED_CELL,
          `Cell at row ${rowIndex}, column index ${c} (${cell.length} characters) exceeds the 4,096 character limit.`,
          {
            rowIndex,
            columnIndex: c,
            cellLength: cell.length,
            maxCellLength: CSV_CONSTRAINTS.MAX_CELL_CHARS,
          },
          "Truncate or clean oversized cell text prior to ingestion."
        );
      }
    }
  }
}
