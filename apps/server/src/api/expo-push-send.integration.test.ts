import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, type AppContext } from "../app.js";
import { prisma } from "../db/client.js";

describe("Expo push dispatch (P7 mobile 4차)", () => {
  let ctx: AppContext;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { status: "ok", id: "ticket-1" } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    process.env.DATABASE_URL = "file:./test-expo-push-send.db";
    ctx = await createApp({ port: 0 });
  });

  beforeEach(async () => {
    fetchMock.mockClear();
    await prisma.message.deleteMany();
    await prisma.runEvent.deleteMany();
    await prisma.notification.deleteMany();
    await prisma.expoPushToken.deleteMany();
    await prisma.run.deleteMany();
    await prisma.session.deleteMany();
    await prisma.project.deleteMany();
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await ctx.app.close();
  });

  it("sends run_done to Expo when token registered", async () => {
    await prisma.expoPushToken.create({
      data: {
        userId: "dev-user",
        token: "ExponentPushToken[dispatch-test]",
      },
    });
    const project = await prisma.project.create({
      data: {
        userId: "dev-user",
        name: "expo-dispatch",
        rootPath: "/tmp/expo-dispatch",
        status: "active",
      },
    });
    const session = await prisma.session.create({
      data: { projectId: project.id, model: "composer-2.5", status: "idle" },
    });
    const run = await prisma.run.create({
      data: { sessionId: session.id, status: "running" },
    });

    await ctx.eventLog.append({
      runId: run.id,
      sessionId: session.id,
      projectId: project.id,
      event: { type: "run_done", runId: run.id, status: "finished" },
    });

    await new Promise((r) => setTimeout(r, 150));

    const expoCalls = fetchMock.mock.calls.filter(
      (c) => c[0] === "https://exp.host/--/api/v2/push/send",
    );
    expect(expoCalls.length).toBeGreaterThan(0);
    const bodies = expoCalls.map(
      (c) =>
        JSON.parse(String(c[1]?.body)) as {
          to: string;
          title: string;
          data?: Record<string, string>;
        },
    );
    const match = bodies.find((b) => b.data?.sessionId === session.id);
    expect(match).toBeDefined();
    expect(match!.to).toBe("ExponentPushToken[dispatch-test]");
    expect(match!.data?.deeplink).toBe(
      `/project/${project.id}/session/${session.id}`,
    );
    expect(match!.data?.kind).toBe("run_done");
  });

  it("defers Expo push during quiet hours", async () => {
    const quietFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { status: "ok", id: "t" } }),
    });

    const quietCtx = await createApp({
      port: 0,
      quietHoursStart: 0,
      quietHoursEnd: 24,
    });

    const origFetch = globalThis.fetch;
    globalThis.fetch = quietFetch as typeof fetch;

    try {
      await prisma.expoPushToken.create({
        data: {
          userId: "dev-user",
          token: "ExponentPushToken[quiet]",
        },
      });
      const project = await prisma.project.create({
        data: {
          userId: "dev-user",
          name: "quiet-expo",
          rootPath: "/tmp/quiet-expo",
          status: "active",
        },
      });
      const session = await prisma.session.create({
        data: { projectId: project.id, model: "composer-2.5", status: "idle" },
      });
      const run = await prisma.run.create({
        data: { sessionId: session.id, status: "running" },
      });

      await quietCtx.eventLog.append({
        runId: run.id,
        sessionId: session.id,
        projectId: project.id,
        event: { type: "run_done", runId: run.id, status: "finished" },
      });

      await new Promise((r) => setTimeout(r, 150));

      const expoCalls = quietFetch.mock.calls.filter(
        (c) => c[0] === "https://exp.host/--/api/v2/push/send",
      );
      expect(expoCalls).toHaveLength(0);
    } finally {
      globalThis.fetch = origFetch;
      await quietCtx.app.close();
    }
  });
});
