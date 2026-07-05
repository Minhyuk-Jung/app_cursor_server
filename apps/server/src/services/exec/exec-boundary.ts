import { ExecOutputChannel } from "@app/shared";

/**
 * 13 §8.1 — AI 툴 출력 vs 사용자 터미널 경계.
 *
 * - USER_TERMINAL: exec-routes 터미널 WebSocket → RunEventLog 미경유
 * - AGENT_TOOL: SdkAdapter tool 이벤트 → SessionManager → RunEventLog
 */
export { ExecOutputChannel };

/** SDK 셸·터미널 계열 툴명 (대표 목록, 미지원명은 일반 tool로 처리) */
export const SHELL_TOOL_NAMES = new Set([
  "run_terminal_cmd",
  "shell",
  "bash",
  "execute_command",
  "terminal",
  "run_command",
]);

export function isShellTool(name: string): boolean {
  const lower = name.toLowerCase();
  if (SHELL_TOOL_NAMES.has(lower)) return true;
  return (
    lower.includes("terminal") ||
    lower.includes("shell") ||
    lower.includes("bash")
  );
}

/** 사용자 터미널 exec는 RunEventLog에 기록하지 않음 (13 §8.1) */
export const USER_TERMINAL_OUTPUT_CHANNEL = ExecOutputChannel.USER_TERMINAL;

/** SdkAdapter tool 이벤트 기본 출력 채널 */
export const AGENT_TOOL_OUTPUT_CHANNEL = ExecOutputChannel.AGENT_TOOL;

/** exec_command(17) — RunEventLog 미경유, 사용자/어댑터 헤드리스 exec */
export const HEADLESS_EXEC_OUTPUT_CHANNEL = ExecOutputChannel.USER_TERMINAL;
