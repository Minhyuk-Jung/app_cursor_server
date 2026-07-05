import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp, shutdownApp, type AppContext } from "../../app.js";
import { disconnectDb, prisma } from "../../db/client.js";
import { runTelegramPullTick } from "./telegram-pull-poller.js";
import * as inboundHandler from "./telegram-inbound-handler.js";

describe("Telegram pull adapter integration (P7 S31)", () => {
  let ctx: AppContext;

  beforeAll(async () => {
    process.env.DATABASE_URL = "file:./test-telegram-pull.db";
    process.env.WORKSPACE_ROOT = "./test-workspaces";
    process.env.JWT_SECRET = "test-telegram-pull-jwt";
    ctx = await createApp({
      port: 0,
      telegramBotToken: "test-bot-token",
      telegramPullMode: false,
    });
  });

  afterAll(async () => {
    await ctx.telegramPullPoller?.stop();
    await shutdownApp(ctx);
    await ctx.app.close();
    await disconnectDb();
  });

  it("runTelegramPullTick advances offset from mocked getUpdates", async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const href = String(url);
      if (href.includes("getUpdates")) {
        return Response.json({
          ok: true,
          result: [{ update_id: 50, message: { text: "/dev status", chat: { id: 1 } } }],
        });
      }
      return Response.json({ ok: true });
    });

    const handleSpy = vi
      .spyOn(inboundHandler, "handleTelegramUpdate")
      .mockResolvedValue({ ok: true, ignored: true });

    const { offset, processed } = await runTelegramPullTick({
      config: ctx.config,
      commandHandler: ctx.commandHandler,
      fetchImpl,
      offset: 0,
    });

    expect(processed).toBe(1);
    expect(offset).toBe(51);
    expect(handleSpy).toHaveBeenCalledOnce();
    handleSpy.mockRestore();
  });

  it("handleTelegramUpdate routes linked user send_prompt to command handler", async () => {
    const chatId = String(900_000 + Math.floor(Math.random() * 10_000));
    await prisma.channelLink.create({
      data: {
        userId: "dev-user",
        channel: "telegram",
        externalUserId: chatId,
      },
    });

    const session = await prisma.session.create({
      data: {
        projectId: (
          await prisma.project.create({
            data: {
              userId: "dev-user",
              name: "pull-route",
              rootPath: "./test-workspaces/pull-route",
              status: "active",
            },
          })
        ).id,
        model: "composer-2.5",
        status: "idle",
      },
    });

    const handleSpy = vi.spyOn(ctx.commandHandler, "handleWithLock");
    handleSpy.mockResolvedValue({
      ok: true,
      httpStatus: 200,
      data: { runId: "run-mock" },
    });

    const result = await inboundHandler.handleTelegramUpdate(
      {
        update_id: 2,
        message: {
          text: `/dev prompt ${session.id} hello via pull`,
          chat: { id: Number(chatId) },
        },
      },
      { commandHandler: ctx.commandHandler, config: ctx.config },
    );

    expect(result.ok).toBe(true);
    expect(handleSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "send_prompt",
        sessionId: session.id,
        text: "hello via pull",
      }),
      expect.objectContaining({ userId: "dev-user", channel: "telegram" }),
    );
    handleSpy.mockRestore();
  });
});
