import { describe, expect, it, vi } from "vitest";
import {
  fetchIntranetMessages,
  intranetMessageRequestId,
  parseIntranetPollResponse,
} from "./intranet-messenger-adapter.js";

describe("intranet messenger pull (S31)", () => {
  it("parses poll JSON contract", () => {
    const batch = parseIntranetPollResponse({
      messages: [{ id: "m1", chatId: "u1", text: "/dev status" }],
      cursor: "c2",
    });
    expect(batch.messages).toHaveLength(1);
    expect(batch.cursor).toBe("c2");
  });

  it("intranetMessageRequestId is stable UUID v5", () => {
    const id = intranetMessageRequestId("m1");
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(intranetMessageRequestId("m1")).toBe(id);
    expect(intranetMessageRequestId("m2")).not.toBe(id);
  });

  it("fetchIntranetMessages calls poll URL with cursor", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        messages: [{ id: "1", chatId: "42", text: "/dev status" }],
        cursor: "next",
      }),
    );
    const batch = await fetchIntranetMessages(
      "https://intranet.local/api/messages",
      "cur0",
      "Bearer x",
      fetchImpl,
    );
    expect(batch.messages).toHaveLength(1);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain("cursor=cur0");
  });
});
