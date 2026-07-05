import type { FastifyInstance } from "fastify";
import { Scope as ScopeEnum } from "@app/shared";
import { prisma } from "../db/client.js";
import { sendError } from "./errors.js";
import type { createAuthService } from "../auth/auth.js";

type AuthService = ReturnType<typeof createAuthService>;

export async function registerSubscriptionRoutes(
  app: FastifyInstance,
  auth: AuthService,
): Promise<void> {
  app.post("/api/v1/subscriptions", async (request, reply) => {
    if (!auth.requireScope(request.auth!, ScopeEnum.PROJECT_WRITE)) {
      return sendError(reply, {
        code: "forbidden",
        message: "Insufficient scope",
        retryable: false,
      });
    }

    const body = request.body as {
      channel?: string;
      targetUrl?: string;
      secret?: string;
    };
    if (!body.channel || !body.targetUrl) {
      return sendError(reply, {
        code: "validation_failed",
        message: "channel and targetUrl are required",
        retryable: false,
      });
    }

    const sub = await prisma.webhookSubscription.create({
      data: {
        userId: request.auth!.userId,
        channel: body.channel,
        targetUrl: body.targetUrl,
        secret: body.secret,
      },
    });

    return reply.status(201).send({
      id: sub.id,
      channel: sub.channel,
      targetUrl: sub.targetUrl,
      active: sub.active,
    });
  });

  app.get("/api/v1/subscriptions", async (request, reply) => {
    if (!auth.requireScope(request.auth!, ScopeEnum.PROJECT_READ)) {
      return sendError(reply, {
        code: "forbidden",
        message: "Insufficient scope",
        retryable: false,
      });
    }

    const subs = await prisma.webhookSubscription.findMany({
      where: { userId: request.auth!.userId, active: true },
      select: {
        id: true,
        channel: true,
        targetUrl: true,
        active: true,
        createdAt: true,
      },
    });
    return reply.send({ subscriptions: subs });
  });

  app.delete<{ Params: { id: string } }>(
    "/api/v1/subscriptions/:id",
    async (request, reply) => {
      if (!auth.requireScope(request.auth!, ScopeEnum.PROJECT_WRITE)) {
        return sendError(reply, {
          code: "forbidden",
          message: "Insufficient scope",
          retryable: false,
        });
      }

      const existing = await prisma.webhookSubscription.findFirst({
        where: { id: request.params.id, userId: request.auth!.userId },
      });
      if (!existing) {
        return sendError(reply, {
          code: "not_found",
          message: "Subscription not found",
          retryable: false,
        });
      }

      await prisma.webhookSubscription.update({
        where: { id: existing.id },
        data: { active: false },
      });
      return reply.send({ id: existing.id, active: false });
    },
  );
}
