import type { DomainEvent, EventEnvelope } from "@app/shared";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  runId?: string;
  streaming?: boolean;
  attachments?: Array<{ kind: string; ref: string; mime?: string }>;
}

export function parseMessageAttachments(
  attachmentsJson: string | null | undefined,
): ChatMessage["attachments"] {
  if (!attachmentsJson) return undefined;
  try {
    const parsed = JSON.parse(attachmentsJson) as ChatMessage["attachments"];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** legacy content(📷 줄) 또는 attachmentsJson 병행 시 UI 본문만 표시 */
export function userMessageDisplayContent(
  content: string,
  attachments?: ChatMessage["attachments"],
): string {
  if (!attachments?.length) return content;
  const marker = content.search(/\n\n[📷📎📁]/u);
  if (marker >= 0) return content.slice(0, marker).trim();
  return content;
}

export interface WorkItem {
  id: string;
  runId: string;
  type: string;
  summary: string;
  at: string;
  path?: string;
  callId?: string;
  detail?: string;
}

function buildToolSummary(
  name: string,
  toolStatus?: "started" | "completed" | "error",
  output?: string,
): string {
  if (toolStatus === "error") return `${name} (failed)`;
  if (toolStatus === "completed" && output) {
    const oneLine = output.replace(/\s+/g, " ").trim();
    const preview = oneLine.slice(0, 120);
    return `${name}: ${preview}${oneLine.length > 120 ? "…" : ""}`;
  }
  return name;
}

export interface SessionUiState {
  messages: ChatMessage[];
  workItems: WorkItem[];
  activeRunId: string | null;
  runStatus: string | null;
  pendingApproval: { approvalId: string; detail: string; runId: string } | null;
}

export function createInitialSessionState(): SessionUiState {
  return {
    messages: [],
    workItems: [],
    activeRunId: null,
    runStatus: null,
    pendingApproval: null,
  };
}

let itemCounter = 0;

export function applyEventToState(
  state: SessionUiState,
  envelope: EventEnvelope,
): SessionUiState {
  const ev = envelope.event;
  let messages = [...state.messages];
  const workItems = [...state.workItems];
  let activeRunId = state.activeRunId;
  let runStatus = state.runStatus;
  let pendingApproval = state.pendingApproval;

  switch (ev.type) {
    case "run_queued":
      activeRunId = ev.runId;
      runStatus = "queued";
      break;

    case "run_started":
      activeRunId = ev.runId;
      runStatus = "running";
      break;

    case "assistant": {
      const updated = appendAssistant(messages, ev.runId, ev.text);
      messages = updated;
      runStatus = "streaming";
      break;
    }

    case "tool": {
      const callId = ev.callId;
      const summary = buildToolSummary(ev.name, ev.toolStatus, ev.output);
      if (callId) {
        const idx = workItems.findIndex(
          (w) => w.callId === callId && w.runId === ev.runId,
        );
        if (idx >= 0) {
          workItems[idx] = {
            ...workItems[idx]!,
            summary,
            detail: ev.output ?? workItems[idx]!.detail,
            at: envelope.at,
          };
          runStatus = "streaming";
          break;
        }
      }
      workItems.push({
        id: `w-${++itemCounter}`,
        runId: ev.runId,
        type: "tool",
        summary,
        at: envelope.at,
        callId,
        detail: ev.output,
      });
      runStatus = "streaming";
      break;
    }

    case "plan":
      workItems.push({
        id: `w-${++itemCounter}`,
        runId: ev.runId,
        type: "plan",
        summary: ev.steps.join(" → "),
        at: envelope.at,
      });
      break;

    case "file_change":
      workItems.push({
        id: `w-${++itemCounter}`,
        runId: ev.runId,
        type: "file_change",
        summary: `${ev.changeKind}: ${ev.path}`,
        at: envelope.at,
        path: ev.path,
      });
      break;

    case "approval_required":
      pendingApproval = {
        approvalId: ev.approvalId,
        detail: ev.detail,
        runId: ev.runId,
      };
      runStatus = "waiting_approval";
      break;

    case "approval_resolved":
      if (pendingApproval?.approvalId === ev.approvalId) {
        pendingApproval = null;
      }
      if (ev.decision === "approve") {
        runStatus = "streaming";
      }
      break;

    case "run_done":
      runStatus = ev.status;
      if (ev.status === "finished" || ev.status === "cancelled") {
        activeRunId = null;
        pendingApproval = null;
      }
      messages = finalizeStreamingAssistant(messages);
      break;

    case "error":
      workItems.push({
        id: `w-${++itemCounter}`,
        runId: ev.runId ?? "unknown",
        type: "error",
        summary: ev.message,
        at: envelope.at,
      });
      break;
  }

  return {
    messages,
    workItems,
    activeRunId,
    runStatus,
    pendingApproval,
  };
}

function appendAssistant(
  messages: ChatMessage[],
  runId: string,
  text: string,
): ChatMessage[] {
  const next = [...messages];
  const last = next[next.length - 1];
  if (last?.role === "assistant" && last.runId === runId && last.streaming) {
    next[next.length - 1] = { ...last, content: last.content + text };
  } else {
    next.push({
      id: `a-${runId}-${next.length}`,
      role: "assistant",
      content: text,
      runId,
      streaming: true,
    });
  }
  return next;
}

function finalizeStreamingAssistant(messages: ChatMessage[]): ChatMessage[] {
  const next = [...messages];
  const last = next[next.length - 1];
  if (last?.streaming) {
    next[next.length - 1] = { ...last, streaming: false };
  }
  return next;
}

export function dbMessagesToChat(
  rows: Array<{
    id: string;
    role: string;
    content: string;
    runId: string | null;
    attachmentsJson?: string | null;
  }>,
): ChatMessage[] {
  const result: ChatMessage[] = [];
  for (const m of rows) {
    const last = result[result.length - 1];
    if (
      m.role === "assistant" &&
      m.runId &&
      last?.role === "assistant" &&
      last.runId === m.runId
    ) {
      result[result.length - 1] = {
        ...last,
        content: last.content + m.content,
      };
      continue;
    }
    result.push({
      id: m.id,
      role: m.role as ChatMessage["role"],
      content: m.content,
      runId: m.runId ?? undefined,
      attachments: parseMessageAttachments(m.attachmentsJson),
    });
  }
  return result;
}

/** REST 리플레이로 작업현황·run 상태 복원 (assistant는 DB 메시지 우선) */
export function applyReplayEvents(
  state: SessionUiState,
  envelopes: EventEnvelope[],
): SessionUiState {
  let next = state;
  for (const envelope of envelopes) {
    if (envelope.event.type === "assistant") continue;
    next = applyEventToState(next, envelope);
  }
  return next;
}

export type { DomainEvent, EventEnvelope };
