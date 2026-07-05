import type { FastifyInstance } from "fastify";
import { Scope as ScopeEnum } from "@app/shared";
import { prisma } from "../db/client.js";
import { sendError } from "./errors.js";
import type { createAuthService } from "../auth/auth.js";

type AuthService = ReturnType<typeof createAuthService>;

export async function registerInboxRoutes(
  app: FastifyInstance,
  auth: AuthService,
): Promise<void> {
  app.get<{
    Querystring: { unreadOnly?: string };
  }>("/api/v1/inbox", async (request, reply) => {
    if (!auth.requireScope(request.auth!, ScopeEnum.PROJECT_READ)) {
      return sendError(reply, {
        code: "forbidden",
        message: "Insufficient scope",
        retryable: false,
      });
    }

    const unreadOnly = request.query.unreadOnly === "true";
    const items = await prisma.notification.findMany({
      where: {
        userId: request.auth!.userId,
        ...(unreadOnly ? { read: false } : {}),
      },
      orderBy: [{ read: "asc" }, { priority: "desc" }, { createdAt: "desc" }],
      take: 100,
    });

    return reply.send({
      items: items.map((row) => ({
        id: row.id,
        kind: row.kind,
        title: row.title,
        summary: row.summary,
        deeplink: row.deeplink,
        priority: row.priority,
        read: row.read,
        groupCount: row.groupCount,
        projectId: row.projectId,
        sessionId: row.sessionId,
        runId: row.runId,
        createdAt: row.createdAt.toISOString(),
      })),
    });
  });

  app.patch<{ Params: { id: string } }>(
    "/api/v1/inbox/:id",
    async (request, reply) => {
      if (!auth.requireScope(request.auth!, ScopeEnum.PROJECT_READ)) {
        return sendError(reply, {
          code: "forbidden",
          message: "Insufficient scope",
          retryable: false,
        });
      }

      const body = request.body as { read?: boolean };
      const existing = await prisma.notification.findFirst({
        where: { id: request.params.id, userId: request.auth!.userId },
      });
      if (!existing) {
        return sendError(reply, {
          code: "not_found",
          message: "Notification not found",
          retryable: false,
        });
      }

      const updated = await prisma.notification.update({
        where: { id: existing.id },
        data: { read: body.read ?? true },
      });

      return reply.send({
        id: updated.id,
        read: updated.read,
      });
    },
  );
}
