import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Scope as ScopeEnum } from "@app/shared";
import type { CommandHandler } from "../core/command/command-handler.js";
import type { SdkAdapter } from "../core/sdk/sdk-adapter.js";
import type { Scheduler } from "../core/scheduler/scheduler.js";
import type { PushService } from "../services/push/push-service.js";
import type { ExecService } from "../services/exec/exec-service.js";
import type { SandboxSessionRegistry } from "../services/exec/sandbox-session-registry.js";
import type { PreviewRegistry } from "../services/exec/preview-registry.js";
import type { SandboxService } from "../services/exec/sandbox-service.js";
import { sandboxPolicyFallback } from "../services/exec/sandbox-service.js";
import type { SessionManager } from "../core/session/session-manager.js";
import type { TerminalConnectionRegistry } from "../services/exec/terminal-connection-registry.js";
import { isDockerAvailable } from "../services/exec/docker-sandbox-manager.js";
import type { IntranetPullPollerHandle } from "../adapters/intranet/intranet-pull-poller.js";
import type { TelegramPullPollerHandle } from "../adapters/telegram/telegram-pull-poller.js";
import { sendError, errorBody } from "./errors.js";
import { unauthorized, type AuthContext, type AuthService } from "../auth/auth.js";
import type { RateLimiter } from "../auth/rate-limit.js";
import type { ServerConfig } from "../config.js";
import { registerAuthRoutes } from "./auth-routes.js";
import {
  assertProjectAccess,
  assertReplayAccess,
  assertSessionAccess,
} from "../auth/access.js";
import { issueWsToken } from "../auth/ws-token.js";
import { prisma } from "../db/client.js";
import { resolveCommandSource } from "./channel-source.js";

function requestIdFrom(req: FastifyRequest): string {
  const header = req.headers["x-request-id"];
  if (typeof header === "string" && header.length > 0) return header;
  return crypto.randomUUID();
}

function commandFrom(
  req: FastifyRequest,
  kind: string,
  extra: Record<string, unknown>,
) {
  return {
    kind,
    source: resolveCommandSource(req),
    requestId: requestIdFrom(req),
    ...extra,
  };
}

async function runCommand(
  handler: CommandHandler,
  auth: AuthContext,
  body: unknown,
  reply: FastifyReply,
) {
  const result = await handler.handleWithLock(body, auth);
  if (!result.ok) {
    return sendError(reply, result.error);
  }
  return reply.status(result.httpStatus ?? 200).send(result.data);
}

