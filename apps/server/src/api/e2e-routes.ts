import type { FastifyInstance } from "fastify";
import { Scope as ScopeEnum } from "@app/shared";
import { prisma } from "../db/client.js";
import { sendError } from "./errors.js";
import { buildRuleBasedSessionSummary } from "../core/session/session-summary.js";
import type { createAuthService } from "../auth/auth.js";

type AuthService = ReturnType<typeof createAuthService>;

const ALLOWED_KINDS = new Set([
  "exec_timeout",
  "exec_memory_limit",
  "review_ready",
  "git_status",
  "run_done",
  "error",
  "info",
]);

/** E2E 전용 — 인박스 deeplink UI 검증 (21-test-strategy, E2E_INBOX_SEED=true) */
export async function registerE2eRoutes(
  app: FastifyInstance,
  auth: AuthService,
): Promise<void> {
  app.post("/api/v1/e2e/inbox/seed", async (request, reply) => {
    if (!auth.requireScope(request.auth!, ScopeEnum.PROJECT_READ)) {
      return sendError(reply, {
        code: "forbidden",
        message: "Insufficient scope",
        retryable: false,
      });
    }

    const body = request.body as {
      kind?: string;
      projectId?: string;
      sessionId?: string;
      deeplink?: string;
      title?: string;
      summary?: string;
    };

    if (!body.kind || !ALLOWED_KINDS.has(body.kind)) {
      return sendError(reply, {
        code: "validation_failed",
        message: "Invalid notification kind",
        retryable: false,
      });
    }
    if (!body.projectId || !body.deeplink) {
      return sendError(reply, {
        code: "validation_failed",
        message: "projectId and deeplink required",
        retryable: false,
      });
    }

    const project = await prisma.project.findFirst({
      where: { id: body.projectId, userId: request.auth!.userId },
    });
    if (!project) {
      return sendError(reply, {
        code: "not_found",
        message: "Project not found",
        retryable: false,
      });
    }

    const row = await prisma.notification.create({
      data: {
        userId: request.auth!.userId,
        projectId: body.projectId,
        sessionId: body.sessionId ?? null,
        kind: body.kind,
        priority: 50,
        title: body.title ?? body.kind,
        summary: body.summary ?? `E2E seed ${body.kind}`,
        deeplink: body.deeplink,
        read: false,
      },
    });

    return reply.send({
      id: row.id,
      kind: row.kind,
      deeplink: row.deeplink,
      projectId: row.projectId,
    });
  });

  /** E2E 전용 — SDK 없이 세션 행만 생성 (S26 speech UI 등, CURSOR_API_KEY 불필요) */
  app.post("/api/v1/e2e/session/seed", async (request, reply) => {
    if (!auth.requireScope(request.auth!, ScopeEnum.PROJECT_WRITE)) {
      return sendError(reply, {
        code: "forbidden",
        message: "Insufficient scope",
        retryable: false,
      });
    }

    const body = request.body as {
      projectId?: string;
      title?: string;
      model?: string;
      messages?: Array<{ role: string; content: string }>;
      messageCount?: number;
      refreshSummary?: boolean;
    };

    if (!body.projectId) {
      return sendError(reply, {
        code: "validation_failed",
        message: "projectId required",
        retryable: false,
      });
    }

    const project = await prisma.project.findFirst({
      where: { id: body.projectId, userId: request.auth!.userId },
    });
    if (!project) {
      return sendError(reply, {
        code: "not_found",
        message: "Project not found",
        retryable: false,
      });
    }

    const session = await prisma.session.create({
      data: {
        projectId: body.projectId,
        model: body.model ?? "composer-2.5",
        title: body.title ?? "e2e-session",
        status: "idle",
        source: "e2e",
        agentId: "e2e-stub-agent",
      },
    });

    if (body.messages?.length) {
      await prisma.message.createMany({
        data: body.messages.map((m) => ({
          sessionId: session.id,
          role: m.role,
          content: m.content,
        })),
      });
    } else if (body.messageCount && body.messageCount > 0) {
      const count = Math.min(body.messageCount, 200);
      const base = Date.now();
      for (let i = 0; i < count; i++) {
        await prisma.message.create({
          data: {
            sessionId: session.id,
            role: i % 2 === 0 ? "user" : "assistant",
            content: `msg-${i}`,
            createdAt: new Date(base + i * 10),
          },
        });
      }
    }

    if (
      body.refreshSummary ||
      body.messages?.length ||
      (body.messageCount && body.messageCount > 0)
    ) {
      const messages = await prisma.message.findMany({
        where: { sessionId: session.id },
        orderBy: { createdAt: "desc" },
        take: 8,
      });
      const summary = buildRuleBasedSessionSummary(messages);
      await prisma.session.update({
        where: { id: session.id },
        data: { summary },
      });
    }

    const updated = await prisma.session.findUnique({
      where: { id: session.id },
    });

    return reply.send({
      sessionId: session.id,
      projectId: session.projectId,
      title: session.title,
      model: session.model,
      summary: updated?.summary ?? null,
    });
  });
}
