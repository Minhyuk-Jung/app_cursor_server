import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, shutdownApp, type AppContext } from "../app.js";
import { disconnectDb, prisma } from "../db/client.js";
import { useTestDatabase } from "../test-helpers/db.js";
const AUTH = { authorization: "Bearer dev-local-key" };

/** UR-15/S27 — attachment upload + send_prompt message content */
describe("send_prompt attachments (UR-15)", () => {
  let ctx: AppContext;
  let projectId: string;
  let sessionId: string;

  beforeAll(async () => {
    await useTestDatabase("file:./test-att-send.db");
    process.env.WORKSPACE_ROOT = "./test-workspaces-att";
    ctx = await createApp({ port: 0, sandboxMode: "subprocess" });

    const project = await prisma.project.create({
      data: {
        userId: "dev-user",
        name: "att-proj",
        rootPath: "./test-workspaces-att/proj",
        status: "active",
      },
    });
    projectId = project.id;
    const session = await prisma.session.create({
      data: {
        projectId,
        model: "composer-2.5",
        status: "idle",
      },
    });
    sessionId = session.id;
  });

  afterAll(async () => {
    await ctx.telegramPullPoller?.stop();
    await ctx.intranetPullPoller?.stop();
    await shutdownApp(ctx);
    await ctx.app.close();
    await disconnectDb();
  });

  it("resolves image attachment into user message display text", async () => {
    const png = Buffer.from("fake-image-bytes").toString("base64");
    const up = await ctx.app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/attachments`,
      headers: { ...AUTH, "content-type": "application/json" },
      payload: { dataBase64: png, mime: "image/png" },
    });
    expect(up.statusCode).toBe(201);
    const { ref } = up.json() as { ref: string };

    const send = await ctx.app.inject({
      method: "POST",
      url: `/api/v1/sessions/${sessionId}/messages`,
      headers: { ...AUTH, "content-type": "application/json" },
      payload: {
        text: "analyze screenshot",
        attachments: [{ kind: "image", ref, mime: "image/png" }],
      },
    });
    expect(send.statusCode).toBeLessThan(300);

    const msg = await prisma.message.findFirst({
      where: { sessionId, role: "user" },
      orderBy: { createdAt: "desc" },
    });
    expect(msg?.content).toBe("analyze screenshot");
    expect(msg?.content).not.toContain("📷");
    expect(msg?.attachmentsJson).toBeTruthy();
    const stored = JSON.parse(msg!.attachmentsJson!) as Array<{ kind: string; ref: string }>;
    expect(stored).toHaveLength(1);
    expect(stored[0]!.ref).toBe(ref);
    expect(stored[0]!.kind).toBe("image");
  });

  it("GET attachment returns stored mime type", async () => {
    const png = Buffer.from("mime-test").toString("base64");
    const up = await ctx.app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/attachments`,
      headers: { ...AUTH, "content-type": "application/json" },
      payload: { dataBase64: png, mime: "image/png" },
    });
    const { ref } = up.json() as { ref: string };

    const get = await ctx.app.inject({
      method: "GET",
      url: `/api/v1/projects/${projectId}/attachments/${ref}`,
      headers: AUTH,
    });
    expect(get.statusCode).toBe(200);
    expect(get.headers["content-type"]).toContain("image/png");
  });
});
