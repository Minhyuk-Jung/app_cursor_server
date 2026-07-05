import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, shutdownApp, type AppContext } from "../app.js";
import { disconnectDb, prisma } from "../db/client.js";
import { useTestDatabase } from "../test-helpers/db.js";

const AUTH = { authorization: "Bearer dev-local-key" };

describe("E2E session seed (S26/S27)", () => {
  let ctx: AppContext;
  let projectId: string;

  beforeAll(async () => {
    process.env.E2E_INBOX_SEED = "true";
    await useTestDatabase("file:./test-e2e-session-seed.db");
    ctx = await createApp({ port: 0, sandboxMode: "subprocess" });

    const project = await prisma.project.create({
      data: {
        userId: "dev-user",
        name: "e2e-seed-proj",
        rootPath: "./test-e2e-seed-ws",
        status: "active",
      },
    });
    projectId = project.id;
  });

  afterAll(async () => {
    await ctx.telegramPullPoller?.stop();
    await ctx.intranetPullPoller?.stop();
    await shutdownApp(ctx);
    await ctx.app.close();
    await disconnectDb();
  });

  it("creates session row without SDK", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/e2e/session/seed",
      headers: AUTH,
      payload: { projectId, title: "seeded", model: "composer-2.5" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { sessionId: string; title: string };
    expect(body.sessionId).toBeTruthy();
    expect(body.title).toBe("seeded");

    const row = await prisma.session.findUnique({ where: { id: body.sessionId } });
    expect(row?.agentId).toBe("e2e-stub-agent");
    expect(row?.source).toBe("e2e");
  });
});
