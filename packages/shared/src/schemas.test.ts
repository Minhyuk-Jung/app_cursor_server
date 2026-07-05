import { describe, expect, it } from "vitest";
import {
  parseCommand,
  parseDomainEvent,
  validationFailed,
} from "./schemas.js";

describe("shared contracts", () => {
  it("accepts valid send_prompt command", () => {
    const cmd = parseCommand({
      kind: "send_prompt",
      source: "web",
      requestId: "550e8400-e29b-41d4-a716-446655440000",
      sessionId: "sess-1",
      text: "hello",
    });
    expect(cmd.kind).toBe("send_prompt");
  });

  it("rejects empty prompt text", () => {
    expect(() =>
      parseCommand({
        kind: "send_prompt",
        source: "web",
        requestId: "550e8400-e29b-41d4-a716-446655440000",
        sessionId: "sess-1",
        text: "",
      }),
    ).toThrow();
  });

  it("accepts domain events", () => {
    const ev = parseDomainEvent({
      type: "assistant",
      runId: "run-1",
      text: "hi",
    });
    expect(ev.type).toBe("assistant");
  });

  it("creates validation error", () => {
    expect(validationFailed("bad")).toEqual({
      code: "validation_failed",
      message: "bad",
      retryable: false,
    });
  });
});
