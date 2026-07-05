import type { FastifyInstance } from "fastify";
import {
  createChannelLink,
  deleteChannelLink,
  listChannelLinks,
} from "../auth/channel-link.js";
import { sendError } from "./errors.js";
import type { createAuthService } from "../auth/auth.js";

type AuthService = ReturnType<typeof createAuthService>;

export async function registerChannelRoutes(
  app: FastifyInstance,
  _auth: AuthService,
): Promise<void> {
  app.get("/api/v1/channel-links", async (request, reply) => {
    const links = await listChannelLinks(request.auth!.userId);
    return reply.send({
      links: links.map((l) => ({
        id: l.id,
        channel: l.channel,
        externalUserId: l.externalUserId,
        createdAt: l.createdAt.toISOString(),
      })),
    });
  });

  app.post("/api/v1/channel-links", async (request, reply) => {
    const body = request.body as {
      channel?: string;
      externalUserId?: string;
    };
    if (!body.channel?.trim() || !body.externalUserId?.trim()) {
      return sendError(reply, {
        code: "validation_failed",
        message: "channel and externalUserId are required",
        retryable: false,
      });
    }

    const link = await createChannelLink({
      userId: request.auth!.userId,
      channel: body.channel.trim(),
      externalUserId: body.externalUserId.trim(),
    });

    return reply.status(201).send({
      id: link.id,
      channel: link.channel,
      externalUserId: link.externalUserId,
    });
  });

  app.delete<{ Params: { id: string } }>(
    "/api/v1/channel-links/:id",
    async (request, reply) => {
      const ok = await deleteChannelLink(request.auth!.userId, request.params.id);
      if (!ok) {
        return sendError(reply, {
          code: "not_found",
          message: "Channel link not found",
          retryable: false,
        });
      }
      return reply.send({ deleted: true });
    },
  );
}
