import type { FastifyInstance } from "fastify";
import { Scope as ScopeEnum } from "@app/shared";
import { sendError } from "./errors.js";
import type { createAuthService } from "../auth/auth.js";
import type { PushService } from "../services/push/push-service.js";
import { isValidExpoPushToken } from "../services/push/expo-push.js";

type AuthService = ReturnType<typeof createAuthService>;

export async function registerPushRoutes(
  app: FastifyInstance,
  auth: AuthService,
  pushService: PushService,
): Promise<void> {
  app.get("/api/v1/push/vapid-public-key", async (request, reply) => {
    if (!auth.requireScope(request.auth!, ScopeEnum.PROJECT_READ)) {
      return sendError(reply, {
        code: "forbidden",
        message: "Insufficient scope",
        retryable: false,
      });
    }
    const publicKey = pushService.getPublicKey();
    if (!publicKey) {
      return sendError(reply, {
        code: "not_implemented",
        message: "Web Push is not configured (VAPID keys missing)",
        retryable: false,
      });
    }
    return reply.send({ publicKey });
  });

  app.post("/api/v1/push/subscribe", async (request, reply) => {
    if (!auth.requireScope(request.auth!, ScopeEnum.PROJECT_WRITE)) {
      return sendError(reply, {
        code: "forbidden",
        message: "Insufficient scope",
        retryable: false,
      });
    }
    const body = request.body as {
      endpoint?: string;
      keys?: { p256dh?: string; auth?: string };
    };
    if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
      return sendError(reply, {
        code: "validation_failed",
        message: "endpoint and keys are required",
        retryable: false,
      });
    }
    if (!pushService.isEnabled()) {
      return sendError(reply, {
        code: "not_implemented",
        message: "Web Push is not configured",
        retryable: false,
      });
    }
    await pushService.subscribe(request.auth!.userId, {
      endpoint: body.endpoint,
      keys: { p256dh: body.keys.p256dh, auth: body.keys.auth },
    });
    return reply.status(201).send({ subscribed: true });
  });

  app.post("/api/v1/push/unsubscribe", async (request, reply) => {
    if (!auth.requireScope(request.auth!, ScopeEnum.PROJECT_WRITE)) {
      return sendError(reply, {
        code: "forbidden",
        message: "Insufficient scope",
        retryable: false,
      });
    }
    const body = request.body as { endpoint?: string };
    if (!body.endpoint) {
      return sendError(reply, {
        code: "validation_failed",
        message: "endpoint is required",
        retryable: false,
      });
    }
    await pushService.unsubscribe(request.auth!.userId, body.endpoint);
    return reply.send({ unsubscribed: true });
  });

  app.post("/api/v1/push/expo-subscribe", async (request, reply) => {
    if (!auth.requireScope(request.auth!, ScopeEnum.PROJECT_WRITE)) {
      return sendError(reply, {
        code: "forbidden",
        message: "Insufficient scope",
        retryable: false,
      });
    }
    const body = request.body as { token?: string };
    if (!body.token || !isValidExpoPushToken(body.token)) {
      return sendError(reply, {
        code: "validation_failed",
        message: "Valid Expo push token is required",
        retryable: false,
      });
    }
    await pushService.subscribeExpo(request.auth!.userId, body.token);
    return reply.status(201).send({ subscribed: true });
  });

  app.post("/api/v1/push/expo-unsubscribe", async (request, reply) => {
    if (!auth.requireScope(request.auth!, ScopeEnum.PROJECT_WRITE)) {
      return sendError(reply, {
        code: "forbidden",
        message: "Insufficient scope",
        retryable: false,
      });
    }
    const body = request.body as { token?: string };
    if (!body.token) {
      return sendError(reply, {
        code: "validation_failed",
        message: "token is required",
        retryable: false,
      });
    }
    await pushService.unsubscribeExpo(request.auth!.userId, body.token);
    return reply.send({ unsubscribed: true });
  });
}
