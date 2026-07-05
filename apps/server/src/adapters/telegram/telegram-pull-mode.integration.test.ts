import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, shutdownApp, type AppContext } from "../../app.js";
import { disconnectDb } from "../../db/client.js";

describe("Telegram pull vs push webhook (10 §6.3)", () => {
  let ctx: AppContext;

  beforeAll(async () => {
    process.env.DATABASE_URL = "file:./test-telegram-pull-mode.db";
    process.env.WORKSPACE_ROOT = "./test-workspaces";
    ctx = await createApp({
      port: 0,
      telegramBotToken: "test-token",
      telegramPullMode: true,
      telegramWebhookSecret: "secret",
    });
  });

  afterAll(async () => {
    await ctx.telegramPullPoller?.stop();
    await shutdownApp(ctx);
    await ctx.app.close();
    await disconnectDb();
  });

  it("rejects push webhook when pull mode enabled", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/webhooks/telegram",
      headers: { "x-telegram-secret": "secret" },
      payload: {
        message: { text: "/dev status", chat: { id: 1 } },
      },
    });
    expect(res.statusCode).toBe(409);
  });

  it("health reports pull inboundMode", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/health" });
    const body = res.json() as {
      channels: { telegram: { inboundMode: string } };
    };
    expect(body.channels.telegram.inboundMode).toBe("pull");
  });
});
