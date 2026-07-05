import type { EventEnvelope } from "@app/shared";
import type { MobileSettings } from "../config";
import { loadCursor, saveCursor } from "../config/cursor";
import { fetchWsToken } from "./client";

export type ConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected";

export interface StreamOptions {
  settings: MobileSettings;
  sessionId: string;
  onEvent: (envelope: EventEnvelope) => void;
  onStatus: (status: ConnectionStatus) => void;
}

export function isNewSeq(seq: number, lastSeq: number): boolean {
  return seq > lastSeq;
}

export class EventStreamConnection {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private readonly maxAttempts = 12;
  private disposed = false;
  private lastSeq = 0;

  constructor(private options: StreamOptions) {
    this.lastSeq = 0;
  }

  async connect(): Promise<void> {
    this.disposed = false;
    this.lastSeq = await loadCursor("session", this.options.sessionId);
    await this.openSocket();
  }

  disconnect(): void {
    this.disposed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
    this.options.onStatus("disconnected");
  }

  private async openSocket(): Promise<void> {
    if (this.disposed) return;

    const { settings, sessionId } = this.options;
    const cursor = await loadCursor("session", sessionId);
    this.options.onStatus(
      this.reconnectAttempts > 0 ? "reconnecting" : "connecting",
    );

    let wsToken: string;
    try {
      const issued = await fetchWsToken(settings);
      wsToken = issued.token;
    } catch {
      this.options.onStatus("disconnected");
      return;
    }

    const base = settings.apiBaseUrl.replace(/^http/, "ws");
    const url = new URL(`${base}/api/v1/stream`);
    url.searchParams.set("scope", "session");
    url.searchParams.set("scopeId", sessionId);
    url.searchParams.set("cursor", String(cursor));
    url.searchParams.set("token", wsToken);

    const ws = new WebSocket(url.toString());
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.options.onStatus("connected");
      ws.send(JSON.stringify({ type: "ping" }));
    };

    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(String(ev.data)) as
          | EventEnvelope
          | { type: "pong" };
        if ("type" in data && data.type === "pong") return;
        void this.handleEnvelope(data as EventEnvelope);
      } catch {
        // ignore malformed
      }
    };

    ws.onclose = () => {
      this.ws = null;
      if (!this.disposed) {
        this.scheduleReconnect();
      } else {
        this.options.onStatus("disconnected");
      }
    };

    ws.onerror = () => {
      ws.close();
    };
  }

  private async handleEnvelope(envelope: EventEnvelope): Promise<void> {
    if (!isNewSeq(envelope.seq, this.lastSeq)) return;
    this.lastSeq = envelope.seq;
    await saveCursor("session", this.options.sessionId, envelope.seq);
    this.options.onEvent(envelope);
  }

  private scheduleReconnect(): void {
    if (this.disposed) return;
    if (this.reconnectAttempts >= this.maxAttempts) {
      this.options.onStatus("disconnected");
      return;
    }
    this.reconnectAttempts += 1;
    const delay = Math.min(1000 * 2 ** (this.reconnectAttempts - 1), 30000);
    this.options.onStatus("reconnecting");
    this.reconnectTimer = setTimeout(() => {
      void this.openSocket();
    }, delay);
  }
}
