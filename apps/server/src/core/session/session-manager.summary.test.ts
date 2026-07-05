import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaRunEventLog } from "../eventlog/prisma-run-event-log.js";
import { SessionManager } from "./session-manager.js";
import { disconnectDb, prisma } from "../../db/client.js";
import { useTestDatabase } from "../../test-helpers/db.js";
import type { SdkAdapter, SdkAgentHandle } from "../sdk/sdk-adapter.js";

function mockSdkAgent(text: string): SdkAgentHandle {
  return {
    agentId: "mock-agent-1",
    send: vi.fn().mockResolvedValue({
      streamEvents: async function* () {
        yield { type: "assistant" as const, text };
      },
      wait: async () => ({ status: "finished" as const }),
      cancel: async () => {},
    }),
    dispose: vi.fn(),
  };
}

describe("SessionManager session summary (UR-16)", () => {
  let sessionManager: SessionManager;
  let sdk: {
    createAgent: ReturnType<typeof vi.fn>;
    resumeAgent: ReturnType<typeof vi.fn>;
  };
  let sessionId: string;
  let projectId: string;
  let runId: string;

  beforeAll(async () => {
    await useTestDatabase("file:./test-session-mgr-summary.db");
    const eventLog = new PrismaRunEventLog();
    await eventLog.init();

    const agent = mockSdkAgent("Applied login fix");
    sdk = {
      createAgent: vi.fn().mockResolvedValue(agent),
      resumeAgent: vi.fn().mockResolvedValue(agent),
    };

    sessionManager = new SessionManager({
      eventLog,
      sdk: sdk as unknown as SdkAdapter,
      apiKey: "test-key",
      agentCacheMax: 4,
      autoSnapshot: false,
    });

    const project = await prisma.project.create({
      data: {
        userId: "dev-user",
        name: "mgr-summary",
        rootPath: "./test-mgr-summary-ws",
        status: "active",
      },
    });
    projectId = project.id;

    const session = await prisma.session.create({
      data: {
        projectId,
        model: "composer-2.5",
        status: "idle",
        agentId: "mock-agent-1",
      },
    });
    sessionId = session.id;

    await prisma.message.create({
      data: { sessionId, role: "user", content: "fix login page" },
    });

    const run = await prisma.run.create({
      data: { sessionId, status: "queued" },
    });
    runId = run.id;
  });

  afterAll(async () => {
    await disconnectDb();
  });

  it("updates Session.summary after successful executeRun", async () => {
    await sessionManager.executeRun(runId, sessionId, projectId, "fix login page");
    const row = await prisma.session.findUnique({ where: { id: sessionId } });
    expect(row?.summary).toContain("fix login page");
    expect(row?.summary).toContain("Applied login fix");
  });

  it("updates Session.summary when acquireAgent fails on last attempt", async () => {
    const failSession = await prisma.session.create({
      data: {
        projectId,
        model: "composer-2.5",
        status: "idle",
        agentId: "broken-agent",
      },
    });
    await prisma.message.create({
      data: {
        sessionId: failSession.id,
        role: "user",
        content: "startup fail case",
      },
    });
    const failRun = await prisma.run.create({
      data: { sessionId: failSession.id, status: "queued" },
    });

    sdk.resumeAgent.mockRejectedValueOnce(new Error("SDK unavailable"));

    await sessionManager.executeRun(
      failRun.id,
      failSession.id,
      projectId,
      "hello",
      { isLastAttempt: true },
    );

    const row = await prisma.session.findUnique({
      where: { id: failSession.id },
    });
    expect(row?.summary).toContain("startup fail case");
  });
});
