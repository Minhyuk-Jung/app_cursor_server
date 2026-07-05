import type { FastifyInstance } from "fastify";
import type { ServerConfig } from "../config.js";
import { sendError, errorBody } from "./errors.js";
import type { AuthService } from "../auth/auth.js";
import { unauthorized } from "../auth/auth.js";

export async function registerAuthRoutes(
  app: FastifyInstance,
  auth: AuthService,
  config: ServerConfig,
): Promise<void> {
  app.post("/api/v1/auth/token", async (request, reply) => {
    if (!config.jwtSecret) {
      return sendError(reply, {
        code: "not_found",
        message: "JWT auth is not configured",
        retryable: false,
      });
    }

    const body = request.body as { apiKey?: string; grantType?: string };
    const headerKey = request.headers.authorization?.replace("Bearer ", "");
    const apiKey = body.apiKey?.trim() || headerKey;

    if (!apiKey) {
      return reply.status(401).send(errorBody(unauthorized()));
    }

    const ctx = await auth.resolveApiKey(apiKey);
    if (!ctx) {
      return reply.status(401).send(errorBody(unauthorized()));
    }

    const issued = auth.issueJwt(ctx);
    if (!issued) {
      return sendError(reply, {
        code: "internal_error",
        message: "Failed to issue token",
        retryable: false,
      });
    }

    return reply.send({
      accessToken: issued.accessToken,
      tokenType: "Bearer",
      expiresAt: issued.expiresAt,
      refreshToken: issued.refreshToken,
      refreshExpiresAt: issued.refreshExpiresAt,
    });
  });

  app.post("/api/v1/auth/refresh", async (request, reply) => {
    if (!config.jwtSecret) {
      return sendError(reply, {
        code: "not_found",
        message: "JWT auth is not configured",
        retryable: false,
      });
    }

    const body = request.body as { refreshToken?: string };
    if (!body.refreshToken?.trim()) {
      return reply.status(401).send(errorBody(unauthorized()));
    }

    const issued = auth.refreshJwt(body.refreshToken.trim());
    if (!issued) {
      return reply.status(401).send(errorBody(tokenExpired()));
    }

    return reply.send({
      accessToken: issued.accessToken,
      tokenType: "Bearer",
      expiresAt: issued.expiresAt,
      refreshToken: issued.refreshToken,
      refreshExpiresAt: issued.refreshExpiresAt,
    });
  });
}

function tokenExpired() {
  return {
    code: "token_expired",
    message: "Refresh token invalid or expired",
    retryable: false,
  };
}
