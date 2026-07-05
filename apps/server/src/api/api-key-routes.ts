import type { FastifyInstance } from "fastify";
import { Scope as ScopeEnum } from "@app/shared";
import { randomBytes } from "node:crypto";
import { createHash } from "node:crypto";
import { prisma } from "../db/client.js";
import type { AuthService } from "../auth/auth.js";
import { sendError } from "./errors.js";

function hashKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export async function registerApiKeyRoutes(
  app: FastifyInstance,
  auth: AuthService,
): Promise<void> {
  app.get("/api/v1/api-keys", async (request, reply) => {
    if (!auth.requireScope(request.auth!, ScopeEnum.PROJECT_WRITE)) {
      return sendError(reply, {
        code: "forbidden",
        message: "Insufficient scope",
        retryable: false,
      });
    }
    const keys = await prisma.apiKey.findMany({
      where: { userId: request.auth!.userId },
      select: {
        id: true,
        scopes: true,
        expiresAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });
    return reply.send({ keys });
  });

  app.post("/api/v1/api-keys", async (request, reply) => {
    if (!auth.requireScope(request.auth!, ScopeEnum.PROJECT_WRITE)) {
      return sendError(reply, {
        code: "forbidden",
        message: "Insufficient scope",
        retryable: false,
      });
    }
    const body = request.body as {
      scopes?: string[];
      expiresInDays?: number;
    };
    const scopes =
      body.scopes?.length ?
        body.scopes.join(",")
      : [
          ScopeEnum.PROJECT_READ,
          ScopeEnum.PROJECT_WRITE,
          ScopeEnum.PROMPT_SEND,
          ScopeEnum.RUN_CANCEL,
          ScopeEnum.APPROVAL_RESOLVE,
          ScopeEnum.GIT_WRITE,
          ScopeEnum.TERMINAL_EXEC,
        ].join(",");

    const plainKey = `ak_${randomBytes(24).toString("hex")}`;
    const expiresAt =
      body.expiresInDays && body.expiresInDays > 0
        ? new Date(Date.now() + body.expiresInDays * 86_400_000)
        : null;

    const row = await prisma.apiKey.create({
      data: {
        userId: request.auth!.userId,
        hashedKey: hashKey(plainKey),
        scopes,
        expiresAt,
      },
    });

    return reply.status(201).send({
      id: row.id,
      apiKey: plainKey,
      scopes: scopes.split(","),
      expiresAt: row.expiresAt?.toISOString() ?? null,
    });
  });

  app.delete<{ Params: { id: string } }>(
    "/api/v1/api-keys/:id",
    async (request, reply) => {
      if (!auth.requireScope(request.auth!, ScopeEnum.PROJECT_WRITE)) {
        return sendError(reply, {
          code: "forbidden",
          message: "Insufficient scope",
          retryable: false,
        });
      }
      const existing = await prisma.apiKey.findUnique({
        where: { id: request.params.id },
      });
      if (!existing || existing.userId !== request.auth!.userId) {
        return sendError(reply, {
          code: "not_found",
          message: "API key not found",
          retryable: false,
        });
      }
      await prisma.apiKey.delete({ where: { id: request.params.id } });
      return reply.send({ deleted: true });
    },
  );
}
