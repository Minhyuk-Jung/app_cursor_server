import { ChannelSource } from "@app/shared";
import type { AuthContext } from "../../auth/auth.js";
import { resolveChannelUser } from "../../auth/channel-link.js";
import { TELEGRAM_CHANNEL_SCOPES } from "../../auth/channel-scopes.js";
import type { ServerConfig } from "../../config.js";
import type { CommandHandler } from "../../core/command/command-handler.js";
import { devChatOpsHelpText, parseDevChatOps } from "../shared/dev-chatops.js";
import { executeDevChatOpsCommand } from "../shared/dev-chatops-inbound.js";
import { telegramUpdateRequestIdLogical } from "../shared/channel-request-id.js";
import {
  formatTelegramExecResult,
  sendTelegramMessage,
  telegramLinkHelp,
  type TelegramUpdate,
} from "./telegram-adapter.js";

export interface TelegramInboundResult {
  ok: boolean;
  ignored?: boolean;
  reason?: string;
  httpStatus?: number;
  data?: unknown;
}

/** pull 멱등 — CommandHandler idempotencyRecord 키 (S32 정합) */
export function telegramUpdateRequestId(update: TelegramUpdate): string | undefined {
  return typeof update.update_id === "number"
    ? telegramUpdateRequestIdLogical(update.update_id)
    : undefined;
}

function channelAuth(
  userId: string,
  externalUserId: string,
): AuthContext {
  return {
    subjectType: "user",
    userId,
    scopes: [...TELEGRAM_CHANNEL_SCOPES],
    channel: "telegram",
    externalUserId,
  };
}

export async function handleTelegramUpdate(
  update: TelegramUpdate,
  deps: {
    commandHandler: CommandHandler;
    config: Pick<ServerConfig, "telegramBotToken">;
    requestId?: string;
  },
): Promise<TelegramInboundResult> {
  const message = update.message;
  if (!message?.text?.trim() || message.chat?.id == null) {
    return { ok: true, ignored: true };
  }

  const chatId = String(message.chat.id);
  const requestId =
    deps.requestId ??
    telegramUpdateRequestId(update) ??
    crypto.randomUUID();

  const text = message.text.trim();
  if (!text.startsWith("/dev")) {
    return { ok: true, ignored: true };
  }

  const userId = await resolveChannelUser("telegram", chatId);
  if (!userId) {
    if (deps.config.telegramBotToken) {
      void sendTelegramMessage(
        deps.config.telegramBotToken,
        chatId,
        telegramLinkHelp(chatId),
      ).catch(() => undefined);
    }
    return { ok: false, reason: "not_linked" };
  }

  const cmd = parseDevChatOps(text);
  if (!cmd) {
    if (deps.config.telegramBotToken) {
      void sendTelegramMessage(
        deps.config.telegramBotToken,
        chatId,
        devChatOpsHelpText(),
      ).catch(() => undefined);
    }
    return {
      ok: false,
      reason: "invalid_command",
      httpStatus: 400,
    };
  }

  const authCtx = channelAuth(userId, chatId);

  if (cmd.kind === "exec_command") {
    const result = await executeDevChatOpsCommand(
      deps.commandHandler,
      authCtx,
      requestId,
      ChannelSource.TELEGRAM,
      cmd,
    );
    if (deps.config.telegramBotToken) {
      const replyText = result.ok
        ? formatTelegramExecResult(
            result.data as {
              stdout: string;
              stderr: string;
              exitCode: number | null;
            },
          )
        : (result.reason ?? "exec failed");
      void sendTelegramMessage(
        deps.config.telegramBotToken,
        chatId,
        replyText,
      ).catch(() => undefined);
    }
    return result;
  }

  const result = await executeDevChatOpsCommand(
    deps.commandHandler,
    authCtx,
    requestId,
    ChannelSource.TELEGRAM,
    cmd,
  );

  if (deps.config.telegramBotToken) {
    if (cmd.kind === "create_project" && result.ok) {
      const data = result.data as { projectId?: string } | undefined;
      void sendTelegramMessage(
        deps.config.telegramBotToken,
        chatId,
        `[project] created ${data?.projectId ?? cmd.name}`,
      ).catch(() => undefined);
    } else if (!result.ok) {
      void sendTelegramMessage(
        deps.config.telegramBotToken,
        chatId,
        `명령 실패: ${result.reason ?? "error"}`,
      ).catch(() => undefined);
    }
  }

  return result;
}

/** @deprecated 배치 offset — per-update commit 사용 권장 */
export function nextTelegramOffset(
  updates: Array<{ update_id: number }>,
  currentOffset: number,
): number {
  if (updates.length === 0) return currentOffset;
  const maxId = Math.max(...updates.map((u) => u.update_id));
  return maxId + 1;
}
