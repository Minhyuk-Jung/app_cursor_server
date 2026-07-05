import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Scope as ScopeEnum, TERMINAL_WS_CLOSE } from "@app/shared";
import { request as httpRequest } from "node:http";
import type { AuthService } from "../auth/auth.js";
import { assertProjectAccess } from "../auth/access.js";
import { redeemWsToken } from "../auth/ws-token.js";
import { prisma } from "../db/client.js";
import { sendError } from "./errors.js";
import type { ExecService } from "../services/exec/exec-service.js";
import { PreviewRegistry } from "../services/exec/preview-registry.js";
import { registerPreviewWebSocketProxy } from "../services/exec/preview-ws-proxy.js";
import { isPreviewPortAllowed } from "../services/exec/types.js";
import type { ExecRunHandle } from "../services/exec/types.js";
import type { SandboxSessionRegistry } from "../services/exec/sandbox-session-registry.js";
import type { TerminalConnectionRegistry } from "../services/exec/terminal-connection-registry.js";
import { isSandboxError } from "../services/exec/sandbox-errors.js";

/** 13 §8.1 — 사용자 터미널 exec 출력은 RunEventLog를 경유하지 않는다 */

export async function registerExecRoutes(
  app: FastifyInstance,
  auth: AuthService,
  execService: ExecService,
  previewRegistry: PreviewRegistry,
  sandboxSessions: SandboxSessionRegistry | undefined,
  previewTokenTtlSec: number,
  previewPortMin: number,
  previewPortMax: number,
  terminalConnections?: TerminalConnectionRegistry,
): Promise<void> {
  registerPreviewWebSocketProxy(app.server, previewRegistry);

  app.post<{ Params: { id: string } }>(
    "/api/v1/projects/:id/preview",
    async (request, reply) => {
      if (!auth.requireScope(request.auth!, ScopeEnum.TERMINAL_EXEC)) {
        return sendError(reply, {
          code: "forbidden",
          message: "Insufficient scope",
          retryable: false,
        });
      }
      const access = await assertProjectAccess(
        request.auth!.userId,
        request.params.id,
      );
      if (!access.ok) return sendError(reply, access.error);

      const body = (request.body ?? {}) as { port?: number };
      const port = body.port;
      if (
        !port ||
        !isPreviewPortAllowed(port, previewPortMin, previewPortMax)
      ) {
        return sendError(reply, {
          code: "validation_failed",
          message: `port must be between ${previewPortMin} and ${previewPortMax}`,
          retryable: false,
        });
      }

      const project = await prisma.project.findUnique({
        where: { id: request.params.id },
      });
      if (!project) {
        return sendError(reply, {
          code: "not_found",
          message: "Project not found",
          retryable: false,
        });
      }

      let previewHost = "127.0.0.1";
      try {
        if (sandboxSessions && execService.getSandboxMode() === "docker") {
          sandboxSessions.prepare(project.id, project.rootPath, false);
          previewHost = sandboxSessions.resolvePreviewHost(project.id);
        } else if (sandboxSessions) {
          previewHost = sandboxSessions.resolvePreviewHost(project.id);
        }
      } catch (err) {
        const code = isSandboxError(err)
          ? err.code
          : "internal_error";
        return sendError(reply, {
          code,
          message: err instanceof Error ? err.message : "Preview sandbox failed",
          retryable: isSandboxError(err) ? err.retryable : true,
        });
      }

      const entry = previewRegistry.issue({
        projectId: request.params.id,
        userId: request.auth!.userId,
        port,
        host: previewHost,
        ttlMs: previewTokenTtlSec * 1000,
      });

      return reply.send({
        token: entry.token,
        previewPath: `/api/v1/preview/${entry.token}/`,
        expiresAt: new Date(entry.expiresAt).toISOString(),
        port: entry.port,
      });
    },
  );

  app.all<{ Params: { token: string; "*": string } }>(
    "/api/v1/preview/:token/*",
    async (request, reply) => {
      const entry = previewRegistry.get(request.params.token);
      if (!entry) {
        return sendError(reply, {
          code: "forbidden",
          message: "Preview token invalid or expired",
          retryable: false,
        });
      }

      const suffix = request.params["*"] ?? "";
      const queryStart = request.url.indexOf("?");
      const targetPath = `/${suffix}${queryStart >= 0 ? request.url.slice(queryStart) : ""}`;

      try {
        await streamPreviewProxy(request, reply, {
          host: entry.host,
          port: entry.port,
          method: request.method,
          path: targetPath,
          headers: request.headers as Record<string, string | string[] | undefined>,
        });
      } catch (err) {
        if (!reply.sent && !reply.raw.headersSent) {
          return sendError(reply, {
            code: "internal_error",
            message: err instanceof Error ? err.message : "Preview proxy failed",
            retryable: true,
          });
        }
      }
    },
  );

  /** 13 §8.1 — 사용자 터미널 WebSocket: exec 출력은 RunEventLog를 경유하지 않는다 */
  app.get<{
    Params: { id: string };
    Querystring: { token?: string };
  }>(
    "/api/v1/projects/:id/terminal",
    { websocket: true },
    (socket, request) => {
      const projectId = request.params.id;
      terminalConnections?.attach(projectId, socket);

      let handle: ExecRunHandle | null = null;
      let projectRoot: string | null = null;
      const pendingMessages: string[] = [];

      const handleMessage = (raw: unknown) => {
        void (async () => {
          if (!projectRoot) return;
          try {
            const msg = JSON.parse(String(raw)) as {
              type?: string;
              command?: string;
              cwd?: string;
              data?: string;
            };

            if (msg.type === "ping") {
              socket.send(JSON.stringify({ type: "pong" }));
              return;
            }

            if (msg.type === "input" && handle) {
              handle.writeStdin(msg.data ?? "");
              return;
            }

            if (msg.type === "cancel" && handle) {
              handle.cancel();
              handle = null;
              return;
            }

            if (msg.type === "exec") {
              if (!msg.command?.trim()) {
                socket.send(
                  JSON.stringify({
                    type: "error",
                    message: "command required",
                  }),
                );
                return;
              }
              if (handle) {
                handle.cancel();
                handle = null;
              }
              handle = await execService.run({
                projectId,
                projectRoot,
                command: msg.command.trim(),
                cwd: msg.cwd,
                onMessage: (event) => {
                  if (socket.readyState === 1) {
                    socket.send(JSON.stringify(event));
                  }
                },
              });
            }
          } catch (err) {
            const code =
              err && typeof err === "object" && "code" in err
                ? String((err as { code: string }).code)
                : "internal_error";
            socket.send(
              JSON.stringify({
                type: "error",
                message: err instanceof Error ? err.message : String(err),
                code,
              }),
            );
          }
        })();
      };

      socket.on("message", (raw) => {
        if (!projectRoot) {
          pendingMessages.push(String(raw));
          return;
        }
        handleMessage(raw);
      });

      socket.on("close", () => {
        handle?.cancel();
      });

      void (async () => {
        const query = request.query ?? {};
        let token =
          query.token ??
          request.headers.authorization?.replace("Bearer ", "");
        if (!token && request.url) {
          const u = new URL(request.url, "http://127.0.0.1");
          token = u.searchParams.get("token") ?? undefined;
        }
        if (!token) {
          socket.close(TERMINAL_WS_CLOSE.UNAUTHORIZED, "Unauthorized");
          return;
        }

        let ctx = redeemWsToken(token);
        if (!ctx) {
          const fakeReq = {
            headers: { authorization: `Bearer ${token}` },
          } as Parameters<typeof auth.authenticate>[0];
          ctx = await auth.authenticate(fakeReq);
        }
        if (!ctx) {
          socket.close(TERMINAL_WS_CLOSE.UNAUTHORIZED, "Unauthorized");
          return;
        }
        if (!auth.requireScope(ctx, ScopeEnum.TERMINAL_EXEC)) {
          socket.close(TERMINAL_WS_CLOSE.FORBIDDEN, "Forbidden");
          return;
        }

        const access = await assertProjectAccess(ctx.userId, projectId);
        if (!access.ok) {
          if (access.error.code === "conflict") {
            socket.close(TERMINAL_WS_CLOSE.PROJECT_ARCHIVED, "Project archived");
          } else if (access.error.code === "not_found") {
            socket.close(TERMINAL_WS_CLOSE.NOT_FOUND, "Not found");
          } else {
            socket.close(TERMINAL_WS_CLOSE.FORBIDDEN, "Forbidden");
          }
          return;
        }

        const project = await prisma.project.findUnique({
          where: { id: projectId },
        });
        if (!project) {
          socket.close(TERMINAL_WS_CLOSE.NOT_FOUND, "Not found");
          return;
        }

        projectRoot = project.rootPath;
        socket.send(JSON.stringify({ type: "ready" }));
        for (const raw of pendingMessages) {
          handleMessage(raw);
        }
        pendingMessages.length = 0;
      })();
    },
  );
}

