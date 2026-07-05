import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  formatCustomOutbound,
  parseCustomInbound,
  verifyCustomSignature,
  verifyWebhookTimestamp,
} from "./custom-adapter.js";

describe("custom adapter", () => {
  it("parses send_prompt inbound", () => {
    const parsed = parseCustomInbound({
      sessionId: "sess-1",
      text: "hello",
    });
    expect(parsed?.kind).toBe("send_prompt");
    expect(parsed?.sessionId).toBe("sess-1");
  });

  it("parses status command", () => {
    const parsed = parseCustomInbound({ command: "status" });
    expect(parsed?.kind).toBe("status");
  });

  it("parses exec_command inbound (P6/10)", () => {
    const parsed = parseCustomInbound({
      command: "exec",
      projectId: "proj-1",
      text: "echo ok",
    });
    expect(parsed?.kind).toBe("exec_command");
    if (parsed?.kind === "exec_command") {
      expect(parsed.projectId).toBe("proj-1");
      expect(parsed.command).toBe("echo ok");
    }
  });

  it("formats outbound summary", () => {
    const msg = formatCustomOutbound({
      kind: "run_done",
      title: "Done",
      summary: "finished",
      deeplink: "/p/s",
    });
    expect(msg.text).toContain("run_done");
  });

  it("verifies HMAC signature when secret set", () => {
    const body = '{"text":"hi"}';
    const sig = createHmac("sha256", "secret").update(body).digest("hex");
    expect(verifyCustomSignature(body, sig, "secret")).toBe(true);
    expect(verifyCustomSignature(body, "bad", "secret")).toBe(false);
    expect(verifyCustomSignature(body, sig, undefined)).toBe(true);
  });

  it("verifies webhook timestamp skew", () => {
    const now = String(Math.floor(Date.now() / 1000));
    expect(verifyWebhookTimestamp(now)).toBe(true);
    expect(verifyWebhookTimestamp(String(Number(now) - 400))).toBe(false);
    expect(verifyWebhookTimestamp(undefined)).toBe(false);
  });
});
