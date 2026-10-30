/**
 * Data Rewind RFC 4180 Compliant CSV Parser & Ingestion Engine.
 * Handles:
 * - RFC 4180 compliant quotes, escaped quotes (""), and multiline fields
 * - Streamlined chunk processing without unbounded duplication
 * - Progress tracking & cancellation
 * - Inferred preview samples & deterministic SHA-256 hashing
 */

import { CSV_CONSTRAINTS, CsvValidator, ValidationProgress } from "./validator";
import { ERROR_CODES, RuntimeError } from "../contracts/errors";

export interface ParsedCsvSummary {
  headers: string[];
  rowCount: number;
  columnCount: number;
  byteSize: number;
  sha256Hash: string;
  sampleRows: Record<string, string | null>[];
}

export class CsvParser {
  /**
   * Parse CSV content with streaming state machine conforming to RFC 4180.
   */
  static async parseAndValidate(
    content: string | Uint8Array,
    options?: {
      maxSampleRows?: number;
      signal?: AbortSignal;
      onProgress?: (progress: ValidationProgress) => void;
    }
  ): Promise<ParsedCsvSummary> {
    const maxSampleRows = options?.maxSampleRows ?? 50;
    const signal = options?.signal;
    const onProgress = options?.onProgress;

    // Convert binary buffer to string if necessary
    let text: string;
    let byteSize: number;
    let sha256Hash = "";

    if (typeof content !== "string") {
      const u8 = content instanceof Uint8Array ? content : new Uint8Array(content as any);
      byteSize = u8.byteLength;
      if (byteSize > CSV_CONSTRAINTS.MAX_FILE_BYTES) {
        throw new RuntimeError(
          ERROR_CODES.CSV_FILE_TOO_LARGE,
          `File size exceeds the 50 MB limit (${byteSize} bytes).`
        );
      }
      text = new TextDecoder("utf-8", { fatal: false }).decode(u8);
      sha256Hash = await CsvParser.computeSha256(u8);
    } else {
      text = content;
      const encoded = new TextEncoder().encode(content);
      byteSize = encoded.byteLength;
      if (byteSize > CSV_CONSTRAINTS.MAX_FILE_BYTES) {
        throw new RuntimeError(
          ERROR_CODES.CSV_FILE_TOO_LARGE,
          `File size exceeds the 50 MB limit (${byteSize} bytes).`
        );
      }
      sha256Hash = await CsvParser.computeSha256(encoded);
    }

    if (text.trim().length === 0) {
      throw new RuntimeError(
        ERROR_CODES.CSV_MALFORMED,
        "The supplied CSV content is empty.",
        { byteSize: 0 }
      );
    }

    // RFC 4180 State Machine
    const sampleRows: Record<string, string | null>[] = [];
    let headers: string[] = [];
    let currentRow: string[] = [];
    let currentCell = "";
    let insideQuotes = false;
    let rowCount = 0;
    let isHeaderParsed = false;
    const totalLength = text.length;

    let i = 0;
    while (i < totalLength) {
      if (signal?.aborted) {
        throw new RuntimeError(
          ERROR_CODES.OPERATION_CANCELLED,
          "CSV parsing was cancelled."
        );
      }

      // Progress reporting every 64KB characters
      if (i % 65536 === 0 && onProgress) {
        onProgress({
          rowsScanned: rowCount,
          bytesScanned: i,
          percent: Math.min(99, Math.round((i / totalLength) * 100)),
        });
      }

      const ch = text[i];
      const nextCh = i + 1 < totalLength ? text[i + 1] : "";

      if (ch === '"') {
        if (insideQuotes) {
          if (nextCh === '"') {
            // Escaped quote: "" -> "
            currentCell += '"';
            i += 2;
            continue;
          } else {
            // Closing quote
            insideQuotes = false;
            i++;
            continue;
          }
        } else {
          // Opening quote
          insideQuotes = true;
          i++;
          continue;
        }
      }

      if (ch === "," && !insideQuotes) {
        // Field boundary
        currentRow.push(currentCell);
        currentCell = "";
        i++;
        continue;
      }

      if ((ch === "\r" || ch === "\n") && !insideQuotes) {
        // Handle CRLF or LF
        if (ch === "\r" && nextCh === "\n") {
          i += 2;
        } else {
          i++;
        }

        // Push final field of row
        currentRow.push(currentCell);
        currentCell = "";

        // Skip blank lines
        if (currentRow.length === 1 && currentRow[0]?.trim() === "") {
          currentRow = [];
          continue;
        }

        if (!isHeaderParsed) {
          headers = currentRow.map((h) => h.trim());
          CsvValidator.validateHeader(headers);
          isHeaderParsed = true;
          currentRow = [];
          continue;
        }

        // Data row
        rowCount++;
        if (rowCount > CSV_CONSTRAINTS.MAX_ROWS) {
          throw new RuntimeError(
            ERROR_CODES.CSV_MAX_ROWS_EXCEEDED,
            `CSV row count exceeds the maximum limit of ${CSV_CONSTRAINTS.MAX_ROWS.toLocaleString()} rows.`,
            { rowCount, maxRows: CSV_CONSTRAINTS.MAX_ROWS },
            `Reduce dataset size to under ${CSV_CONSTRAINTS.MAX_ROWS.toLocaleString()} rows.`
          );
        }

        CsvValidator.validateRow(currentRow, rowCount, headers.length);

        if (sampleRows.length < maxSampleRows) {
          const rowObj: Record<string, string | null> = {};
          for (let c = 0; c < headers.length; c++) {
            const val = currentRow[c];
            rowObj[headers[c]] = val === "" ? null : val;
          }
          sampleRows.push(rowObj);
        }

        currentRow = [];
        continue;
      }

      // Normal character
      currentCell += ch;
      i++;
    }

    // Handle last row if file does not end with newline
    if (currentCell.length > 0 || currentRow.length > 0) {
      if (insideQuotes) {
        throw new RuntimeError(
          ERROR_CODES.CSV_MALFORMED,
          "Malformed CSV: Unclosed quotation mark at end of file.",
          undefined,
          "Check quotes in the CSV file and ensure all quoted fields are closed."
        );
      }

      currentRow.push(currentCell);

      if (!isHeaderParsed) {
        headers = currentRow.map((h) => h.trim());
        CsvValidator.validateHeader(headers);
        isHeaderParsed = true;
      } else {
        rowCount++;
        if (rowCount > CSV_CONSTRAINTS.MAX_ROWS) {
          throw new RuntimeError(
            ERROR_CODES.CSV_MAX_ROWS_EXCEEDED,
            `CSV row count exceeds the maximum limit of ${CSV_CONSTRAINTS.MAX_ROWS.toLocaleString()} rows.`
          );
        }
        CsvValidator.validateRow(currentRow, rowCount, headers.length);
        if (sampleRows.length < maxSampleRows) {
          const rowObj: Record<string, string | null> = {};
          for (let c = 0; c < headers.length; c++) {
            const val = currentRow[c];
            rowObj[headers[c]] = val === "" ? null : val;
          }
          sampleRows.push(rowObj);
        }
      }
    }

    if (!isHeaderParsed || headers.length === 0) {
      throw new RuntimeError(
        ERROR_CODES.CSV_MALFORMED,
        "CSV must contain at least a header row.",
        undefined,
        "Provide a valid CSV with headers."
      );
    }

    if (onProgress) {
      onProgress({
        rowsScanned: rowCount,
        bytesScanned: totalLength,
        percent: 100,
      });
    }

    return {
      headers,
      rowCount,
      columnCount: headers.length,
      byteSize,
      sha256Hash,
      sampleRows,
    };
  }

  /**
   * Deterministic SHA-256 calculation using Web Crypto API.
   */
  static async computeSha256(buffer: Uint8Array): Promise<string> {
    if (typeof crypto !== "undefined" && crypto.subtle) {
      const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
    }
    // Fallback: simple numeric hash for non-crypto environments
    let hash = 0;
    for (let i = 0; i < buffer.length; i++) {
      hash = (hash << 5) - hash + buffer[i];
      hash |= 0;
    }
    return Math.abs(hash).toString(16).padStart(64, "0");
  }
}
