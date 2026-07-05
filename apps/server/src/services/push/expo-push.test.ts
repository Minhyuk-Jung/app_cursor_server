import { describe, expect, it, vi } from "vitest";
import {
  getExpoPushReceipts,
  isValidExpoPushToken,
  sendExpoPushMessages,
} from "./expo-push.js";

describe("expo-push", () => {
  it("validates Expo push token format", () => {
    expect(isValidExpoPushToken("ExponentPushToken[abc123]")).toBe(true);
    expect(isValidExpoPushToken("ExpoPushToken[abc-123]")).toBe(true);
    expect(isValidExpoPushToken("invalid")).toBe(false);
  });

  it("sends messages to Expo API", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ data: { status: "ok", id: "ticket-1" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const tickets = await sendExpoPushMessages([
      { to: "ExponentPushToken[x]", title: "t", body: "b" },
    ]);
    expect(tickets).toHaveLength(1);
    expect(tickets[0]!.status).toBe("ok");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://exp.host/--/api/v2/push/send",
      expect.objectContaining({ method: "POST" }),
    );

    vi.unstubAllGlobals();
  });

  it("getExpoPushReceipts fetches delivery receipts", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        data: {
          "ticket-1": { status: "ok" },
          "ticket-2": {
            status: "error",
            details: { error: "DeviceNotRegistered" },
          },
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const receipts = await getExpoPushReceipts(["ticket-1", "ticket-2"]);
    expect(receipts["ticket-1"]!.status).toBe("ok");
    expect(receipts["ticket-2"]!.details?.error).toBe("DeviceNotRegistered");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://exp.host/--/api/v2/push/getReceipts",
      expect.objectContaining({ method: "POST" }),
    );

    vi.unstubAllGlobals();
  });
});
