/**
 * Data Rewind Type-Aware Formula-Injection Sanitizer.
 * Conforms strictly to SPEC-MOD-05 §2.2.
 *
 * Prevents formula injection (CSV Injection / Formula Injection) in spreadsheet software (Excel, LibreOffice, Google Sheets)
 * while preserving legitimate negative and positive numeric values.
 */

export const DANGEROUS_FORMULA_PREFIXES = ["=", "+", "-", "@", "\t", "\r"] as const;

export class CSVFormulaEscaper {
  /**
   * Sanitize an individual tabular cell according to the type-aware policy.
   *
   * @param value The raw cell value
   * @param colType Column data type (e.g. "INTEGER", "FLOAT", "STRING")
   * @param exportMode "safe" (default, spreadsheet-neutralized) or "raw" (exact bit preservation)
   * @returns [sanitizedValue, wasEscaped]
   */
  static sanitizeCell(
    value: unknown,
    colType?: string | null,
    exportMode: "safe" | "raw" = "safe"
  ): [string, boolean] {
    // SQL NULL / undefined is always exported as an empty unquoted field
    if (value === null || value === undefined) {
      return ["", false];
    }

    const valStr = String(value);

    // Raw Data Export Mode: bit-for-bit logical value preservation
    if (exportMode === "raw") {
      return [valStr, false];
    }

    // Mode: Spreadsheet-Safe Export Mode
    // Rule 1: Numeric Preservation Rule - INTEGER and FLOAT columns are NEVER prefixed
    if (colType) {
      const typeStr = colType.toUpperCase();
      if (
        typeStr === "INTEGER" ||
        typeStr === "FLOAT" ||
        typeStr === "INT" ||
        typeStr === "DOUBLE" ||
        typeStr === "BIGINT" ||
        typeStr === "SMALLINT" ||
        typeStr === "TINYINT" ||
        typeStr === "NUMERIC" ||
        typeStr === "DECIMAL"
      ) {
        return [valStr, false];
      }
    }

    // Rule 2: Untrusted String / Text Sanitization Rule
    const stripped = valStr.trimStart();
    if (!stripped) {
      return [valStr, false];
    }

    const rawFirst = valStr[0] || "";
    const firstChar = stripped[0];

    const isRawDangerous = (DANGEROUS_FORMULA_PREFIXES as readonly string[]).includes(rawFirst);
    const isStrippedDangerous = (DANGEROUS_FORMULA_PREFIXES as readonly string[]).includes(firstChar);

    if (isRawDangerous || isStrippedDangerous) {
      // Rule 2b: Attempt strict numeric parse
      // Check if stripped string is a valid finite numeric literal (e.g. "-42", "+100", "-0.005")
      const num = Number(stripped);
      if (!isNaN(num) && Number.isFinite(num) && !stripped.includes(" ")) {
        // Legitimate signed number
        return [valStr, false];
      }

      // Not a pure number: prepend apostrophe to neutralize spreadsheet formula execution
      return [`'${valStr}`, true];
    }

    // Normal text and standalone pipe (|) preserved unescaped
    return [valStr, false];
  }

  /**
   * Format an array of cell values into a compliant RFC 4180 CSV line.
   */
  static formatCsvRow(values: string[]): string {
    return values
      .map((val) => {
        // If value contains comma, double quote, newline, or carriage return, quote it
        if (/[",\r\n]/.test(val)) {
          return `"${val.replace(/"/g, '""')}"`;
        }
        return val;
      })
      .join(",");
  }
}
