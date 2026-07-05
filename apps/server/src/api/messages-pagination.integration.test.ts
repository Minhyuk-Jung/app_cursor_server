import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, shutdownApp, type AppContext } from "../app.js";
import { disconnectDb, prisma } from "../db/client.js";
import { useTestDatabase } from "../test-helpers/db.js";

const AUTH = { authorization: "Bearer dev-local-key" };

describe("GET session messages pagination (02-api §6)", () => {
  let ctx: AppContext;
  let sessionId: string;
  let messageIds: string[] = [];

  beforeAll(async () => {
    await useTestDatabase("file:./test-msg-pagination.db");
    ctx = await createApp({ port: 0, sandboxMode: "subprocess" });

    const project = await prisma.project.create({
      data: {
        userId: "dev-user",
        name: "pag-proj",
        rootPath: "./test-msg-pag-ws",
        status: "active",
      },
    });
    const session = await prisma.session.create({
      data: { projectId: project.id, model: "composer-2.5", status: "idle" },
    });
    sessionId = session.id;

    for (let i = 0; i < 5; i++) {
      const msg = await prisma.message.create({
        data: {
          sessionId,
          role: i % 2 === 0 ? "user" : "assistant",
          content: `msg-${i}`,
        },
      });
      messageIds.push(msg.id);
    }
  });

  afterAll(async () => {
    await ctx.telegramPullPoller?.stop();
    await ctx.intranetPullPoller?.stop();
    await shutdownApp(ctx);
    await ctx.app.close();
    await disconnectDb();
  });

  it("returns latest page with hasMore", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/v1/sessions/${sessionId}/messages?limit=2`,
      headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      messages: Array<{ id: string; content: string }>;
      hasMore: boolean;
    };
    expect(body.messages).toHaveLength(2);
    expect(body.hasMore).toBe(true);
    expect(body.messages[0]!.content).toBe("msg-3");
    expect(body.messages[1]!.content).toBe("msg-4");
  });

  it("pages backward with before cursor", async () => {
    const fourthId = messageIds[4]!;
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/v1/sessions/${sessionId}/messages?limit=2&before=${fourthId}`,
      headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      messages: Array<{ content: string }>;
      hasMore: boolean;
    };
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0]!.content).toBe("msg-2");
    expect(body.messages[1]!.content).toBe("msg-3");
    expect(body.hasMore).toBe(true);
  });

  it("rejects optimistic client id as before cursor", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/v1/sessions/${sessionId}/messages?limit=2&before=u-1234567890`,
      headers: AUTH,
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe("validation_failed");
  });
});
