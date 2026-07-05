import { ChannelSource, Scope as ScopeEnum } from "@app/shared";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AuthContext } from "../auth/auth.js";
import type { CommandHandler } from "../core/command/command-handler.js";
import { mcpToolRequestId } from "./mcp-request-id.js";

export const MCP_TOOL_NAMES = [
  "create_project",
  "send_prompt",
  "get_status",
  "approve_run",
  "cancel_run",
  "exec_command",
] as const;

export interface McpServerDeps {
  commandHandler: CommandHandler;
  auth: AuthContext;
  /** HTTP + JSON-RPC id prefix — tool별 suffix appended */
  requestIdPrefix: string;
}

function toolJson(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

function toolError(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true as const,
  };
}

async function runCommand(
  deps: McpServerDeps,
  toolName: string,
  body: Record<string, unknown>,
): Promise<{ ok: true; data: unknown } | { ok: false; message: string }> {
  const result = await deps.commandHandler.handleWithLock(
    {
      ...body,
      source: ChannelSource.CUSTOM,
      requestId: mcpToolRequestId(deps.requestIdPrefix, toolName),
    },
    deps.auth,
  );
  if (result.ok) return { ok: true, data: result.data };
  return { ok: false, message: result.error.message };
}

function requireScope(auth: AuthContext, scope: (typeof ScopeEnum)[keyof typeof ScopeEnum]) {
  return auth.scopes.includes(scope);
}

/** 10 §6.4 / 02 P7 — MCP tools → CommandHandler 위임 */
export function createMcpServer(deps: McpServerDeps): McpServer {
  const server = new McpServer(
    { name: "cursor-remote-server", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.registerTool(
    "create_project",
    {
      description: "Create a new project workspace (maps to create_project command)",
      inputSchema: {
        name: z.string().min(1).describe("Project display name"),
        gitUrl: z.string().optional().describe("Optional git repository URL to clone"),
      },
    },
    async ({ name, gitUrl }) => {
      if (!requireScope(deps.auth, ScopeEnum.PROJECT_WRITE)) {
        return toolError("Forbidden: project:write scope required");
      }
      const result = await runCommand(deps, "create_project", {
        kind: "create_project",
        name,
        gitUrl,
      });
      return result.ok ? toolJson(result.data) : toolError(result.message);
    },
  );

  server.registerTool(
    "send_prompt",
    {
      description: "Send a prompt to a session (maps to send_prompt command)",
      inputSchema: {
        sessionId: z.string().min(1).describe("Target session ID"),
        text: z.string().min(1).describe("Prompt text"),
      },
    },
    async ({ sessionId, text }) => {
      if (!requireScope(deps.auth, ScopeEnum.PROMPT_SEND)) {
        return toolError("Forbidden: prompt:send scope required");
      }
      const result = await runCommand(deps, "send_prompt", {
        kind: "send_prompt",
        sessionId,
        text,
      });
      return result.ok ? toolJson(result.data) : toolError(result.message);
    },
  );

  server.registerTool(
    "get_status",
    {
      description: "Query scheduler/session/project status (maps to status command)",
      inputSchema: {
        scope: z
          .enum(["all", "project", "session"])
          .optional()
          .describe("Status scope (default: all)"),
        id: z
          .string()
          .optional()
          .describe("Project or session ID when scope is project/session"),
      },
    },
    async ({ scope, id }) => {
      if (!requireScope(deps.auth, ScopeEnum.PROJECT_READ)) {
        return toolError("Forbidden: project:read scope required");
      }
      const result = await runCommand(deps, "get_status", {
        kind: "status",
        scope: scope ?? "all",
        id,
      });
      return result.ok ? toolJson(result.data) : toolError(result.message);
    },
  );

  server.registerTool(
    "approve_run",
    {
      description: "Resolve a run approval gate (maps to approve command)",
      inputSchema: {
        approvalId: z.string().min(1).describe("Approval ID"),
        decision: z
          .enum(["approve", "reject"])
          .optional()
          .describe("Decision (default: approve)"),
      },
    },
    async ({ approvalId, decision }) => {
      if (!requireScope(deps.auth, ScopeEnum.APPROVAL_RESOLVE)) {
        return toolError("Forbidden: approval:resolve scope required");
      }
      const result = await runCommand(deps, "approve_run", {
        kind: "approve",
        approvalId,
        decision: decision ?? "approve",
      });
      return result.ok ? toolJson(result.data) : toolError(result.message);
    },
  );

  server.registerTool(
    "cancel_run",
    {
      description: "Cancel an active run (maps to cancel command)",
      inputSchema: {
        runId: z.string().min(1).describe("Run ID to cancel"),
      },
    },
    async ({ runId }) => {
      if (!requireScope(deps.auth, ScopeEnum.RUN_CANCEL)) {
        return toolError("Forbidden: run:cancel scope required");
      }
      const result = await runCommand(deps, "cancel_run", {
        kind: "cancel",
        runId,
      });
      return result.ok ? toolJson(result.data) : toolError(result.message);
    },
  );

  server.registerTool(
    "exec_command",
    {
      description: "Execute a terminal command in project sandbox (maps to exec_command)",
      inputSchema: {
        projectId: z.string().min(1).describe("Project ID"),
        command: z.string().min(1).describe("Shell command"),
      },
    },
    async ({ projectId, command }) => {
      if (!requireScope(deps.auth, ScopeEnum.TERMINAL_EXEC)) {
        return toolError("Forbidden: terminal:exec scope required");
      }
      const result = await runCommand(deps, "exec_command", {
        kind: "exec_command",
        projectId,
        command,
      });
      return result.ok ? toolJson(result.data) : toolError(result.message);
    },
  );

  return server;
}
