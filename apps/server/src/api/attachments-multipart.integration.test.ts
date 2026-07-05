import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, shutdownApp, type AppContext } from "../app.js";
import { disconnectDb, prisma } from "../db/client.js";
import { MAX_ATTACHMENT_BYTES } from "../services/file/file-service.js";
import { useTestDatabase } from "../test-helpers/db.js";

const AUTH = { authorization: "Bearer dev-local-key" };

function multipartBody(
  boundary: string,
  fileBytes: string,
  fieldName = "file",
): string {
  return [
    `--${boundary}`,
    `Content-Disposition: form-data; name="${fieldName}"; filename="shot.png"`,
    "Content-Type: image/png",
    "",
    fileBytes,
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

/** 02-api §6 — multipart attachment upload (UR-15 5차/6차) */
describe("POST attachments multipart (UR-15)", () => {
  let ctx: AppContext;
  let projectId: string;

  beforeAll(async () => {
    await useTestDatabase("file:./test-att-multipart.db");
    process.env.WORKSPACE_ROOT = "./test-workspaces-att-mp";
    ctx = await createApp({ port: 0, sandboxMode: "subprocess" });

    const project = await prisma.project.create({
      data: {
        userId: "dev-user",
        name: "att-mp-proj",
        rootPath: "./test-workspaces-att-mp/proj",
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

  it("accepts multipart/form-data file upload per 02-api contract", async () => {
    const boundary = "----vitestMultipart";
    const fileBytes = "multipart-png-bytes";

    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/attachments`,
      headers: {
        ...AUTH,
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload: multipartBody(boundary, fileBytes),
    });

    expect(res.statusCode).toBe(201);
    const body = res.json() as { ref: string; mime?: string; size: number };
    expect(body.ref).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(body.mime).toBe("image/png");
    expect(body.size).toBe(Buffer.byteLength(fileBytes));

    const get = await ctx.app.inject({
      method: "GET",
      url: `/api/v1/projects/${projectId}/attachments/${body.ref}`,
      headers: AUTH,
    });
    expect(get.statusCode).toBe(200);
    expect(get.headers["content-type"]).toContain("image/png");
  });

  it("still accepts JSON dataBase64 upload (dual path)", async () => {
    const png = Buffer.from("json-base64-bytes").toString("base64");
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/attachments`,
      headers: { ...AUTH, "content-type": "application/json" },
      payload: { dataBase64: png, mime: "image/png" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { ref: string; size: number };
    expect(body.size).toBe(Buffer.byteLength("json-base64-bytes"));
  });

  it("rejects multipart without file field", async () => {
    const boundary = "----vitestEmpty";
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/attachments`,
      headers: {
        ...AUTH,
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload: [`--${boundary}`, `--${boundary}--`, ""].join("\r\n"),
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects oversize multipart upload (NFR-33)", async () => {
    const boundary = "----vitestBig";
    const big = "x".repeat(MAX_ATTACHMENT_BYTES + 1);
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/attachments`,
      headers: {
        ...AUTH,
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload: multipartBody(boundary, big),
    });
    expect(res.statusCode).not.toBe(201);
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });
});
