import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, shutdownApp, type AppContext } from "../app.js";
import { disconnectDb, prisma } from "../db/client.js";
import { useTestDatabase } from "../test-helpers/db.js";

const AUTH = { authorization: "Bearer dev-local-key" };
const MAESTRO_GIT_TITLE = "Maestro Git";

describe("Maestro inbox seed (P7 mobile 28차)", () => {
  let ctx: AppContext;
  let projectId: string;

  beforeAll(async () => {
    process.env.E2E_INBOX_SEED = "true";
    await useTestDatabase("file:./test-maestro-inbox-seed.db");
    ctx = await createApp({ port: 0, sandboxMode: "subprocess" });

    const project = await prisma.project.create({
      data: {
        userId: "dev-user",
        name: "maestro-e2e",
        rootPath: "./test-maestro-inbox-ws",
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

  it("seeds git_status inbox item for Maestro deeplink flow", async () => {
    const seedRes = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/e2e/inbox/seed",
      headers: AUTH,
      payload: {
        projectId,
        kind: "git_status",
        deeplink: `/project/${projectId}/git`,
        title: MAESTRO_GIT_TITLE,
        summary: "Maestro git_status deeplink seed",
      },
    });
    expect(seedRes.statusCode).toBe(200);

    const inboxRes = await ctx.app.inject({
      method: "GET",
      url: "/api/v1/inbox",
      headers: AUTH,
    });
    expect(inboxRes.statusCode).toBe(200);
    const body = inboxRes.json() as {
      items: Array<{ title: string; deeplink: string; kind: string }>;
    };
    const hit = body.items.find((item) => item.title === MAESTRO_GIT_TITLE);
    expect(hit).toBeDefined();
    expect(hit?.kind).toBe("git_status");
    expect(hit?.deeplink).toBe(`/project/${projectId}/git`);
  });
});
