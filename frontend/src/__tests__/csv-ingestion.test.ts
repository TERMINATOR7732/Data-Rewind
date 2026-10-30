import { describe, it, expect, vi } from "vitest";
import { CsvParser } from "../runtime/csv/parser";
import { CsvValidator } from "../runtime/csv/validator";
import { ERROR_CODES } from "../runtime/contracts/errors";

describe("CSV Parsing & RFC 4180 Compliance", () => {
  it("correctly parses CSV with commas inside quoted fields", async () => {
    const csv = `id,name,description\n1,"Doe, John","Senior Engineer, Data"\n2,"Smith, Jane","Architect"`;
    const res = await CsvParser.parseAndValidate(csv);

    expect(res.rowCount).toBe(2);
    expect(res.columnCount).toBe(3);
    expect(res.headers).toEqual(["id", "name", "description"]);
    expect(res.sampleRows[0]).toEqual({
      id: "1",
      name: "Doe, John",
      description: "Senior Engineer, Data",
    });
    expect(res.sampleRows[1]).toEqual({
      id: "2",
      name: "Smith, Jane",
      description: "Architect",
    });
  });

  it("correctly unescapes double quotes inside quoted fields", async () => {
    const csv = `id,quote_text\n101,"He said, ""Hello World!"" and smiled"\n102,"Standard unquoted"`;
    const res = await CsvParser.parseAndValidate(csv);

    expect(res.rowCount).toBe(2);
    expect(res.sampleRows[0].quote_text).toBe('He said, "Hello World!" and smiled');
    expect(res.sampleRows[1].quote_text).toBe("Standard unquoted");
  });

  it("handles mixed CRLF and LF line endings seamlessly", async () => {
    const csv = "col1,col2\r\nval1,val2\nval3,val4\r\nval5,val6";
    const res = await CsvParser.parseAndValidate(csv);

    expect(res.rowCount).toBe(3);
    expect(res.headers).toEqual(["col1", "col2"]);
    expect(res.sampleRows).toHaveLength(3);
  });

  it("calculates deterministic SHA-256 hash of raw input bytes", async () => {
    const csvA = "col1,col2\nval1,val2";
    const csvB = "col1,col2\nval1,val2";

    const resA = await CsvParser.parseAndValidate(csvA);
    const resB = await CsvParser.parseAndValidate(csvB);

    expect(resA.sha256Hash).toBe(resB.sha256Hash);
    expect(resA.sha256Hash).toHaveLength(64);
  });
});

describe("CSV Ingestion Guardrails & Validation", () => {
  it("rejects duplicate column headers", async () => {
    const csv = "order_id,customer,order_id\n1,Alice,100";
    await expect(CsvParser.parseAndValidate(csv)).rejects.toThrowError(
      expect.objectContaining({
        code: ERROR_CODES.CSV_DUPLICATE_COLUMNS,
      })
    );
  });

  it("rejects empty or whitespace-only column headers", async () => {
    const csv = "order_id,,amount\n1,Alice,50.00";
    await expect(CsvParser.parseAndValidate(csv)).rejects.toThrowError(
      expect.objectContaining({
        code: ERROR_CODES.CSV_EMPTY_COLUMN_NAME,
      })
    );
  });

  it("rejects files exceeding maximum 100 columns guardrail", async () => {
    const headers = Array.from({ length: 105 }, (_, i) => `col_${i}`).join(",");
    const row = Array.from({ length: 105 }, () => "val").join(",");
    const csv = `${headers}\n${row}`;

    await expect(CsvParser.parseAndValidate(csv)).rejects.toThrowError(
      expect.objectContaining({
        code: ERROR_CODES.CSV_MAX_COLUMNS_EXCEEDED,
      })
    );
  });

  it("rejects rows with cell lengths exceeding 4,096 characters", async () => {
    const hugeString = "A".repeat(4097);
    const csv = `id,notes\n1,"${hugeString}"`;

    await expect(CsvParser.parseAndValidate(csv)).rejects.toThrowError(
      expect.objectContaining({
        code: ERROR_CODES.CSV_OVERSIZED_CELL,
      })
    );
  });

  it("rejects files exceeding 50 MB pre-flight guardrail", () => {
    expect(() => {
      CsvValidator.validatePreflight(52_000_000, "large.csv");
    }).toThrowError(
      expect.objectContaining({
        code: ERROR_CODES.CSV_FILE_TOO_LARGE,
      })
    );
  });

  it("rejects non-csv file types", () => {
    expect(() => {
      CsvValidator.validatePreflight(1024, "data.xlsx");
    }).toThrowError(
      expect.objectContaining({
        code: ERROR_CODES.CSV_INVALID_FILE_TYPE,
      })
    );
  });

  it("detects and rejects malformed rows with column count mismatch", async () => {
    const csv = "col1,col2,col3\nval1,val2\nval1,val2,val3";
    await expect(CsvParser.parseAndValidate(csv)).rejects.toThrowError(
      expect.objectContaining({
        code: ERROR_CODES.CSV_MALFORMED,
      })
    );
  });

  it("notifies progress callback during parsing", async () => {
    const progressSpy = vi.fn();
    const rows = Array.from({ length: 1000 }, (_, i) => `${i},user_${i}`).join("\n");
    const csv = `id,username\n${rows}`;

    await CsvParser.parseAndValidate(csv, { onProgress: progressSpy });

    expect(progressSpy).toHaveBeenCalled();
    const finalCall = progressSpy.mock.calls[progressSpy.mock.calls.length - 1][0];
    expect(finalCall.percent).toBe(100);
    expect(finalCall.rowsScanned).toBe(1000);
  });

  it("supports cancellation via AbortSignal", async () => {
    const controller = new AbortController();
    const rows = Array.from({ length: 1000 }, (_, i) => `${i},user_${i}`).join("\n");
    const csv = `id,username\n${rows}`;

    // Abort before parsing starts
    controller.abort();

    await expect(
      CsvParser.parseAndValidate(csv, { signal: controller.signal })
    ).rejects.toThrowError(
      expect.objectContaining({
        code: ERROR_CODES.OPERATION_CANCELLED,
      })
    );
  });

  it("handles Uint8Array byte inputs cleanly", async () => {
    const text = "item,qty\napple,5\norange,10";
    const bytes = new TextEncoder().encode(text);

    const res = await CsvParser.parseAndValidate(bytes);
    expect(res.rowCount).toBe(2);
    expect(res.headers).toEqual(["item", "qty"]);
    expect(res.byteSize).toBe(bytes.byteLength);
  });
});
