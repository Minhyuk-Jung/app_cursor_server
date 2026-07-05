import { describe, expect, it, vi } from "vitest";
import {
  formatTelegramOutbound,
  parseTelegramInbound,
  verifyTelegramWebhookSecret,
  fetchTelegramUpdates,
  deleteTelegramWebhook,
  TelegramApiError,
  parseTelegramApiError,
} from "./telegram-adapter.js";

describe("TelegramAdapter (P4 S29)", () => {
  it("parses send_prompt inbound", () => {
    const parsed = parseTelegramInbound({
      message: {
        text: "/dev prompt sess-abc hello world",
        chat: { id: 12345 },
      },
    });
    expect(parsed?.chatId).toBe("12345");
    expect(parsed?.command?.kind).toBe("send_prompt");
    if (parsed?.command?.kind === "send_prompt") {
      expect(parsed.command.sessionId).toBe("sess-abc");
      expect(parsed.command.text).toBe("hello world");
    }
  });

  it("parses status command", () => {
    const parsed = parseTelegramInbound({
      message: { text: "/dev status", chat: { id: 99 } },
    });
    expect(parsed?.command?.kind).toBe("status");
  });

  it("formats outbound summary", () => {
    const text = formatTelegramOutbound({
      kind: "run_done",
      title: "완료",
      summary: "run finished",
      deeplink: "/project/p1/session/s1",
    });
    expect(text).toContain("run_done");
    expect(text).toContain("완료");
  });

  it("verifies webhook secret", () => {
    expect(verifyTelegramWebhookSecret("abc", "abc")).toBe(true);
    expect(verifyTelegramWebhookSecret("wrong", "abc")).toBe(false);
    expect(verifyTelegramWebhookSecret(undefined, undefined)).toBe(true);
  });

  it("parses exec_command inbound (P6/10)", () => {
    const parsed = parseTelegramInbound({
      message: {
        text: "/dev exec proj-1 echo hello",
        chat: { id: 42 },
      },
    });
    expect(parsed?.command?.kind).toBe("exec_command");
    if (parsed?.command?.kind === "exec_command") {
      expect(parsed.command.projectId).toBe("proj-1");
      expect(parsed.command.command).toBe("echo hello");
    }
  });

  it("fetchTelegramUpdates parses getUpdates response (P7 pull)", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        ok: true,
        result: [{ update_id: 7, message: { text: "/dev status", chat: { id: 1 } } }],
      }),
    );
    const updates = await fetchTelegramUpdates("test-token", 0, 10, fetchImpl);
    expect(updates).toHaveLength(1);
    expect(updates[0]?.update_id).toBe(7);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("deleteTelegramWebhook calls deleteWebhook API", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ ok: true }));
    await deleteTelegramWebhook("test-token", fetchImpl);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain("deleteWebhook");
  });

  it("parseTelegramApiError extracts retry_after on 429", () => {
    const err = parseTelegramApiError(
      429,
      JSON.stringify({ description: "Too Many Requests", parameters: { retry_after: 12 } }),
    );
    expect(err).toBeInstanceOf(TelegramApiError);
    expect(err.retryAfterSec).toBe(12);
  });

  it("parses create_project inbound", () => {
    const parsed = parseTelegramInbound({
      message: { text: "/dev project demo-app", chat: { id: 1 } },
    });
    expect(parsed?.command?.kind).toBe("create_project");
  });
});
