import type { FastifyInstance } from "fastify";
import type { SubscriptionScope } from "@app/shared";
import type { RunEventLog } from "../core/eventlog/types.js";
import type { InboxHub } from "../core/notification/inbox-hub.js";
import type { AuthService } from "../auth/auth.js";
import { assertReplayAccess } from "../auth/access.js";
import { redeemWsToken } from "../auth/ws-token.js";

interface WsConnection {
  connectionId: string;
  scope: SubscriptionScope;
  scopeId?: string;
  cursorKind: "seq" | "globalOffset";
  lastSentCursor: number;
}

export async function registerWebSocket(
  app: FastifyInstance,
  eventLog: RunEventLog,
  auth: AuthService,
  inboxHub?: InboxHub,
): Promise<void> {
  const connections = new Map<string, WsConnection>();

  const handleStream = (path: string) =>
    app.get<{
      Querystring: {
        scope?: "session" | "project" | "global";
        id?: string;
        scopeId?: string;
        cursor?: string;
        token?: string;
      };
    }>(path, { websocket: true }, (socket, request) => {
      void (async () => {
        const token =
          request.query.token ??
          request.headers.authorization?.replace("Bearer ", "");
        let ctx = token ? redeemWsToken(token) : null;
        if (!ctx && token) {
          const fakeReq = {
            headers: { authorization: `Bearer ${token}` },
          } as Parameters<typeof auth.authenticate>[0];
          ctx = await auth.authenticate(fakeReq);
        }
        if (!ctx) {
          socket.close(4401, "Unauthorized");
          return;
        }

        const scope = (request.query.scope ?? "global") as SubscriptionScope;
        const scopeId = request.query.id ?? request.query.scopeId;

        const access = await assertReplayAccess(ctx.userId, scope, scopeId);
        if (!access.ok) {
          socket.close(4403, "Forbidden");
          return;
        }

        const subscriberId = crypto.randomUUID();
        const connectionId = crypto.randomUUID();
        const cursorKind = scope === "session" ? "seq" : "globalOffset";

        const conn: WsConnection = {
          connectionId,
          scope,
          scopeId,
          cursorKind,
          lastSentCursor: Number(request.query.cursor ?? 0),
        };
        connections.set(connectionId, conn);

        try {
          const missed = await eventLog.replay(
            scope,
            scopeId,
            conn.lastSentCursor,
          );
          for (const envelope of missed) {
            socket.send(JSON.stringify(envelope));
            conn.lastSentCursor =
              cursorKind === "seq"
                ? envelope.seq
                : envelope.globalOffset;
          }
        } catch {
          socket.close(1011, "Replay failed");
          return;
        }

        eventLog.subscribe({
          subscriberId,
          scope,
          scopeId,
          deliver: (envelope) => {
            socket.send(JSON.stringify(envelope));
            conn.lastSentCursor =
              cursorKind === "seq"
                ? envelope.seq
                : envelope.globalOffset;
          },
        });

        let unsubscribeInbox: (() => void) | undefined;
        if (inboxHub && scope === "global") {
          unsubscribeInbox = inboxHub.subscribe((item) => {
            socket.send(JSON.stringify({ type: "inbox_item", item }));
          });
        }

        socket.on("message", (raw) => {
          try {
            const msg = JSON.parse(String(raw)) as { type?: string };
            if (msg.type === "ping") {
              socket.send(JSON.stringify({ type: "pong" }));
            }
          } catch {
            // ignore
          }
        });

        socket.on("close", () => {
          eventLog.unsubscribe(subscriberId);
          unsubscribeInbox?.();
          connections.delete(connectionId);
        });
      })();
    });

  handleStream("/api/v1/stream");
  handleStream("/api/v1/ws/events");
}
