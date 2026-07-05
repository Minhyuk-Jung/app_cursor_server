import { describe, expect, it, vi, beforeEach } from "vitest";
import { PushService } from "./push-service.js";

vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("./expo-push.js", () => ({
  isValidExpoPushToken: vi.fn((t: string) => t.startsWith("ExponentPushToken")),
  sendExpoPushMessages: vi.fn().mockResolvedValue([{ status: "ok", id: "t1" }]),
  getExpoPushReceipts: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../db/client.js", () => ({
  prisma: {
    pushSubscription: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: "sub1",
          endpoint: "https://push.example/1",
          p256dh: "key",
          auth: "auth",
        },
      ]),
      delete: vi.fn(),
    },
    expoPushToken: {
      findMany: vi.fn().mockResolvedValue([
        { id: "ex1", token: "ExponentPushToken[abc]" },
      ]),
      upsert: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    expoReceiptPending: {
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

describe("PushService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is disabled without VAPID keys", () => {
    const svc = new PushService({
      vapidPublicKey: "",
      vapidPrivateKey: "",
      vapidSubject: "mailto:test@local",
    });
    expect(svc.isEnabled()).toBe(false);
    expect(svc.getPublicKey()).toBeNull();
    expect(svc.isExpoEnabled()).toBe(true);
  });

  it("is enabled with VAPID keys", () => {
    const svc = new PushService({
      vapidPublicKey: "pub",
      vapidPrivateKey: "priv",
      vapidSubject: "mailto:test@local",
    });
    expect(svc.isEnabled()).toBe(true);
    expect(svc.getPublicKey()).toBe("pub");
  });

  it("skips web push when disabled but still sends expo", async () => {
    const svc = new PushService({
      vapidPublicKey: "",
      vapidPrivateKey: "",
      vapidSubject: "mailto:test@local",
    });
    await svc.sendToUser("u1", { title: "t", body: "b" });
    const webpush = (await import("web-push")).default;
    expect(webpush.sendNotification).not.toHaveBeenCalled();
    const { sendExpoPushMessages } = await import("./expo-push.js");
    expect(sendExpoPushMessages).toHaveBeenCalled();
  });

  it("sends web push and expo when enabled", async () => {
    const svc = new PushService({
      vapidPublicKey: "pub",
      vapidPrivateKey: "priv",
      vapidSubject: "mailto:test@local",
    });
    await svc.sendToUser("u1", {
      title: "t",
      body: "b",
      deeplink: "/project/p1/session/s1",
      kind: "run_done",
    });
    const webpush = (await import("web-push")).default;
    expect(webpush.sendNotification).toHaveBeenCalled();
    const { sendExpoPushMessages } = await import("./expo-push.js");
    expect(sendExpoPushMessages).toHaveBeenCalledWith([
      expect.objectContaining({
        to: "ExponentPushToken[abc]",
        title: "t",
        data: expect.objectContaining({
          deeplink: "/project/p1/session/s1",
          kind: "run_done",
          projectId: "p1",
          sessionId: "s1",
        }),
      }),
    ]);
  });

  it("subscribeExpo upserts token", async () => {
    const { prisma } = await import("../../db/client.js");
    const svc = new PushService({
      vapidPublicKey: "",
      vapidPrivateKey: "",
      vapidSubject: "mailto:test@local",
    });
    await svc.subscribeExpo("u1", "ExponentPushToken[xyz]");
    expect(prisma.expoPushToken.upsert).toHaveBeenCalled();
  });

  it("schedules expo receipt check after send", async () => {
    vi.useFakeTimers();
    const svc = new PushService({
      vapidPublicKey: "",
      vapidPrivateKey: "",
      vapidSubject: "mailto:test@local",
    });
    await svc.sendToUser("u1", { title: "t", body: "b" });
    const { getExpoPushReceipts } = await import("./expo-push.js");
    expect(getExpoPushReceipts).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(getExpoPushReceipts).toHaveBeenCalledWith(["t1"]);
    vi.useRealTimers();
  });

  it("persists expo receipt schedule to database", async () => {
    const { prisma } = await import("../../db/client.js");
    const svc = new PushService({
      vapidPublicKey: "",
      vapidPrivateKey: "",
      vapidSubject: "mailto:test@local",
    });
    await svc.sendToUser("u1", { title: "t", body: "b" });
    expect(prisma.expoReceiptPending.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            tokenRowId: "ex1",
            ticketId: "t1",
            attempt: 0,
          }),
        ],
      }),
    );
  });

  it("prunes orphan receipt pending on resume", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { prisma } = await import("../../db/client.js");
    vi.mocked(prisma.expoReceiptPending.findMany).mockResolvedValueOnce([
      { id: "orph1", tokenRowId: "missing" },
    ] as never);
    vi.mocked(prisma.expoPushToken.findMany).mockResolvedValueOnce([
      { id: "ex1" },
    ] as never);

    new PushService({
      vapidPublicKey: "",
      vapidPrivateKey: "",
      vapidSubject: "mailto:test@local",
    });

    await vi.waitFor(() => {
      expect(prisma.expoReceiptPending.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ["orph1"] } },
      });
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("pruning 1 orphan"),
    );
    warnSpy.mockRestore();
  });

  it("skips duplicate in-flight receipt processing", async () => {
    const { getExpoPushReceipts } = await import("./expo-push.js");
    vi.mocked(getExpoPushReceipts).mockClear();
    const svc = new PushService({
      vapidPublicKey: "",
      vapidPrivateKey: "",
      vapidSubject: "mailto:test@local",
    });
    const pairs = [{ tokenRowId: "ex1", ticketId: "t1" }];
    await Promise.all([
      (svc as unknown as { processExpoReceipts: (p: typeof pairs, a: number) => Promise<void> }).processExpoReceipts(pairs, 0),
      (svc as unknown as { processExpoReceipts: (p: typeof pairs, a: number) => Promise<void> }).processExpoReceipts(pairs, 0),
    ]);
    expect(getExpoPushReceipts).toHaveBeenCalledTimes(1);
  });
});
