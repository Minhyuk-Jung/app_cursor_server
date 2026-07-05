import { useCallback, useEffect, useRef, useState } from "react";
import type { ExecStreamMessage } from "@app/shared";
import { isExecSandboxErrorCode, TERMINAL_WS_CLOSE } from "@app/shared";
import type { AppSettings } from "../config.js";

export interface TerminalLine {
  id: string;
  stream: "stdout" | "stderr" | "system";
  text: string;
}

interface TerminalPanelProps {
  settings: AppSettings;
  projectId: string;
}

export function TerminalPanel({ settings, projectId }: TerminalPanelProps) {
  const [lines, setLines] = useState<TerminalLine[]>([]);
  const [command, setCommand] = useState("");
  const [stdinLine, setStdinLine] = useState("");
  const [connected, setConnected] = useState(false);
  const [ready, setReady] = useState(false);
  const [running, setRunning] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewPort, setPreviewPort] = useState("5173");
  const wsRef = useRef<WebSocket | null>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const lineId = useRef(0);

  const appendLine = useCallback((stream: TerminalLine["stream"], text: string) => {
    lineId.current += 1;
    setLines((prev) => {
      const next = [...prev, { id: String(lineId.current), stream, text }];
      return next.length > 5000 ? next.slice(-4000) : next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    let ws: WebSocket | null = null;

    void (async () => {
      const authHeader = `Bearer ${settings.accessToken || settings.apiKey}`;
      const tokenRes = await fetch(`${settings.apiBaseUrl}/api/v1/ws-token`, {
        method: "POST",
        headers: { Authorization: authHeader },
      });
      if (cancelled) return;
      if (!tokenRes.ok) {
        appendLine("system", "WS 토큰 발급 실패\n");
        return;
      }
      const { token } = (await tokenRes.json()) as { token: string };
      const base = settings.apiBaseUrl.replace(/^http/, "ws");
      ws = new WebSocket(
        `${base}/api/v1/projects/${projectId}/terminal?token=${encodeURIComponent(token)}`,
      );
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        appendLine("system", "터미널 연결됨\n");
      };
      ws.onclose = (ev) => {
        setConnected(false);
        setReady(false);
        setRunning(false);
        if (ev.code === TERMINAL_WS_CLOSE.PROJECT_ARCHIVED) {
          appendLine("system", "프로젝트가 아카이브되어 연결이 종료되었습니다.\n");
        } else if (ev.code === TERMINAL_WS_CLOSE.FORBIDDEN) {
          appendLine("system", "접근 권한이 없어 연결이 거부되었습니다.\n");
        } else if (ev.code === TERMINAL_WS_CLOSE.SERVER_SHUTDOWN) {
          appendLine("system", "서버 종료로 연결이 끊겼습니다.\n");
        } else {
          appendLine("system", "연결 종료\n");
        }
      };
      ws.onerror = () => {
        appendLine("system", "WebSocket 오류\n");
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data)) as ExecStreamMessage & {
            code?: number | null;
            command?: string;
          };
          if (msg.type === "ready") {
            setReady(true);
            return;
          }
          if (msg.type === "stdout" && msg.data) {
            appendLine("stdout", msg.data);
          } else if (msg.type === "stderr" && msg.data) {
            appendLine("stderr", msg.data);
          } else if (msg.type === "started") {
            setRunning(true);
            const sid = msg.sandboxId ? ` [${msg.sandboxId.slice(0, 8)}]` : "";
            appendLine("system", `$ ${msg.command ?? ""}${sid}\n`);
          } else if (msg.type === "exit") {
            setRunning(false);
            appendLine("system", `\n[exit ${msg.code ?? "?"}]\n`);
          } else if (msg.type === "error") {
            if (msg.code === "project_exec_limit") {
              appendLine(
                "system",
                "프로젝트 exec 동시 실행 상한에 도달했습니다. 실행 중인 명령을 종료한 뒤 다시 시도하세요.\n",
              );
            } else if (msg.code === "queue_full") {
              appendLine(
                "system",
                "서버 exec 동시 실행 상한에 도달했습니다. 잠시 후 다시 시도하세요.\n",
              );
            } else if (msg.code === "exec_timeout") {
              appendLine(
                "system",
                "명령 실행 시간이 상한을 초과하여 종료되었습니다.\n",
              );
            } else if (msg.code === "exec_memory_limit") {
              appendLine(
                "system",
                "명령 실행 메모리가 상한을 초과하여 종료되었습니다.\n",
              );
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
      };
    })();

    return () => {
      cancelled = true;
      ws?.close();
      wsRef.current = null;
    };
  }, [settings.apiBaseUrl, settings.apiKey, settings.accessToken, projectId, appendLine]);

  useEffect(() => {
    outputRef.current?.scrollTo(0, outputRef.current.scrollHeight);
  }, [lines]);

  const sendExec = () => {
    const cmd = command.trim();
    if (!cmd || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || !ready) {
      return;
    }
    wsRef.current.send(JSON.stringify({ type: "exec", command: cmd }));
    setCommand("");
  };

  const sendCancel = () => {
    wsRef.current?.send(JSON.stringify({ type: "cancel" }));
    setRunning(false);
  };

  const sendStdin = () => {
    const line = stdinLine;
    if (!line || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || !running) {
      return;
    }
    wsRef.current.send(JSON.stringify({ type: "input", data: line.endsWith("\n") ? line : `${line}\n` }));
    setStdinLine("");
  };

  const issuePreview = async () => {
    const port = Number(previewPort);
    if (!port) return;
    try {
      const res = await fetch(
        `${settings.apiBaseUrl}/api/v1/projects/${projectId}/preview`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${settings.accessToken || settings.apiKey}`,
          },
          body: JSON.stringify({ port }),
        },
      );
      const data = (await res.json()) as {
        previewPath?: string;
        error?: { message: string };
      };
      if (!res.ok) {
        appendLine("stderr", `${data.error?.message ?? res.statusText}\n`);
        return;
      }
      const url = `${settings.apiBaseUrl}${data.previewPath ?? ""}`;
      setPreviewUrl(url);
      appendLine("system", `프리뷰 URL: ${url}\n`);
    } catch (e) {
      appendLine("stderr", `${e instanceof Error ? e.message : String(e)}\n`);
    }
  };

  return (
    <div className="terminal-panel" data-testid="terminal-panel">
      <div className="terminal-toolbar">
        <span
          className={`badge ${connected && ready ? "badge-ok" : ""}`}
          data-testid="terminal-status"
        >
          {connected && ready ? "준비됨" : connected ? "인증 중" : "끊김"}
        </span>
        {running && (
          <button type="button" className="btn-icon" onClick={sendCancel}>
            중지
          </button>
        )}
        <div className="preview-controls">
          <input
            type="number"
            value={previewPort}
            onChange={(e) => setPreviewPort(e.target.value)}
            placeholder="포트"
            className="preview-port-input"
          />
          <button type="button" onClick={() => void issuePreview()}>
            프리뷰 URL
          </button>
          {previewUrl && (
            <a href={previewUrl} target="_blank" rel="noreferrer">
              새 탭
            </a>
          )}
        </div>
      </div>
      {previewUrl && (
        <iframe
          className="preview-frame"
          src={previewUrl}
          title="라이브 프리뷰"
          sandbox="allow-scripts allow-same-origin allow-forms"
        />
      )}
      <div className="terminal-output" ref={outputRef} data-testid="terminal-output">
        {lines.map((line) => (
          <pre
            key={line.id}
            className={`terminal-line terminal-${line.stream}`}
          >
            {line.text}
          </pre>
        ))}
      </div>
      <form
        className="terminal-input-row"
        onSubmit={(e) => {
          e.preventDefault();
          sendExec();
        }}
      >
        <span className="terminal-prompt">$</span>
        <input
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder="npm test"
          disabled={!connected || !ready}
          data-testid="terminal-command-input"
        />
        <button
          type="submit"
          disabled={!connected || !ready || !command.trim()}
          data-testid="terminal-run-button"
        >
          실행
        </button>
      </form>
      {running && (
        <form
          className="terminal-input-row terminal-stdin-row"
          onSubmit={(e) => {
            e.preventDefault();
            sendStdin();
          }}
        >
          <span className="terminal-prompt">&gt;</span>
          <input
            value={stdinLine}
            onChange={(e) => setStdinLine(e.target.value)}
            placeholder="프로세스 stdin"
            disabled={!connected || !ready}
          />
          <button type="submit" disabled={!connected || !ready || !stdinLine}>
            전송
          </button>
        </form>
      )}
    </div>
  );
}
