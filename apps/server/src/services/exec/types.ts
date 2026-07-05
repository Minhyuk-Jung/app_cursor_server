import type { ExecStreamMessage } from "@app/shared";

export type { ExecStreamMessage };

export type SandboxMode = "subprocess" | "docker";

export interface ExecRunHandle {
  execId: string;
  cancel: () => void;
  writeStdin: (data: string) => void;
}

export interface PreviewEntry {
  token: string;
  projectId: string;
  userId: string;
  host: string;
  port: number;
  expiresAt: number;
}

/** subprocess 완화 모드 — 서버 시크릿 env 상속 차단 (13 §10, ADR-007) */
export function buildSandboxEnv(cwd: string): NodeJS.ProcessEnv {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    HOME: cwd,
    USERPROFILE: cwd,
    TEMP: cwd,
    TMP: cwd,
    LANG: process.env.LANG ?? "C.UTF-8",
  };
  if (process.platform === "win32") {
    env.SystemRoot = process.env.SystemRoot ?? "C:\\Windows";
    env.COMSPEC = process.env.COMSPEC ?? "cmd.exe";
    env.WINDIR = process.env.WINDIR ?? env.SystemRoot;
  }
  return env;
}

export function isPreviewPortAllowed(
  port: number,
  min: number,
  max: number,
): boolean {
  return Number.isInteger(port) && port >= min && port <= max;
}
