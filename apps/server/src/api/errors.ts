import type { AppError } from "@app/shared";
import type { FastifyReply } from "fastify";

export function errorBody(error: AppError): { error: AppError } {
  return { error };
}

export function httpStatusForError(code: string): number {
  switch (code) {
    case "validation_failed":
      return 400;
    case "unauthorized":
      return 401;
    case "forbidden":
      return 403;
    case "not_found":
      return 404;
    case "conflict":
      return 409;
    case "quota_exceeded":
      return 429;
    case "queue_full":
      return 429;
    case "usage_limit_exceeded":
      return 429;
    case "rate_limit_exceeded":
      return 429;
    case "docker_unavailable":
    case "sandbox_not_ready":
    case "sandbox_create_failed":
      return 503;
    case "token_expired":
      return 401;
    default:
      return 500;
  }
}

export function sendError(reply: FastifyReply, error: AppError): FastifyReply {
  return reply.status(httpStatusForError(error.code)).send(errorBody(error));
}
