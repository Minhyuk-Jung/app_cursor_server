import type { FastifyInstance } from "fastify";
import { Scope as ScopeEnum } from "@app/shared";
import { sendError } from "./errors.js";
import type { createAuthService } from "../auth/auth.js";
import type { ServerConfig } from "../config.js";
import { getUsageSummary } from "../services/usage/usage-service.js";

type AuthService = ReturnType<typeof createAuthService>;

export async function registerUsageRoutes(
  app: FastifyInstance,
  auth: AuthService,
  config: ServerConfig,
): Promise<void> {
  app.get<{
    Querystring: { range?: string; projectId?: string };
  }>("/api/v1/usage", async (request, reply) => {
    if (!auth.requireScope(request.auth!, ScopeEnum.PROJECT_READ)) {
      return sendError(reply, {
        code: "forbidden",
        message: "Insufficient scope",
        retryable: false,
      });
    }

    const range = request.query.range === "month" ? "month" : "day";
    const summary = await getUsageSummary(
      request.auth!.userId,
      range,
      request.query.projectId,
      range === "day"
        ? {
            limit: config.usageDailyLimit,
            warningRatio: config.usageWarningRatio,
          }
        : undefined,
    );
    return reply.send(summary);
  });
}