function streamPreviewProxy(
  request: FastifyRequest,
  reply: FastifyReply,
  input: {
    host: string;
    port: number;
    method: string;
    path: string;
    headers: Record<string, string | string[] | undefined>;
  },
): Promise<void> {
  return new Promise((resolve, reject) => {
    reply.hijack();
    const filteredHeaders = { ...input.headers };
    delete filteredHeaders.host;
    delete filteredHeaders.connection;

    const hasBody =
      input.method !== "GET" &&
      input.method !== "HEAD" &&
      input.method !== "OPTIONS";

    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      request.raw.off("aborted", abortUpstream);
      request.raw.off("close", abortUpstream);
      fn();
    };

    const req = httpRequest(
      {
        hostname: input.host,
        port: input.port,
        method: input.method,
        path: input.path,
        headers: filteredHeaders,
      },
      (res) => {
        reply.raw.writeHead(res.statusCode ?? 502, res.headers);
        res.on("error", (err) => finish(() => reject(err)));
        res.on("end", () => finish(resolve));
        res.on("close", () => finish(resolve));
        res.pipe(reply.raw);
      },
    );

    const abortUpstream = () => {
      if (!req.destroyed) req.destroy();
    };
    request.raw.on("aborted", abortUpstream);
    request.raw.on("close", abortUpstream);

    req.on("error", (err) => {
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(502);
        reply.raw.end("Preview proxy failed");
      }
      finish(() => reject(err));
    });

    if (hasBody && request.raw.readable) {
      request.raw.pipe(req);
    } else {
      req.end();
    }
  });
}
