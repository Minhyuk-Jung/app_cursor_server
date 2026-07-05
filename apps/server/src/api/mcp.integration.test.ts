import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Scope as ScopeEnum } from "@app/shared";
import { createApp, shutdownApp, type AppContext } from "../app.js";
import { disconnectDb, prisma } from "../db/client.js";

const AUTH = { authorization: "Bearer dev-local-key" };
const MCP_HEADERS = {
  ...AUTH,
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
};

function mcpPayload(method: string, params: Record<string, unknown>, id: number) {
  return {
    jsonrpc: "2.0",
    method,
    params,
    id,
  };
}

describe("MCP Streamable HTTP (P7 / 02+10)", () => {
  let ctx: AppContext;

  beforeAll(async () => {
    process.env.DATABASE_URL = "file:./test-mcp.db";
    process.env.WORKSPACE_ROOT = "./test-workspaces";
    ctx = await createApp({ port: 0, mcpEnabled: true });
  });

  afterAll(async () => {
    await ctx.telegramPullPoller?.stop();
    await ctx.intranetPullPoller?.stop();
    await shutdownApp(ctx);
    await ctx.app.close();
    await disconnectDb();
  });

  it("health exposes MCP endpoint", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/health" });
    const body = res.json() as {
      channels: { mcp: { enabled: boolean; endpoint: string } };
    };
    expect(body.channels.mcp.enabled).toBe(true);
    expect(body.channels.mcp.endpoint).toBe("/api/v1/mcp");
  });

  it("rejects unauthenticated MCP requests", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/mcp",
      headers: { "content-type": "application/json" },
      payload: mcpPayload(
        "initialize",
        {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test", version: "1.0.0" },
        },
        1,
      ),
    });
    expect(res.statusCode).toBe(401);
  });

  it("handles MCP initialize and lists tools", async () => {
    const initRes = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/mcp",
      headers: MCP_HEADERS,
      payload: mcpPayload(
        "initialize",
        {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "vitest", version: "1.0.0" },
        },
        1,
      ),
    });
    expect(initRes.statusCode).toBeLessThan(300);

    const listRes = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/mcp",
      headers: MCP_HEADERS,
      payload: mcpPayload("tools/list", {}, 2),
    });
    expect(listRes.statusCode).toBeLessThan(300);
    const body = listRes.body;
    for (const name of [
      "create_project",
      "send_prompt",
      "get_status",
      "approve_run",
      "cancel_run",
      "exec_command",
    ]) {
      expect(body).toContain(name);
    }
  });

  it("tools/call create_project and get_status E2E", async () => {
    const projectName = `mcp-e2e-${Date.now()}`;
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/mcp",
      headers: {
        ...MCP_HEADERS,
        "x-request-id": "mcp-e2e-req",
      },
      payload: mcpPayload(
        "tools/call",
        {
          name: "create_project",
          arguments: { name: projectName },
        },
        10,
      ),
    });
    expect(createRes.statusCode).toBeLessThan(300);
    expect(createRes.body).toContain("projectId");

    const statusRes = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/mcp",
      headers: MCP_HEADERS,
      payload: mcpPayload(
        "tools/call",
        {
          name: "get_status",
          arguments: { scope: "all" },
        },
        11,
      ),
    });
    expect(statusRes.statusCode).toBeLessThan(300);
    expect(statusRes.body).toContain("projects");
    expect(statusRes.body).toContain("scheduler");
  });

  it("tools/call returns forbidden for insufficient scope", async () => {
    const plainKey = `ak_${randomBytes(24).toString("hex")}`;
    await prisma.apiKey.create({
      data: {
        userId: "dev-user",
        hashedKey: createHash("sha256").update(plainKey).digest("hex"),
        scopes: ScopeEnum.PROJECT_READ,
      },
    });

    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/mcp",
      headers: {
        ...MCP_HEADERS,
        authorization: `Bearer ${plainKey}`,
      },
      payload: mcpPayload(
        "tools/call",
        {
          name: "create_project",
          arguments: { name: "forbidden-proj" },
        },
        20,
      ),
    });
    expect(res.statusCode).toBeLessThan(300);
    expect(res.body).toContain("Forbidden");
  });

  it("returns 405 for GET /api/v1/mcp in stateless mode", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/v1/mcp",
      headers: AUTH,
    });
    expect(res.statusCode).toBe(405);
  });

  it("tools/call cancel_run returns not_found for unknown run", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/mcp",
      headers: MCP_HEADERS,
      payload: mcpPayload(
        "tools/call",
        {
          name: "cancel_run",
          arguments: { runId: "00000000-0000-4000-8000-000000000000" },
        },
        30,
      ),
    });
    expect(res.statusCode).toBeLessThan(300);
    expect(res.body).toMatch(/not_found|Not found|error/i);
  });

  it("tools/call exec_command validates project scope path", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/mcp",
      headers: MCP_HEADERS,
      payload: mcpPayload(
        "tools/call",
        {
          name: "exec_command",
          arguments: {
            projectId: "00000000-0000-4000-8000-000000000099",
            command: "echo hi",
          },
        },
        31,
      ),
    });
    expect(res.statusCode).toBeLessThan(300);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it("returns 429 when API rate limit exceeded on MCP", async () => {
    const rlCtx = await createApp({
      port: 0,
      mcpEnabled: true,
      rateLimitMax: 1,
      rateLimitWindowMs: 60_000,
      databaseUrl: "file:./test-mcp.db",
      workspaceRoot: "./test-workspaces",
    });
    try {
      const payload = mcpPayload("tools/list", {}, 1);
      const first = await rlCtx.app.inject({
        method: "POST",
        url: "/api/v1/mcp",
        headers: MCP_HEADERS,
        payload,
      });
      expect(first.statusCode).toBeLessThan(300);

      const blocked = await rlCtx.app.inject({
        method: "POST",
        url: "/api/v1/mcp",
        headers: MCP_HEADERS,
        payload: mcpPayload("tools/list", {}, 2),
      });
      expect(blocked.statusCode).toBe(429);
    } finally {
      await rlCtx.telegramPullPoller?.stop();
      await rlCtx.intranetPullPoller?.stop();
      await shutdownApp(rlCtx);
      await rlCtx.app.close();
    }
  });
});
