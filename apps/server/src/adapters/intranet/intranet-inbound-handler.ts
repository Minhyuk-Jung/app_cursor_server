import type { CommandHandler } from "../../core/command/command-handler.js";
import type { ServerConfig } from "../../config.js";
import { ChannelSource } from "@app/shared";
import type { AuthContext } from "../../auth/auth.js";
import { resolveChannelUser } from "../../auth/channel-link.js";
import { devChatOpsHelpText, parseDevChatOps } from "../shared/dev-chatops.js";
import {
  executeDevChatOpsCommand,
  INTRANET_CHANNEL_SCOPES,
} from "../shared/dev-chatops-inbound.js";
import type { IntranetPollMessage } from "./intranet-messenger-adapter.js";
import { intranetMessageRequestId } from "./intranet-messenger-adapter.js";

export interface IntranetInboundResult {
  ok: boolean;
  ignored?: boolean;
  reason?: string;
}

function channelAuth(userId: string, externalUserId: string): AuthContext {
  return {
    subjectType: "user",
    userId,
    scopes: [...INTRANET_CHANNEL_SCOPES],
    channel: "intranet" as AuthContext["channel"],
    externalUserId,
  };
}

export async function handleIntranetMessage(
  message: IntranetPollMessage,
  deps: {
    commandHandler: CommandHandler;
    requestId?: string;
    notify?: (chatId: string, text: string) => Promise<void>;
  },
): Promise<IntranetInboundResult> {
  const text = message.text.trim();
  if (!text.startsWith("/dev")) {
    return { ok: true, ignored: true };
  }

  const requestId = deps.requestId ?? intranetMessageRequestId(message.id);

  const userId = await resolveChannelUser("intranet", message.chatId);
  if (!userId) {
    await deps.notify?.(
      message.chatId,
      `계정 미연결. channel=intranet externalUserId=${message.chatId}`,
    );
    return { ok: false, reason: "not_linked" };
  }

  const cmd = parseDevChatOps(text);
  if (!cmd) {
    await deps.notify?.(message.chatId, devChatOpsHelpText());
    return { ok: false, reason: "invalid_command" };
  }

  const authCtx = channelAuth(userId, message.chatId);
  const result = await executeDevChatOpsCommand(
    deps.commandHandler,
    authCtx,
    requestId,
    ChannelSource.CUSTOM,
    cmd,
  );

  if (!result.ok) {
    await deps.notify?.(
      message.chatId,
      `명령 실패: ${result.reason ?? "error"}`,
    );
  } else if (cmd.kind === "create_project") {
    const data = result.data as { projectId?: string } | undefined;
    await deps.notify?.(
      message.chatId,
      `[project] created ${data?.projectId ?? cmd.name}`,
    );
  }

  return { ok: result.ok, reason: result.reason };
}

export type IntranetPullConfig = Pick<
  ServerConfig,
  | "intranetMessengerPollUrl"
  | "intranetMessengerPollIntervalMs"
  | "intranetMessengerPollMaxBackoffMs"
  | "intranetMessengerAuthHeader"
  | "workspaceRoot"
>;
