import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { AuthService } from "../auth/auth.js";
import type { ServerConfig } from "../config.js";
import type { CommandHandler } from "../core/command/command-handler.js";
import { createMcpServer } from "../mcp/create-mcp-server.js";
import {
  mcpRequestIdPrefix,
  parseJsonRpcId,
} from "../mcp/mcp-request-id.js";
import { sendError } from "./errors.js";

const MCP_ACCEPT = "application/json, text/event-stream";

function mcpMethodNotAllowed(reply: FastifyReply): void {
  reply
    .status(405)
    .header("content-type", "application/json")
    .send({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    });
}

function headerRequestId(request: FastifyRequest): string {
  const header = request.headers["x-request-id"];
  if (typeof header === "string" && header.length > 0) return header;
  return crypto.randomUUID();
}

async function handleMcpPost(
  request: FastifyRequest,
  reply: FastifyReply,
  commandHandler: CommandHandler,
): Promise<void> {
  if (!request.auth) {
    return sendError(reply, {
      code: "unauthorized",
      message: "Authentication required",
      retryable: false,
    });
  }

  const requestIdPrefix = mcpRequestIdPrefix(
    headerRequestId(request),
    parseJsonRpcId(request.body),
  );

  const server = createMcpServer({
    commandHandler,
    auth: request.auth,
    requestIdPrefix,
  });

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  reply.hijack();

  try {
    await server.connect(transport);
    reply.raw.on("close", () => {
      void transport.close().catch(() => undefined);
      void server.close().catch(() => undefined);
    });
    await transport.handleRequest(request.raw, reply.raw, request.body);
  } catch (err) {
    console.error("[mcp] request error:", err);
    if (!reply.raw.headersSent) {
      reply.raw.statusCode = 500;
      reply.raw.setHeader("content-type", "application/json");
      reply.raw.end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        }),
      );
    }
  }
}

export async function registerMcpRoutes(
  app: FastifyInstance,
  _auth: AuthService,
  commandHandler: CommandHandler,
  config: ServerConfig,
): Promise<void> {
  if (!config.mcpEnabled) return;

  app.post("/api/v1/mcp", async (request, reply) =>
    handleMcpPost(request, reply, commandHandler),
  );

  app.get("/api/v1/mcp", async (_request, reply) => {
    mcpMethodNotAllowed(reply);
  });

  app.delete("/api/v1/mcp", async (_request, reply) => {
    mcpMethodNotAllowed(reply);
  });
}

export { MCP_ACCEPT };
