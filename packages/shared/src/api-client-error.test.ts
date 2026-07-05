import { describe, expect, it } from "vitest";
import { ClientApiError, throwClientApiError } from "./api-client-error.js";

describe("ClientApiError", () => {
  it("fromParsed preserves code and retryable", () => {
    const err = ClientApiError.fromParsed({
      code: "forbidden",
      message: "nope",
      retryable: true,
      status: 403,
    });
    expect(err.status).toBe(403);
    expect(err.code).toBe("forbidden");
    expect(err.appError.retryable).toBe(true);
  });

  it("throwClientApiError throws ClientApiError", () => {
    expect(() =>
      throwClientApiError({
        code: "validation_failed",
        message: "bad",
        status: 400,
      }),
    ).toThrow(ClientApiError);
  });

  it("exposes retryable getter and error name", () => {
    const err = ClientApiError.fromParsed({
      code: "conflict",
      message: "busy",
      retryable: true,
      status: 409,
    });
    expect(err.name).toBe("ClientApiError");
    expect(err.retryable).toBe(true);
  });
});
