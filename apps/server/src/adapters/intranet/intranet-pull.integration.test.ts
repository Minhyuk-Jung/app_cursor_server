import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp, shutdownApp, type AppContext } from "../../app.js";
import { disconnectDb, prisma } from "../../db/client.js";
import { useTestDatabase, truncateIntegrationTables } from "../../test-helpers/db.js";import * as inboundHandler from "./intranet-inbound-handler.js";
import { runIntranetPullTick } from "./intranet-pull-poller.js";

describe("Intranet pull adapter integration (P7 S31)", () => {
  let ctx: AppContext;

  beforeAll(async () => {
    await useTestDatabase("file:./test-intranet-pull.db");
    await truncateIntegrationTables();
    process.env.WORKSPACE_ROOT = "./test-workspaces-intranet";
    process.env.JWT_SECRET = "test-intranet-pull-jwt";
    ctx = await createApp({ port: 0, sandboxMode: "subprocess" });
  });

  afterAll(async () => {
    await ctx.telegramPullPoller?.stop();
    await ctx.intranetPullPoller?.stop();
    await shutdownApp(ctx);
    await new Promise((r) => setTimeout(r, 300));
    await ctx.app.close();
    await disconnectDb();
  });

  it("runIntranetPullTick advances cursor from mocked poll API", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        messages: [{ id: "m50", chatId: "u1", text: "/dev status" }],
        cursor: "c51",
      }),
    );

    const handleSpy = vi
      .spyOn(inboundHandler, "handleIntranetMessage")
      .mockResolvedValue({ ok: true, ignored: true });

    const { cursor, processed } = await runIntranetPullTick({
      config: {
        ...ctx.config,
        intranetMessengerPollUrl: "https://intranet.local/api/messages",
      },
      commandHandler: ctx.commandHandler,
      fetchImpl,
      cursor: "",
    });

    expect(processed).toBe(1);
    expect(cursor).toBe("c51");
    expect(handleSpy).toHaveBeenCalledOnce();
    handleSpy.mockRestore();
  });

  it("handleIntranetMessage routes linked user send_prompt to command handler", async () => {
    const chatId = `intranet-${Date.now()}`;
    await prisma.channelLink.create({
      data: {
        userId: "dev-user",
        channel: "intranet",
        externalUserId: chatId,
      },
    });

    const session = await prisma.session.create({
      data: {
        projectId: (
          await prisma.project.create({
            data: {
              userId: "dev-user",
              name: "intranet-pull-route",
              rootPath: "./test-workspaces/intranet-pull-route",
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

    const result = await inboundHandler.handleIntranetMessage(
      {
        id: "msg-1",
        chatId,
        text: `/dev prompt ${session.id} hello via intranet pull`,
      },
      { commandHandler: ctx.commandHandler },
    );

    expect(result.ok).toBe(true);
    expect(handleSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "send_prompt",
        sessionId: session.id,
        text: "hello via intranet pull",
      }),
      expect.objectContaining({ userId: "dev-user", channel: "intranet" }),
    );
    handleSpy.mockRestore();
  });

  it("send_prompt reaches DB without command handler mock (S31 real path)", async () => {
    const chatId = `intranet-real-${Date.now()}`;
    await prisma.channelLink.create({
      data: {
        userId: "dev-user",
        channel: "intranet",
        externalUserId: chatId,
      },
    });

    const session = await prisma.session.create({
      data: {
        projectId: (
          await prisma.project.create({
            data: {
              userId: "dev-user",
              name: "intranet-real",
              rootPath: "./test-workspaces/intranet-real",
              status: "active",
            },
          })
        ).id,
        model: "composer-2.5",
        status: "idle",
      },
    });

    const notify = vi.fn(async () => undefined);
    const result = await inboundHandler.handleIntranetMessage(
      {
        id: `real-${Date.now()}`,
        chatId,
        text: `/dev prompt ${session.id} hello real path`,
      },
      { commandHandler: ctx.commandHandler, notify },
    );

    expect(result.ok).toBe(true);

    const msg = await prisma.message.findFirst({
      where: { sessionId: session.id, role: "user" },
      orderBy: { createdAt: "desc" },
    });
    expect(msg?.content).toBe("hello real path");
  });
});
