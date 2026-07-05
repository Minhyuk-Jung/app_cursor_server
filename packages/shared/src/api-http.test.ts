import { describe, expect, it } from "vitest";
import {
  extractApiError,
  parseJsonBody,
  parseJsonResponse,
} from "./api-http.js";

describe("api-http", () => {
  it("parseJsonBody returns empty object for empty string", () => {
    expect(parseJsonBody("")).toEqual({});
  });

  it("extractApiError reads nested error with retryable", () => {
    expect(
      extractApiError(
        {
          error: {
            message: "bad",
            code: "validation_failed",
            retryable: true,
          },
        },
        "Fallback",
      ),
    ).toEqual({
      message: "bad",
      code: "validation_failed",
      retryable: true,
    });
  });

  it("parseJsonResponse throws ParsedApiError on error status", async () => {
    const res = new Response(
      JSON.stringify({
        error: { message: "nope", code: "forbidden", retryable: false },
      }),
      { status: 403, statusText: "Forbidden" },
    );
    await expect(
      parseJsonResponse(res, (err) => {
        throw new Error(`${err.status}:${err.code}:${err.message}:${err.retryable}`);
      }),
    ).rejects.toThrow("403:forbidden:nope:false");
  });

  it("parseJsonResponse returns body on success", async () => {
    const res = new Response(JSON.stringify({ ok: true }), { status: 200 });
    const data = await parseJsonResponse<{ ok: boolean }>(res, (err) => {
      throw new Error(err.message);
    });
    expect(data.ok).toBe(true);
  });

  it("parseJsonResponse maps invalid JSON to invalid_response", async () => {
    const res = new Response("<html>bad gateway</html>", {
      status: 502,
      statusText: "Bad Gateway",
    });
    await expect(
      parseJsonResponse(res, (err) => {
        throw new Error(`${err.code}:${err.message}`);
      }),
    ).rejects.toThrow("invalid_response:");
  });
});
