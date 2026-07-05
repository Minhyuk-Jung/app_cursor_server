import { ChannelSource, Scope as ScopeEnum } from "@app/shared";
import type { AuthContext } from "../../auth/auth.js";
import type { CommandHandler } from "../../core/command/command-handler.js";
import type { DevChatOpsCommand } from "../shared/dev-chatops.js";

export interface DevChatOpsInboundResult {
  ok: boolean;
  reason?: string;
  httpStatus?: number;
  data?: unknown;
}

export async function executeDevChatOpsCommand(
  commandHandler: CommandHandler,
  authCtx: AuthContext,
  requestId: string,
  channelSource: (typeof ChannelSource)[keyof typeof ChannelSource],
  cmd: DevChatOpsCommand,
): Promise<DevChatOpsInboundResult> {
  const commandFrom = (
    kind: string,
    extra: Record<string, unknown>,
  ) => ({
    kind,
    source: channelSource,
    requestId,
    ...extra,
  });

  if (cmd.kind === "status") {
    const result = await commandHandler.handleWithLock(
      commandFrom("status", { scope: "all" }),
      authCtx,
    );
    return toInboundResult(result);
  }

  if (cmd.kind === "create_project") {
    const result = await commandHandler.handleWithLock(
      commandFrom("create_project", {
        name: cmd.name,
        gitUrl: cmd.gitUrl,
      }),
      authCtx,
    );
    return toInboundResult(result);
  }

  if (cmd.kind === "approve") {
    const result = await commandHandler.handleWithLock(
      commandFrom("approve", {
        approvalId: cmd.approvalId,
        decision: cmd.decision,
      }),
      authCtx,
    );
    return toInboundResult(result);
  }

  if (cmd.kind === "cancel") {
    const result = await commandHandler.handleWithLock(
      commandFrom("cancel", { runId: cmd.runId }),
      authCtx,
    );
    return toInboundResult(result);
  }

  if (cmd.kind === "exec_command") {
    const result = await commandHandler.handleWithLock(
      commandFrom("exec_command", {
        projectId: cmd.projectId,
        command: cmd.command,
      }),
      authCtx,
    );
    return {
      ok: result.ok,
      ...(result.ok
        ? { httpStatus: result.httpStatus ?? 200, data: result.data }
        : {
            reason: result.error.code,
          }),
    };
  }

  const result = await commandHandler.handleWithLock(
    commandFrom("send_prompt", {
      sessionId: cmd.sessionId,
      text: cmd.text,
    }),
    authCtx,
  );
  return toInboundResult(result);
}

function toInboundResult(
  result: Awaited<ReturnType<CommandHandler["handleWithLock"]>>,
): DevChatOpsInboundResult {
  if (result.ok) {
    return {
      ok: true,
      httpStatus: result.httpStatus ?? 200,
      data: result.data,
    };
  }
  return {
    ok: false,
    reason: result.error.code,
  };
}

export const INTRANET_CHANNEL_SCOPES = [
  ScopeEnum.PROJECT_READ,
  ScopeEnum.PROJECT_WRITE,
  ScopeEnum.PROMPT_SEND,
  ScopeEnum.RUN_CANCEL,
  ScopeEnum.APPROVAL_RESOLVE,
  ScopeEnum.TERMINAL_EXEC,
] as const;
