import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp, shutdownApp, type AppContext } from "../../app.js";
import { disconnectDb, prisma } from "../../db/client.js";
import { useTestDatabase } from "../../test-helpers/db.js";

/** P7 S31 — run_done → intranet notify URL (outbound) */
describe("Intranet S31 outbound integration", () => {
  let ctx: AppContext;
  let fetchMock: ReturnType<typeof vi.fn>;
  const NOTIFY_URL = "https://intranet.local/api/notify";

  beforeAll(async () => {
    await useTestDatabase("file:./test-s31-outbound.db");
    process.env.WORKSPACE_ROOT = "./test-workspaces-s31-out";
    fetchMock = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    ctx = await createApp({
      port: 0,
      intranetMessengerNotifyUrl: NOTIFY_URL,
    });
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await ctx.telegramPullPoller?.stop();
    await ctx.intranetPullPoller?.stop();
    await shutdownApp(ctx);
    await ctx.app.close();
    await disconnectDb();
  });

  it("delivers run_done summary to linked intranet chat via notify URL", async () => {
    const chatId = `s31-out-${Date.now()}`;
    await prisma.channelLink.deleteMany({
      where: { userId: "dev-user", channel: "intranet" },
    });
    await prisma.channelLink.create({
      data: {
        userId: "dev-user",
        channel: "intranet",
        externalUserId: chatId,
      },
    });

    const project = await prisma.project.create({
      data: {
        userId: "dev-user",
        name: "s31-out-app",
        rootPath: "./test-workspaces/s31-out-app",
        status: "active",
      },
    });
    const session = await prisma.session.create({
      data: {
        projectId: project.id,
        model: "composer-2.5",
        status: "idle",
      },
    });
    const run = await prisma.run.create({
      data: {
        sessionId: session.id,
        status: "finished",
      },
    });

    fetchMock.mockClear();

    await ctx.eventLog.append({
      runId: run.id,
      sessionId: session.id,
      projectId: project.id,
      event: { type: "run_done", runId: run.id, status: "finished" },
    });

    await new Promise((r) => setTimeout(r, 50));

    const notifyCalls = fetchMock.mock.calls.filter(
      (call) => String(call[0]) === NOTIFY_URL,
    );
    expect(notifyCalls.length).toBeGreaterThanOrEqual(1);
    const body = JSON.parse(String(notifyCalls[0]![1]?.body)) as {
      chatId: string;
      text: string;
    };
    expect(body.chatId).toBe(chatId);
    expect(body.text).toContain("run_done");
  });
});
