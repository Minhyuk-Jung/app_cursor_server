import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, shutdownApp, type AppContext } from "../../app.js";
import { buildRuleBasedSessionSummary } from "./session-summary.js";
import { disconnectDb, prisma } from "../../db/client.js";
import { useTestDatabase } from "../../test-helpers/db.js";

/** UR-16 / S19 — Session.summary rule path */
describe("session summary integration (UR-16)", () => {
  let ctx: AppContext;
  let sessionId: string;

  beforeAll(async () => {
    await useTestDatabase("file:./test-session-summary.db");
    ctx = await createApp({ port: 0, sandboxMode: "subprocess" });

    const project = await prisma.project.create({
      data: {
        userId: "dev-user",
        name: "summary-proj",
        rootPath: "./test-summary-ws",
        status: "active",
      },
    });
    const session = await prisma.session.create({
      data: { projectId: project.id, model: "composer-2.5", status: "idle" },
    });
    sessionId = session.id;

    await prisma.message.createMany({
      data: [
        { sessionId, role: "user", content: "add login page" },
        { sessionId, role: "assistant", content: "Created Login.tsx" },
      ],
    });
  });

  afterAll(async () => {
    await ctx.telegramPullPoller?.stop();
    await ctx.intranetPullPoller?.stop();
    await shutdownApp(ctx);
    await ctx.app.close();
    await disconnectDb();
  });

  it("persists rule-based summary for session list (S19)", async () => {
    const messages = await prisma.message.findMany({
      where: { sessionId },
      orderBy: { createdAt: "desc" },
      take: 8,
    });
    const summary = buildRuleBasedSessionSummary(messages);
    await prisma.session.update({
      where: { id: sessionId },
      data: { summary },
    });

    const row = await prisma.session.findUnique({ where: { id: sessionId } });
    expect(row?.summary).toContain("add login page");
    expect(row?.summary).toContain("Created Login.tsx");
  });
});
