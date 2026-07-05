import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { InboxHub } from "./inbox-hub.js";
import { NotificationEngine } from "./notification-engine.js";
import { disconnectDb, prisma } from "../../db/client.js";

/** P7 S30 — 메신저 아웃바운드 run_done 요약 전달 */
describe("NotificationEngine telegram outbound (S30)", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = "file:./test-s30-outbound.db";
  });

  afterAll(async () => {
    await disconnectDb();
  });

  it("forwards run_done summary via onTelegram callback", async () => {
    const hour = new Date().getHours();
    const telegramCalls: Array<{ userId: string; title: string }> = [];
    const engine = new NotificationEngine(new InboxHub(), {
      quietHoursStart: (hour + 10) % 24,
      quietHoursEnd: (hour + 12) % 24,
      onTelegram: async (userId, payload) => {
        telegramCalls.push({ userId, title: payload.title });
      },
    });

    const project = await prisma.project.create({
      data: {
        userId: "dev-user",
        name: "s30-outbound",
        rootPath: "./test-workspaces/s30",
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

    await engine.handleEnvelope({
      projectId: project.id,
      sessionId: session.id,
      runId: run.id,
      seq: 1,
      globalOffset: 1,
      event: { type: "run_done", runId: run.id, status: "finished" },
    });

    expect(telegramCalls).toHaveLength(1);
    expect(telegramCalls[0]!.userId).toBe("dev-user");
    expect(telegramCalls[0]!.title).toContain("실행");
  });

  it("forwards run error summary via onTelegram (S30 error path)", async () => {
    const hour = new Date().getHours();
    const titles: string[] = [];
    const engine = new NotificationEngine(new InboxHub(), {
      quietHoursStart: (hour + 10) % 24,
      quietHoursEnd: (hour + 12) % 24,
      onTelegram: async (_userId, payload) => {
        titles.push(payload.title);
      },
    });

    const project = await prisma.project.create({
      data: {
        userId: "dev-user",
        name: "s30-error",
        rootPath: "./test-workspaces/s30-err",
        status: "active",
      },
    });
    const session = await prisma.session.create({
      data: {
        projectId: project.id,
        model: "composer-2.5",
        status: "error",
      },
    });
    const run = await prisma.run.create({
      data: {
        sessionId: session.id,
        status: "error",
      },
    });

    await engine.handleEnvelope({
      projectId: project.id,
      sessionId: session.id,
      runId: run.id,
      seq: 2,
      globalOffset: 2,
      event: { type: "run_done", runId: run.id, status: "error" },
    });

    expect(titles.some((t) => t.includes("오류"))).toBe(true);
  });
});
