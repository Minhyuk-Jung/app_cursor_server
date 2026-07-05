import type { ExecStreamMessage } from "@app/shared";
import { isExecSandboxErrorCode, TERMINAL_WS_CLOSE } from "@app/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchWsToken } from "../api/client";
import type { MobileSettings } from "../config";

export type TerminalConnStatus =
  | "connecting"
  | "connected"
  | "ready"
  | "disconnected"
  | "reconnecting";

const RECONNECT_MS = 2500;
const NO_RECONNECT_CODES = new Set<number>([
  TERMINAL_WS_CLOSE.PROJECT_ARCHIVED,
  TERMINAL_WS_CLOSE.FORBIDDEN,
]);

export function useTerminalConnection(
  settings: MobileSettings,
  projectId: string,
  appendLine: (stream: "stdout" | "stderr" | "system", text: string) => void,
) {
  const [connStatus, setConnStatus] = useState<TerminalConnStatus>("connecting");
  const [running, setRunning] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const intentionalClose = useRef(false);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMessage = useCallback(
    (ev: MessageEvent) => {
      try {
        const msg = JSON.parse(String(ev.data)) as ExecStreamMessage & {
          code?: number | string | null;
          command?: string;
          message?: string;
        };
        if (msg.type === "ready") {
          setConnStatus("ready");
          return;
        }
        if (msg.type === "stdout" && msg.data) appendLine("stdout", msg.data);
        else if (msg.type === "stderr" && msg.data) appendLine("stderr", msg.data);
        else if (msg.type === "started") {
          setRunning(true);
          appendLine("system", `$ ${msg.command ?? ""}\n`);
        } else if (msg.type === "exit") {
          setRunning(false);
          appendLine("system", `\n[exit ${msg.code ?? "?"}]\n`);
        } else if (msg.type === "error") {
          if (msg.code === "project_exec_limit") {
            appendLine("system", "프로젝트 exec 상한 도달\n");
          } else if (msg.code === "queue_full") {
            appendLine("system", "서버 exec 상한 — 잠시 후 재시도\n");
          } else if (
            typeof msg.code === "string" &&
            isExecSandboxErrorCode(msg.code)
          ) {
            appendLine("system", `${msg.message ?? msg.code}\n`);
          } else {
            appendLine("stderr", `${msg.message ?? "error"}\n`);
          }
        }
      } catch {
        appendLine("system", String(ev.data));
      }
    },
    [appendLine],
  );

  const connect = useCallback(async () => {
    if (intentionalClose.current) return;
    setConnStatus((s) => (s === "disconnected" ? "reconnecting" : "connecting"));
    setRunning(false);

    try {
      const { token } = await fetchWsToken(settings);
      if (intentionalClose.current) return;

      const base = settings.apiBaseUrl.replace(/^http/, "ws");
      const ws = new WebSocket(
        `${base}/api/v1/projects/${projectId}/terminal?token=${encodeURIComponent(token)}`,
      );
      wsRef.current = ws;

      ws.onopen = () => {
        setConnStatus("connected");
        appendLine("system", "터미널 연결됨\n");
      };
      ws.onclose = (ev) => {
        wsRef.current = null;
        setConnStatus("disconnected");
        setRunning(false);

        if (ev.code === TERMINAL_WS_CLOSE.PROJECT_ARCHIVED) {
          appendLine("system", "프로젝트 아카이브 — 연결 종료\n");
        } else if (ev.code === TERMINAL_WS_CLOSE.FORBIDDEN) {
          appendLine("system", "접근 권한 없음\n");
        } else if (ev.code === TERMINAL_WS_CLOSE.SERVER_SHUTDOWN) {
          appendLine("system", "서버 종료\n");
        } else if (!intentionalClose.current) {
          appendLine("system", "연결 종료 — 재연결 시도…\n");
        } else {
          appendLine("system", "연결 종료\n");
        }

        if (
          !intentionalClose.current &&
          !NO_RECONNECT_CODES.has(ev.code)
        ) {
          reconnectTimer.current = setTimeout(() => {
            reconnectTimer.current = null;
            void connect();
          }, RECONNECT_MS);
        }
      };
      ws.onerror = () => appendLine("system", "WebSocket 오류\n");
      ws.onmessage = handleMessage;
    } catch (e) {
      appendLine(
        "system",
        `${e instanceof Error ? e.message : String(e)}\n`,
      );
      setConnStatus("disconnected");
      if (!intentionalClose.current) {
        reconnectTimer.current = setTimeout(() => {
          reconnectTimer.current = null;
          void connect();
        }, RECONNECT_MS);
      }
    }
  }, [settings, projectId, appendLine, handleMessage]);

  useEffect(() => {
    intentionalClose.current = false;
    void connect();
    return () => {
      intentionalClose.current = true;
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connect]);

  const sendExec = useCallback(
    (command: string) => {
      const cmd = command.trim();
      if (!cmd || wsRef.current?.readyState !== WebSocket.OPEN || connStatus !== "ready") {
        return false;
      }
      wsRef.current.send(JSON.stringify({ type: "exec", command: cmd }));
      return true;
    },
    [connStatus],
  );

  const sendCancel = useCallback(() => {
    wsRef.current?.send(JSON.stringify({ type: "cancel" }));
    setRunning(false);
  }, []);

  const sendStdin = useCallback(
    (line: string) => {
      if (!line || wsRef.current?.readyState !== WebSocket.OPEN || !running) {
        return false;
      }
      wsRef.current.send(
        JSON.stringify({
          type: "input",
          data: line.endsWith("\n") ? line : `${line}\n`,
        }),
      );
      return true;
    },
    [running],
  );

  const ready = connStatus === "ready";
  const connected = connStatus === "connected" || ready || connStatus === "reconnecting";

  return {
    connStatus,
    connected,
    ready,
    running,
    sendExec,
    sendCancel,
    sendStdin,
  };
}
