import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp, shutdownApp, type AppContext } from "../../app.js";
import { disconnectDb, prisma } from "../../db/client.js";
import { useTestDatabase } from "../../test-helpers/db.js";

/** P7 S30 — app wiring: run_done → telegram sendMessage */
describe("Telegram S30 outbound integration", () => {
  let ctx: AppContext;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    await useTestDatabase("file:./test-s30-app.db");
    process.env.WORKSPACE_ROOT = "./test-workspaces-s30";
    fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      if (href.includes("sendMessage")) {
        return Response.json({ ok: true, result: { message_id: 1 } });
      }
      return Response.json({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    ctx = await createApp({
      port: 0,
      telegramBotToken: "s30-test-bot-token",
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

  it("delivers run_done summary to linked telegram chat via Bot API", async () => {
    const chatId = `s30-${Date.now()}`;
    await prisma.channelLink.deleteMany({
      where: { userId: "dev-user", channel: "telegram" },
    });
    await prisma.channelLink.create({
      data: {
        userId: "dev-user",
        channel: "telegram",
        externalUserId: chatId,
      },
    });

    const project = await prisma.project.create({
      data: {
        userId: "dev-user",
        name: "s30-app",
        rootPath: "./test-workspaces/s30-app",
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

    const sendCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("sendMessage"),
    );
    expect(sendCalls.length).toBeGreaterThanOrEqual(1);
    const body = JSON.parse(String(sendCalls[0]![1]?.body)) as {
      chat_id: string;
      text: string;
    };
    expect(body.chat_id).toBe(chatId);
    expect(body.text).toContain("실행");
  });
});
