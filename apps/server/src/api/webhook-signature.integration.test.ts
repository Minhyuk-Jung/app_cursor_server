import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, type AppContext } from "../app.js";
import { prisma } from "../db/client.js";
import { useTestDatabase } from "../test-helpers/db.js";

const AUTH = { authorization: "Bearer dev-local-key" };

/** 21-test-strategy SEC-03 — webhook HMAC */
describe("SEC-03 webhook signature", () => {
  let ctx: AppContext;
  const WEBHOOK_SECRET = "sec03-webhook-secret";

  beforeAll(async () => {
    await useTestDatabase("file:./test-sec03-webhook.db");
    ctx = await createApp({
      port: 0,
      webhookSecret: WEBHOOK_SECRET,
      telegramWebhookSecret: "sec03-tg-secret",
    });
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it("rejects forged signature", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/webhooks/custom",
      headers: { ...AUTH, "x-signature": "deadbeef" },
      payload: { sessionId: "sess-x", text: "hello" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("accepts valid HMAC signature", async () => {
    const project = await prisma.project.create({
      data: {
        userId: "dev-user",
        name: "sec03",
        rootPath: "./test-sec03-ws",
        status: "active",
      },
    });
    const session = await prisma.session.create({
      data: { projectId: project.id, model: "composer-2.5", status: "idle" },
    });

    const payload = { sessionId: session.id, text: "signed" };
    const raw = JSON.stringify(payload);
    const sig = createHmac("sha256", WEBHOOK_SECRET).update(raw).digest("hex");
    const ts = String(Math.floor(Date.now() / 1000));

    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/webhooks/custom",
      headers: {
        ...AUTH,
        "x-signature": sig,
        "x-webhook-timestamp": ts,
        "x-request-id": "550e8400-e29b-41d4-a716-446655440099",
      },
      payload,
    });
    expect([200, 202]).toContain(res.statusCode);
  });

  it("rejects custom webhook with missing timestamp when secret set", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/webhooks/custom",
      headers: {
        ...AUTH,
        "x-signature": "deadbeef",
      },
      payload: { sessionId: "sess-x", text: "hello" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects telegram webhook with invalid secret", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/webhooks/telegram",
      headers: {
        "x-telegram-secret": "wrong-secret",
      },
      payload: {
        message: { text: "/dev status", chat: { id: 12345 } },
      },
    });
    expect(res.statusCode).toBe(403);
  });
});
