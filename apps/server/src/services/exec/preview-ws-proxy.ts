import type { IncomingMessage, Server } from "node:http";
import type { Socket } from "node:net";
import WebSocket, { WebSocketServer } from "ws";
import type { PreviewRegistry } from "./preview-registry.js";

const PREVIEW_PREFIX = "/api/v1/preview/";

/**
 * 13 §6.3 라이브 프리뷰 — Vite HMR 등 WebSocket upgrade를 upstream으로 중계.
 */
export function registerPreviewWebSocketProxy(
  server: Server,
  previewRegistry: PreviewRegistry,
): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req: IncomingMessage, socket: Socket, head: Buffer) => {
    const rawUrl = req.url ?? "";
    if (!rawUrl.startsWith(PREVIEW_PREFIX)) return;

    const qIdx = rawUrl.indexOf("?");
    const pathOnly = qIdx >= 0 ? rawUrl.slice(0, qIdx) : rawUrl;
    const query = qIdx >= 0 ? rawUrl.slice(qIdx) : "";

    const match = pathOnly.match(/^\/api\/v1\/preview\/([^/]+)(\/.*)?$/);
    if (!match?.[1]) {
      rejectUpgrade(socket, 400);
      return;
    }

    const entry = previewRegistry.get(match[1]);
    if (!entry) {
      rejectUpgrade(socket, 403);
      return;
    }

    const suffix = (match[2] ?? "/") + query;
    const upstreamUrl = `ws://${entry.host}:${entry.port}${suffix}`;

    wss.handleUpgrade(req, socket, head, (clientWs) => {
      const pending: Array<{ data: WebSocket.RawData; isBinary: boolean }> = [];
      const upstream = new WebSocket(upstreamUrl);

      const closeBoth = () => {
        try {
          clientWs.close();
        } catch {
          /* ignore */
        }
        try {
          upstream.close();
        } catch {
          /* ignore */
        }
      };

      clientWs.on("error", closeBoth);
      upstream.on("error", closeBoth);

      clientWs.on("message", (data, isBinary) => {
        if (upstream.readyState === WebSocket.OPEN) {
          upstream.send(data, { binary: isBinary });
        } else {
          pending.push({ data, isBinary });
        }
      });

      upstream.on("open", () => {
        for (const msg of pending) {
          upstream.send(msg.data, { binary: msg.isBinary });
        }
        pending.length = 0;

        upstream.on("message", (data, isBinary) => {
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(data, { binary: isBinary });
          }
        });
        clientWs.on("close", () => upstream.close());
        upstream.on("close", () => clientWs.close());
      });
    });
  });
}

function rejectUpgrade(socket: Socket, status: number): void {
  const text = status === 403 ? "Forbidden" : "Bad Request";
  socket.write(`HTTP/1.1 ${status} ${text}\r\n\r\n`);
  socket.destroy();
}