export async function registerApiRoutes(
  app: FastifyInstance,
  commandHandler: CommandHandler,
  auth: AuthService,
  config: ServerConfig,
  sdk: SdkAdapter,
  rateLimiters?: { api: RateLimiter; auth: RateLimiter },
  scheduler?: Scheduler,
  pushService?: PushService,
  execService?: ExecService,
  sandboxSessions?: SandboxSessionRegistry,
  previewRegistry?: PreviewRegistry,
  sandboxService?: SandboxService,
  sessionManager?: SessionManager,
  terminalConnections?: TerminalConnectionRegistry,
  telegramPullPoller?: TelegramPullPollerHandle | null,
  intranetPullPoller?: IntranetPullPollerHandle | null,
): Promise<void> {
  app.addHook("preHandler", async (request, reply) => {
    const url = request.url.split("?")[0] ?? request.url;
    if (url.startsWith("/health")) return;
    if (url.startsWith("/api/v1/webhooks")) return;
    if (url.startsWith("/api/v1/stream") || url.startsWith("/api/v1/ws/events")) {
      return;
    }
    if (url.match(/^\/api\/v1\/projects\/[^/]+\/terminal$/)) {
      return;
    }
    if (url.startsWith("/api/v1/preview/")) {
      return;
    }

    const clientKey = request.ip ?? "unknown";

    if (url.startsWith("/api/v1/auth/token") || url.startsWith("/api/v1/auth/refresh")) {
      if (rateLimiters) {
        const rl = rateLimiters.auth.check(`auth:${clientKey}`);
        if (!rl.allowed) {
          return sendError(reply, {
            code: "rate_limit_exceeded",
            message: "Too many auth attempts",
            retryable: true,
          });
        }
      }
      return;
    }

    const ctx = await auth.authenticate(request);
    if (!ctx) {
      return reply.status(401).send(errorBody(unauthorized()));
    }
    request.auth = ctx;

    if (rateLimiters) {
      const rl = rateLimiters.api.check(`user:${ctx.userId}`);
      if (!rl.allowed) {
        return sendError(reply, {
          code: "rate_limit_exceeded",
          message: "Rate limit exceeded",
          retryable: true,
        });
      }
    }
  });

  await registerAuthRoutes(app, auth, config);

  const sandboxPolicy = sandboxService?.getPolicy();

  app.get("/health", async (_request, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return reply.send({
        status: "ok",
        db: "connected",
        push: {
          webPush: pushService?.isEnabled() ?? false,
          expo: pushService?.isExpoEnabled() ?? false,
        },
        scheduler: scheduler?.getMetrics() ?? null,
        exec: {
          sandboxMode: config.sandboxMode,
          maxConcurrent: config.maxConcurrentExec,
          perProjectMax: config.perProjectMaxExec,
          memoryMb: config.sandboxMemoryMb,
          cpus: config.sandboxCpus,
          previewPortRange: [config.previewPortMin, config.previewPortMax],
        },
        sandbox: {
          ...(sandboxPolicy ?? sandboxPolicyFallback(config)),
          dockerAvailable: isDockerAvailable(),
          reusableContainers:
            config.sandboxMode === "docker" && isDockerAvailable(),
          activeSessions: sandboxSessions?.size() ?? 0,
          activeExec: execService?.getActiveCount() ?? 0,
        },
        channels: {
          telegram: {
            configured: Boolean(config.telegramBotToken),
            inboundMode: config.telegramPullMode ? "pull" : "push",
            pull: telegramPullPoller?.getMetrics() ?? null,
          },
          intranet: {
            configured: Boolean(config.intranetMessengerPollUrl),
            inboundMode: config.intranetMessengerPollUrl ? "pull" : null,
            pull: intranetPullPoller?.getMetrics() ?? null,
          },
          mcp: {
            enabled: config.mcpEnabled,
            endpoint: config.mcpEnabled ? "/api/v1/mcp" : null,
          },
        },
      });
    } catch {
      return reply.status(503).send({
        status: "degraded",
        db: "unavailable",
        push: {
          webPush: pushService?.isEnabled() ?? false,
          expo: pushService?.isExpoEnabled() ?? false,
        },
        scheduler: scheduler?.getMetrics() ?? null,
        exec: {
          sandboxMode: config.sandboxMode,
          maxConcurrent: config.maxConcurrentExec,
          perProjectMax: config.perProjectMaxExec,
          memoryMb: config.sandboxMemoryMb,
          cpus: config.sandboxCpus,
          previewPortRange: [config.previewPortMin, config.previewPortMax],
        },
        sandbox: {
          ...(sandboxPolicy ?? sandboxPolicyFallback(config)),
          dockerAvailable: isDockerAvailable(),
          reusableContainers:
            config.sandboxMode === "docker" && isDockerAvailable(),
          activeSessions: sandboxSessions?.size() ?? 0,
          activeExec: execService?.getActiveCount() ?? 0,
        },
        channels: {
          telegram: {
            configured: Boolean(config.telegramBotToken),
            inboundMode: config.telegramPullMode ? "pull" : "push",
            pull: telegramPullPoller?.getMetrics() ?? null,
          },
          intranet: {
            configured: Boolean(config.intranetMessengerPollUrl),
            inboundMode: config.intranetMessengerPollUrl ? "pull" : null,
            pull: intranetPullPoller?.getMetrics() ?? null,
          },
          mcp: {
            enabled: config.mcpEnabled,
            endpoint: config.mcpEnabled ? "/api/v1/mcp" : null,
          },
        },
      });
    }
  });

  app.post("/api/v1/commands", async (request, reply) =>
    runCommand(commandHandler, request.auth!, request.body, reply),
  );

  app.post("/api/v1/projects", async (request, reply) => {
    const body = request.body as { name?: string; gitUrl?: string };
    return runCommand(
      commandHandler,
      request.auth!,
      commandFrom(request, "create_project", {
        name: body.name ?? "",
        gitUrl: body.gitUrl,
      }),
      reply,
    );
  });

  app.get<{ Querystring: { status?: string } }>(
    "/api/v1/projects",
    async (request, reply) => {
    if (!auth.requireScope(request.auth!, ScopeEnum.PROJECT_READ)) {
      return sendError(reply, {
        code: "forbidden",
        message: "Insufficient scope",
        retryable: false,
      });
    }
    const statusFilter = request.query.status ?? "active";
    const projects = await prisma.project.findMany({
      where: {
        userId: request.auth!.userId,
        ...(statusFilter === "all" ? {} : { status: statusFilter }),
      },
      orderBy: [{ pinned: "desc" }, { lastActiveAt: "desc" }],
    });
    return reply.send({ projects });
  });

  app.get<{ Params: { id: string } }>(
    "/api/v1/projects/:id",
    async (request, reply) => {
      if (!auth.requireScope(request.auth!, ScopeEnum.PROJECT_READ)) {
        return sendError(reply, {
          code: "forbidden",
          message: "Insufficient scope",
          retryable: false,
        });
      }
      const access = await assertProjectAccess(
        request.auth!.userId,
        request.params.id,
      );
      if (!access.ok) return sendError(reply, access.error);

      const project = await prisma.project.findUnique({
        where: { id: request.params.id },
        include: { sessions: true },
      });
      return reply.send(project);
    },
  );

  app.patch<{ Params: { id: string } }>(
    "/api/v1/projects/:id",
    async (request, reply) => {
      if (!auth.requireScope(request.auth!, ScopeEnum.PROJECT_WRITE)) {
        return sendError(reply, {
          code: "forbidden",
          message: "Insufficient scope",
          retryable: false,
        });
      }
      const access = await assertProjectAccess(
        request.auth!.userId,
        request.params.id,
      );
      if (!access.ok) return sendError(reply, access.error);

      const body = request.body as {
        name?: string;
        pinned?: boolean;
        status?: string;
      };
      const project = await prisma.project.update({
        where: { id: request.params.id },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.pinned !== undefined ? { pinned: body.pinned } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
        },
      });
      if (body.status === "archived") {
        previewRegistry?.revokeForProject(project.id);
        terminalConnections?.closeProject(project.id);
        sandboxSessions?.purgeProject(project.id, (projectId) => {
          execService?.cancelProjectExecs(projectId);
        });
        await sessionManager?.disposeProjectAgents(project.id);
      }
      return reply.send(project);
    },
  );

  app.get("/api/v1/models", async (request, reply) => {
    if (!auth.requireScope(request.auth!, ScopeEnum.PROJECT_READ)) {
      return sendError(reply, {
        code: "forbidden",
        message: "Insufficient scope",
        retryable: false,
      });
    }
    const models = await sdk.listModels(
      request.headers.authorization?.replace("Bearer ", "") === devApiKey
        ? process.env.CURSOR_API_KEY ?? ""
        : "",
    );
    return reply.send({ models });
  });

  app.post<{ Params: { id: string } }>(
    "/api/v1/projects/:id/sessions",
    async (request, reply) => {
      const body = request.body as { model?: string; title?: string };
      return runCommand(
        commandHandler,
        request.auth!,
        commandFrom(request, "create_session", {
          projectId: request.params.id,
          model: body.model,
          title: body.title,
        }),
        reply,
      );
    },
  );

  app.get<{ Params: { sid: string } }>(
    "/api/v1/sessions/:sid",
    async (request, reply) => {
      if (!auth.requireScope(request.auth!, ScopeEnum.PROJECT_READ)) {
        return sendError(reply, {
          code: "forbidden",
          message: "Insufficient scope",
          retryable: false,
        });
      }
      const access = await assertSessionAccess(
        request.auth!.userId,
        request.params.sid,
      );
      if (!access.ok) return sendError(reply, access.error);

      const session = await prisma.session.findUnique({
        where: { id: request.params.sid },
        include: { project: true },
      });
      return reply.send(session);
    },
  );

  app.get<{ Params: { sid: string }; Querystring: { limit?: string; before?: string } }>(
    "/api/v1/sessions/:sid/messages",
    async (request, reply) => {
      if (!auth.requireScope(request.auth!, ScopeEnum.PROJECT_READ)) {
        return sendError(reply, {
          code: "forbidden",
          message: "Insufficient scope",
          retryable: false,
        });
      }
      const access = await assertSessionAccess(
        request.auth!.userId,
        request.params.sid,
      );
      if (!access.ok) return sendError(reply, access.error);

      const limitRaw = Number(request.query.limit ?? 100);
      const limit = Math.min(
        500,
        Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 100),
      );
      const beforeId = request.query.before?.trim();

      let beforeCreatedAt: Date | undefined;
      if (beforeId) {
        if (beforeId.startsWith("u-")) {
          return sendError(reply, {
            code: "validation_failed",
            message: "Invalid message cursor (optimistic id)",
            retryable: false,
          });
        }
        const cursorMsg = await prisma.message.findFirst({
          where: { id: beforeId, sessionId: request.params.sid },
          select: { createdAt: true },
        });
        if (!cursorMsg) {
          return sendError(reply, {
            code: "not_found",
            message: "Message cursor not found",
            retryable: false,
          });
        }
        beforeCreatedAt = cursorMsg.createdAt;
      }

      const rows = await prisma.message.findMany({
        where: {
          sessionId: request.params.sid,
          ...(beforeCreatedAt ? { createdAt: { lt: beforeCreatedAt } } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: limit + 1,
      });
      const hasMore = rows.length > limit;
      const page = (hasMore ? rows.slice(0, limit) : rows).reverse();

      return reply.send({ messages: page, hasMore });
    },
  );

  app.post<{ Params: { sid: string } }>(
    "/api/v1/sessions/:sid/messages",
    async (request, reply) => {
      const body = request.body as {
        text?: string;
        attachments?: Array<{ kind: string; ref: string; mime?: string }>;
      };
      return runCommand(
        commandHandler,
        request.auth!,
        commandFrom(request, "send_prompt", {
          sessionId: request.params.sid,
          text: body.text ?? "",
          attachments: body.attachments,
        }),
        reply,
      );
    },
  );

  app.post<{ Params: { rid: string } }>(
    "/api/v1/runs/:rid/cancel",
    async (request, reply) =>
      runCommand(
        commandHandler,
        request.auth!,
        commandFrom(request, "cancel", { runId: request.params.rid }),
        reply,
      ),
  );

  app.post<{ Params: { rid: string } }>(
    "/api/v1/runs/:rid/steer",
    async (request, reply) => {
      const body = request.body as { text?: string };
      return runCommand(
        commandHandler,
        request.auth!,
        commandFrom(request, "steer", {
          runId: request.params.rid,
          text: body.text ?? "",
        }),
        reply,
      );
    },
  );

  app.post("/api/v1/approvals/resolve", async (request, reply) => {
    const body = request.body as { approvalId?: string; decision?: string };
    return runCommand(
      commandHandler,
      request.auth!,
      commandFrom(request, "approve", {
        approvalId: body.approvalId ?? "",
        decision: body.decision ?? "approve",
      }),
      reply,
    );
  });

  app.post("/api/v1/ws-token", async (request, reply) => {
    const issued = issueWsToken(request.auth!);
    return reply.send(issued);
  });

  app.get<{
    Querystring: { scope?: string; id?: string };
  }>("/api/v1/status", async (request, reply) => {
    const scope = (request.query.scope ?? "all") as "all" | "project" | "session";
    return runCommand(
      commandHandler,
      request.auth!,
      commandFrom(request, "status", {
        scope,
        id: request.query.id,
      }),
      reply,
    );
  });

  app.get<{
    Querystring: {
      scope: "session" | "project" | "global";
      scopeId?: string;
      cursor?: string;
    };
  }>("/api/v1/events/replay", async (request, reply) => {
    if (!auth.requireScope(request.auth!, ScopeEnum.PROJECT_READ)) {
      return sendError(reply, {
        code: "forbidden",
        message: "Insufficient scope",
        retryable: false,
      });
    }
    const { scope, scopeId, cursor } = request.query;
    const access = await assertReplayAccess(
      request.auth!.userId,
      scope,
      scopeId,
    );
    if (!access.ok) return sendError(reply, access.error);

    try {
      const events = await commandHandler.replayEvents(
        request.auth!.userId,
        scope,
        scopeId,
        Number(cursor ?? 0),
      );
      return reply.send({ events });
    } catch (err) {
      const error = err as { code?: string; message?: string; retryable?: boolean };
      return sendError(reply, {
        code: error.code ?? "internal_error",
        message: error.message ?? "Replay failed",
        retryable: error.retryable ?? false,
      });
    }
  });
}
