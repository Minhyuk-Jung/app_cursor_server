import { describe, expect, it } from "vitest";
import { classifyStartupError } from "./sdk-adapter.js";
import { sandboxError } from "../../services/exec/sandbox-errors.js";
import { ErrorKind } from "@app/shared";

describe("classifyStartupError (sandbox)", () => {
  it("maps sandbox errors to startup error events with retryable", () => {
    const err = sandboxError(
      "docker_unavailable",
      "SANDBOX_MODE=docker but Docker is not available",
      false,
    );
    const event = classifyStartupError(err);
    expect(event.type).toBe("error");
    expect(event.errorKind).toBe(ErrorKind.STARTUP);
    expect(event.message).toContain("Docker is not available");
    expect(event.retryable).toBe(false);
  });

  it("preserves retryable for sandbox_not_ready", () => {
    const err = sandboxError("sandbox_not_ready", "not ready", true);
    const event = classifyStartupError(err);
    expect(event.retryable).toBe(true);
  });
});
