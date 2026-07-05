import { useCallback, useEffect, useRef, useState } from "react";
import type { AppSettings } from "../config.js";
import {
  fetchWsToken,
  listInbox,
  subscribeWebPush,
  type InboxItem,
} from "../api/client.js";

export function useInbox(settings: AppSettings) {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listInbox(settings);
      setItems(list);
      setUnreadCount(list.filter((i) => !i.read).length);
    } finally {
      setLoading(false);
    }
  }, [settings]);

  const markItemRead = useCallback((id: string) => {
    setItems((prev) => {
      const next = prev.map((i) => (i.id === id ? { ...i, read: true } : i));
      setUnreadCount(next.filter((i) => !i.read).length);
      return next;
    });
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const { token } = await fetchWsToken(settings);
        if (cancelled) return;

        const url = new URL(`${settings.apiBaseUrl.replace(/^http/, "ws")}/api/v1/stream`);
        url.searchParams.set("scope", "global");
        url.searchParams.set("cursor", "0");
        url.searchParams.set("token", token);

        const ws = new WebSocket(url.toString());
        wsRef.current = ws;

        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(String(ev.data)) as {
              type?: string;
              item?: InboxItem;
            };
            if (msg.type === "inbox_item" && msg.item) {
              setItems((prev) => [msg.item!, ...prev]);
              setUnreadCount((n) => n + 1);

              if (
                typeof Notification !== "undefined" &&
                Notification.permission === "granted"
              ) {
                new Notification(msg.item.title, { body: msg.item.summary });
              }
            }
          } catch {
            // ignore non-inbox messages
          }
        };
      } catch {
        // WS optional
      }
    })();

    return () => {
      cancelled = true;
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [settings.apiBaseUrl, settings.apiKey]);

  const requestPushPermission = async () => {
    if (typeof Notification === "undefined") return false;
    if (Notification.permission === "granted") {
      return subscribeWebPush(settings);
    }
    if (Notification.permission === "denied") return false;
    const result = await Notification.requestPermission();
    if (result !== "granted") return false;
    return subscribeWebPush(settings);
  };

  return {
    items,
    loading,
    unreadCount,
    refresh,
    markItemRead,
    requestPushPermission,
  };
}
