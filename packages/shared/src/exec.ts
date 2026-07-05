/** 13 §5 — 터미널 WebSocket exec 스트림 메시지 (01 shared 계약) */
export type ExecErrorCode =
  | "queue_full"
  | "project_exec_limit"
  | "path_escape"
  | "docker_unavailable"
  | "sandbox_not_ready"
  | "sandbox_create_failed"
  | "exec_timeout"
  | "exec_memory_limit"
  | "internal_error";

/** AppError.code와 정합 — sandbox·exec 관련 (01 §5.8 확장) */
export const EXEC_SANDBOX_ERROR_CODES = [
  "docker_unavailable",
  "sandbox_not_ready",
  "sandbox_create_failed",
] as const satisfies readonly ExecErrorCode[];

export function isExecSandboxErrorCode(
  code: string,
): code is (typeof EXEC_SANDBOX_ERROR_CODES)[number] {
  return (EXEC_SANDBOX_ERROR_CODES as readonly string[]).includes(code);
}

/** 터미널 WebSocket close code (02/13 — 4403 forbidden vs 4410 archived 구분) */
export const TERMINAL_WS_CLOSE = {
  UNAUTHORIZED: 4401,
  FORBIDDEN: 4403,
  NOT_FOUND: 4404,
  PROJECT_ARCHIVED: 4410,
  SERVER_SHUTDOWN: 1001,
} as const;

export type ExecStreamMessage =
  | { type: "stdout"; data: string }
  | { type: "stderr"; data: string }
  | { type: "exit"; code: number | null; signal?: string | null }
  | { type: "started"; execId: string; command: string; sandboxId?: string }
  | { type: "error"; message: string; code?: ExecErrorCode | string }
  | { type: "ready" }
  | { type: "pong" };

export type ExecClientMessage =
  | { type: "exec"; command: string; cwd?: string }
  | { type: "input"; data?: string }
  | { type: "cancel" }
  | { type: "ping" };

export interface PreviewIssueResponse {
  token: string;
  previewPath: string;
  expiresAt: string;
  port: number;
}
