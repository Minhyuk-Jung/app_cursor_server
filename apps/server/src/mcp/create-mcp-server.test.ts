import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Scope as ScopeEnum } from "@app/shared";
import { describe, expect, it, vi } from "vitest";
import { createMcpServer, MCP_TOOL_NAMES } from "./create-mcp-server.js";
import { mcpToolRequestId } from "./mcp-request-id.js";

async function withMcpClient(
  deps: Parameters<typeof createMcpServer>[0],
  fn: (client: Client) => Promise<void>,
): Promise<void> {
  const server = createMcpServer(deps);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    await fn(client);
  } finally {
    await client.close();
    await server.close();
  }
}

describe("createMcpServer (P7 MCP tools)", () => {
  it("lists six tools", async () => {
    const handleWithLock = vi.fn();
    await withMcpClient(
      {
        commandHandler: { handleWithLock } as never,
        auth: {
          subjectType: "user",
          userId: "dev-user",
          scopes: Object.values(ScopeEnum),
        },
        requestIdPrefix: "mcp:hdr:1",
      },
      async (client) => {
        const { tools } = await client.listTools();
        expect(tools.map((t) => t.name).sort()).toEqual([...MCP_TOOL_NAMES].sort());
      },
    );
  });

  it("delegates create_project with tool-scoped requestId", async () => {
    const handleWithLock = vi.fn(async () => ({
      ok: true as const,
      data: { projectId: "p1" },
    }));

    await withMcpClient(
      {
        commandHandler: { handleWithLock } as never,
        auth: {
          subjectType: "user",
          userId: "dev-user",
          scopes: [ScopeEnum.PROJECT_WRITE],
        },
        requestIdPrefix: "mcp:hdr:9",
      },
      async (client) => {
        const result = await client.callTool({
          name: "create_project",
          arguments: { name: "mcp-unit" },
        });
        expect(result.isError).toBeFalsy();
        expect(handleWithLock).toHaveBeenCalledWith(
          expect.objectContaining({
            kind: "create_project",
            name: "mcp-unit",
            requestId: mcpToolRequestId("mcp:hdr:9", "create_project"),
          }),
          expect.any(Object),
        );
      },
    );
  });

  it("returns forbidden when scope missing", async () => {
    const handleWithLock = vi.fn();
    await withMcpClient(
      {
        commandHandler: { handleWithLock } as never,
        auth: {
          subjectType: "user",
          userId: "dev-user",
          scopes: [ScopeEnum.PROJECT_READ],
        },
        requestIdPrefix: "mcp:hdr:2",
      },
      async (client) => {
        const result = await client.callTool({
          name: "create_project",
          arguments: { name: "nope" },
        });
        expect(result.isError).toBe(true);
        expect(JSON.stringify(result.content)).toContain("Forbidden");
        expect(handleWithLock).not.toHaveBeenCalled();
      },
    );
  });
});
