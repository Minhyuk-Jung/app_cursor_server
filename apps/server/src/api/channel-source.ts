import type { FastifyRequest } from "fastify";

const ALLOWED = new Set([
  "web",
  "mobile",
  "slack",
  "teams",
  "telegram",
  "custom",
  "system",
]);

export function resolveCommandSource(req: FastifyRequest): string {
  const header = req.headers["x-channel-source"];
  const raw = typeof header === "string" ? header.trim() : "";
  return ALLOWED.has(raw) ? raw : "web";
}
