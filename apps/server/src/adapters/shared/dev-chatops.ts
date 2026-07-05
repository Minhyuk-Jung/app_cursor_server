import { ChannelSource } from "@app/shared";

const DEV_PREFIX = "/dev";

export type DevChatOpsCommand =
  | {
      kind: "send_prompt";
      sessionId: string;
      text: string;
    }
  | { kind: "status" }
  | {
      kind: "approve";
      approvalId: string;
      decision: "approve" | "reject";
    }
  | { kind: "cancel"; runId: string }
  | {
      kind: "exec_command";
      projectId: string;
      command: string;
    }
  | {
      kind: "create_project";
      name: string;
      gitUrl?: string;
    };

/** 10 §5.3 ChatOps — 채널 공통 /dev 명령 파서 */
export function parseDevChatOps(text: string): DevChatOpsCommand | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith(DEV_PREFIX)) return null;

  const parts = trimmed.slice(DEV_PREFIX.length).trim().split(/\s+/);
  const verb = (parts[0] ?? "").toLowerCase();

  if (verb === "status") {
    return { kind: "status" };
  }

  if (verb === "prompt") {
    const sessionId = parts[1];
    const promptText = parts.slice(2).join(" ").trim();
    if (!sessionId || !promptText) return null;
    return { kind: "send_prompt", sessionId, text: promptText };
  }

  if (verb === "project") {
    const name = parts[1];
    const gitUrl = parts.slice(2).join(" ").trim() || undefined;
    if (!name) return null;
    return { kind: "create_project", name, gitUrl };
  }

  if (verb === "approve") {
    const approvalId = parts[1];
    const decision = (parts[2] ?? "approve").toLowerCase();
    if (!approvalId) return null;
    return {
      kind: "approve",
      approvalId,
      decision: decision === "reject" ? "reject" : "approve",
    };
  }

  if (verb === "cancel") {
    const runId = parts[1];
    if (!runId) return null;
    return { kind: "cancel", runId };
  }

  if (verb === "exec") {
    const projectId = parts[1];
    const command = parts.slice(2).join(" ").trim();
    if (!projectId || !command) return null;
    return { kind: "exec_command", projectId, command };
  }

  return null;
}

export function devChatOpsHelpText(): string {
  return (
    "사용법: /dev prompt <sessionId> <text> | /dev project <name> [gitUrl] | " +
    "/dev status | /dev approve <id> | /dev cancel <runId> | /dev exec <projectId> <command>"
  );
}

export function withChannelSource<T extends DevChatOpsCommand>(
  cmd: T,
  source: typeof ChannelSource.TELEGRAM | typeof ChannelSource.CUSTOM,
): T & { source: typeof source } {
  return { ...cmd, source };
}
