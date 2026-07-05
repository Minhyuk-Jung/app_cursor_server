import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ChannelSource } from "@app/shared";
import {
  parseCustomInbound,
  verifyCustomSignature,
  verifyWebhookTimestamp,
} from "../adapters/custom/custom-adapter.js";
import {
  parseTelegramInbound,
  verifyTelegramWebhookSecret,
} from "../adapters/telegram/telegram-adapter.js";
import { handleTelegramUpdate } from "../adapters/telegram/telegram-inbound-handler.js";
import type { AuthContext } from "../auth/auth.js";
import type { createAuthService } from "../auth/auth.js";
import { Scope as ScopeEnum } from "@app/shared";
import type { ServerConfig } from "../config.js";
import type { CommandHandler } from "../core/command/command-handler.js";
import { sendError } from "./errors.js";

type AuthService = ReturnType<typeof createAuthService>;

const CUSTOM_CHANNEL_SCOPES = [
  ScopeEnum.PROJECT_READ,
  ScopeEnum.PROJECT_WRITE,
  ScopeEnum.PROMPT_SEND,
  ScopeEnum.RUN_CANCEL,
  ScopeEnum.APPROVAL_RESOLVE,
  ScopeEnum.GIT_WRITE,
] as const;

function requestIdFrom(req: FastifyRequest): string {
  const header = req.headers["x-request-id"];
  if (typeof header === "string" && header.length > 0) return header;
  return crypto.randomUUID();
}

function commandFrom(
  req: FastifyRequest,
  kind: string,
  source: string,
  extra: Record<string, unknown>,
) {
  return {
    kind,
    source,
    requestId: requestIdFrom(req),
    ...extra,
  };
}

async function runCommand(
  handler: CommandHandler,
  authCtx: AuthContext,
  body: unknown,
  reply: FastifyReply,
) {
  const result = await handler.handleWithLock(body, authCtx);
  if (!result.ok) {
    return sendError(reply, result.error);
  }
  return reply.status(result.httpStatus ?? 200).send(result.data);
}

export async function registerWebhookRoutes(
  app: FastifyInstance,
  auth: AuthService,
  commandHandler: CommandHandler,
  config: ServerConfig,
): Promise<void> {
  app.post<{ Params: { channel: string } }>(
    "/api/v1/webhooks/:channel",
    async (request, reply) => {
      const channel = request.params.channel;

      if (channel === "custom") {
        return handleCustomWebhook(
          request,
          reply,
          auth,
          commandHandler,
          config,
        );
      }

      if (channel === "telegram") {
        return handleTelegramWebhook(request, reply, commandHandler, config);
      }

      return sendError(reply, {
        code: "not_found",
        message: "Unknown channel",
        retryable: false,
      });
    },
  );
}

async function handleCustomWebhook(
  request: FastifyRequest,
  reply: FastifyReply,
  auth: AuthService,
  commandHandler: CommandHandler,
  config: ServerConfig,
) {
  const raw = JSON.stringify(request.body ?? {});
  const sig = request.headers["x-signature"];
  const ts = request.headers["x-webhook-timestamp"];
  if (
    config.webhookSecret &&
    !verifyWebhookTimestamp(typeof ts === "string" ? ts : undefined)
  ) {
    return sendError(reply, {
      code: "forbidden",
      message: "Invalid or missing webhook timestamp",
      retryable: false,
    });
  }
  if (
    !verifyCustomSignature(
      raw,
      typeof sig === "string" ? sig : undefined,
      config.webhookSecret,
    )
  ) {
    return sendError(reply, {
      code: "forbidden",
      message: "Invalid webhook signature",
      retryable: false,
    });
  }

  const apiKey = request.headers.authorization?.replace("Bearer ", "");
  if (!apiKey) {
    return sendError(reply, {
      code: "unauthorized",
      message: "Bearer token required",
      retryable: false,
    });
  }

  const authCtx = await auth.authenticate(request);
  if (!authCtx) {
    return sendError(reply, {
      code: "unauthorized",
      message: "Invalid token",
      retryable: false,
    });
  }

  const parsed = parseCustomInbound(
    request.body as Parameters<typeof parseCustomInbound>[0],
  );
  if (!parsed) {
    return sendError(reply, {
      code: "validation_failed",
      message: "sessionId and text required for prompt command",
      retryable: false,
    });
  }

  if (parsed.kind === "status") {
    return runCommand(
      commandHandler,
      authCtx,
      commandFrom(request, "status", ChannelSource.CUSTOM, { scope: "all" }),
      reply,
    );
  }

  if (parsed.kind === "exec_command") {
    return runCommand(
      commandHandler,
      authCtx,
      commandFrom(request, "exec_command", ChannelSource.CUSTOM, {
        projectId: parsed.projectId,
        command: parsed.command,
      }),
      reply,
    );
  }

  return runCommand(
    commandHandler,
    authCtx,
    commandFrom(request, "send_prompt", ChannelSource.CUSTOM, {
      sessionId: parsed.sessionId,
      text: parsed.text,
    }),
    reply,
  );
}

async function handleTelegramWebhook(
  request: FastifyRequest,
  reply: FastifyReply,
  commandHandler: CommandHandler,
  config: ServerConfig,
) {
  if (config.telegramPullMode) {
    return sendError(reply, {
      code: "conflict",
      message:
        "Telegram inbound uses pull mode (TELEGRAM_PULL_MODE=true); push webhook disabled",
      retryable: false,
    });
  }

  const secretHeader = request.headers["x-telegram-secret"];
  if (
    !verifyTelegramWebhookSecret(
      typeof secretHeader === "string" ? secretHeader : undefined,
      config.telegramWebhookSecret,
    )
  ) {
    return sendError(reply, {
      code: "forbidden",
      message: "Invalid telegram webhook secret",
      retryable: false,
    });
  }

  const parsed = parseTelegramInbound(
    request.body as Parameters<typeof parseTelegramInbound>[0],
  );
  if (!parsed) {
    return reply.send({ ok: true, ignored: true });
  }

  const result = await handleTelegramUpdate(
    request.body as Parameters<typeof parseTelegramInbound>[0],
    {
      commandHandler,
      config,
      requestId: requestIdFrom(request),
    },
  );

  if (result.ignored) {
    return reply.send({ ok: true, ignored: true });
  }
  if (!result.ok) {
    if (result.reason === "not_linked") {
      return reply.send({ ok: false, reason: "not_linked" });
    }
    if (result.httpStatus && result.httpStatus >= 400) {
      return sendError(reply, {
        code: result.reason ?? "validation_failed",
        message: "Invalid telegram command",
        retryable: false,
      });
    }
    return reply.send({ ok: false, reason: result.reason });
  }

  if (result.data !== undefined) {
    return reply.status(result.httpStatus ?? 200).send(result.data);
  }
  return reply.send({ ok: true });
}
