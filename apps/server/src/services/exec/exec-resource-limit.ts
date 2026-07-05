import type { SandboxMode } from "./types.js";

export type ExecResourceLimitKind = "exec_timeout" | "exec_memory_limit";

/** Docker OOM / cgroup memory limit — 13 §9, NFR-13 */
export function isExecMemoryLimitExit(
  exitCode: number | null,
  signal: NodeJS.Signals | string | null,
  sandboxMode: SandboxMode,
  timedOut: boolean,
): boolean {
  if (timedOut || sandboxMode !== "docker") return false;
  if (exitCode === 137) return true;
  if (signal === "SIGKILL" && exitCode !== 0 && exitCode !== 124) return true;
  return false;
}

export function execResourceLimitKind(
  exitCode: number | null,
  signal: NodeJS.Signals | string | null,
  sandboxMode: SandboxMode,
  timedOut: boolean,
  cancelled = false,
): ExecResourceLimitKind | null {
  if (cancelled) return null;
  if (timedOut) return "exec_timeout";
  if (isExecMemoryLimitExit(exitCode, signal, sandboxMode, timedOut)) {
    return "exec_memory_limit";
  }
  return null;
}
