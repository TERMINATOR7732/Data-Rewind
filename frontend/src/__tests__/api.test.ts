import { describe, expect, it } from "vitest";
import { ApiClientError } from "../lib/api";

describe("API Client Error Handling", () => {
  it("instantiates ApiClientError with code, details, and remediation", () => {
    const error = new ApiClientError(
      {
        code: "EXPRESSION_SECURITY_VIOLATION",
        message: "Forbidden function call detected.",
        details: { expression: "__import__('os')" },
        remediation: "Use only pure mathematical operators.",
      },
      400
    );

    expect(error.name).toBe("ApiClientError");
    expect(error.code).toBe("EXPRESSION_SECURITY_VIOLATION");
    expect(error.message).toBe("Forbidden function call detected.");
    expect(error.details?.expression).toBe("__import__('os')");
    expect(error.remediation).toBe("Use only pure mathematical operators.");
    expect(error.statusCode).toBe(400);
  });
});
