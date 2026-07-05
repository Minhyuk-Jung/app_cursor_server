import { useCallback, useEffect, useRef, useState } from "react";
import type { MobileSettings } from "../config";
import { loadCursor, saveCursor } from "../config/cursor";
import {
  applyEventToState,
  applyReplayEvents,
  createInitialSessionState,
  dbMessagesToChat,
  type SessionUiState,
} from "../state/session-ui";
import {
  EventStreamConnection,
  type ConnectionStatus,
} from "../api/event-stream";
import { listMessages, replayEvents } from "../api/client";

const MESSAGE_PAGE_SIZE = 50;

export function useSessionStream(settings: MobileSettings, sessionId: string) {
  const [uiState, setUiState] = useState<SessionUiState>(
    createInitialSessionState(),
  );
  const [connStatus, setConnStatus] = useState<ConnectionStatus>("idle");
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const connRef = useRef<EventStreamConnection | null>(null);
  const messagesRef = useRef(uiState.messages);
  messagesRef.current = uiState.messages;

  const reloadMessages = useCallback(async () => {
    const page = await listMessages(settings, sessionId, {
      limit: MESSAGE_PAGE_SIZE,
    });
    setHasMoreMessages(page.hasMore);
    const events = await replayEvents(settings, sessionId, 0);
    let state = createInitialSessionState();
    const fresh = dbMessagesToChat(page.messages);
    const freshIds = new Set(fresh.map((m) => m.id));
    const olderKept = messagesRef.current.filter(
      (m) => !m.id.startsWith("u-") && !freshIds.has(m.id),
    );
    state.messages = [...olderKept, ...fresh];
    state = applyReplayEvents(state, events);
    const lastSeq = events.length > 0 ? events[events.length - 1]!.seq : 0;
    await saveCursor("session", sessionId, lastSeq);
    setUiState(state);
  }, [sessionId, settings]);

  const loadOlderMessages = useCallback(async () => {
    if (loadingOlder) return;
    const oldest = messagesRef.current.find((m) => !m.id.startsWith("u-"));
    if (!oldest) return;

    setLoadingOlder(true);
    try {
      const page = await listMessages(settings, sessionId, {
        limit: MESSAGE_PAGE_SIZE,
        before: oldest.id,
      });
      setHasMoreMessages(page.hasMore);
      const older = dbMessagesToChat(page.messages);
      setUiState((prev) => ({
        ...prev,
        messages: [...older, ...prev.messages],
      }));
    } finally {
      setLoadingOlder(false);
    }
  }, [sessionId, settings, loadingOlder]);

  useEffect(() => {
    let cancelled = false;

    void reloadMessages().then(async () => {
      if (cancelled) return;

      const conn = new EventStreamConnection({
        settings,
        sessionId,
        onStatus: setConnStatus,
        onEvent: (envelope) => {
          setUiState((prev) => applyEventToState(prev, envelope));
        },
      });
      connRef.current = conn;
      await conn.connect();
    });

    return () => {
      cancelled = true;
      connRef.current?.disconnect();
      connRef.current = null;
    };
  }, [sessionId, settings.apiBaseUrl, settings.apiKey, reloadMessages]);

  return {
    uiState,
    connStatus,
    reloadMessages,
    loadOlderMessages,
    hasMoreMessages,
    loadingOlder,
    setUiState,
  };
}
