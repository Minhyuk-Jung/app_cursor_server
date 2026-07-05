import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SdkAdapter } from "../sdk/sdk-adapter.js";

export interface SessionMessageSlice {
  role: string;
  content: string;
  attachmentsJson?: string | null;
}

/** 05 §6.5 — 규칙 기반 Session.summary (UR-16 기본) */
export function buildRuleBasedSessionSummary(
  messages: SessionMessageSlice[],
): string {
  const lastUser = messages.find((m) => m.role === "user");
  const lastAssistant = messages.find((m) => m.role === "assistant");
  const parts: string[] = [];
  if (lastUser) {
    let userPart = `요청: ${lastUser.content.slice(0, 100)}`;
    if (lastUser.attachmentsJson) {
      try {
        const atts = JSON.parse(lastUser.attachmentsJson) as unknown[];
        if (Array.isArray(atts) && atts.length > 0) {
          userPart += ` (첨부 ${atts.length}개)`;
        }
      } catch {
        // ignore malformed JSON
      }
    }
    parts.push(userPart);
  }
  if (lastAssistant) {
    parts.push(`결과: ${lastAssistant.content.slice(0, 100)}`);
  }
  return parts.join(" · ") || "활동 없음";
}

export function formatSummaryTranscript(messages: SessionMessageSlice[]): string {
  return [...messages]
    .reverse()
    .map((m) => `${m.role}: ${m.content.slice(0, 300)}`)
    .join("\n");
}

export interface LlmSummarySession {
  model: string;
  project: { rootPath: string; id: string };
}

/** UR-16 — 경량 SDK one-shot 요약 (SESSION_SUMMARY_LLM=true, 세션 Agent와 격리) */
export async function summarizeWithSdkAgent(
  sdk: SdkAdapter,
  apiKey: string,
  session: LlmSummarySession,
  transcript: string,
): Promise<string | null> {
  if (!apiKey.trim() || !transcript.trim()) return null;

  const ephemeralCwd = await mkdtemp(join(tmpdir(), "session-summary-"));
  const agent = await sdk.createAgent({
    cwd: ephemeralCwd,
    model: session.model,
    apiKey,
    projectId: session.project.id,
  });

  try {
    const handle = await agent.send(
      [
        "다음 세션 대화를 한국어 한 문장(120자 이내)으로 요약하세요.",
        "요약만 출력하고 다른 설명은 하지 마세요.",
        "",
        transcript,
      ].join("\n"),
    );

    let text = "";
    for await (const ev of handle.streamEvents()) {
      if (ev.type === "assistant" && "text" in ev) {
        text += ev.text;
      }
    }
    await handle.wait();
    const trimmed = text.trim().slice(0, 200);
    return trimmed.length > 0 ? trimmed : null;
  } finally {
    await agent.dispose();
  }
}

export async function resolveSessionSummary(
  messages: SessionMessageSlice[],
  options?: {
    llm?: {
      sdk: SdkAdapter;
      apiKey: string;
      session: LlmSummarySession;
      /** tests — SDK 호출 대체 */
      tryLlm?: () => Promise<string | null>;
    };
  },
): Promise<string> {
  if (
    process.env.SESSION_SUMMARY_LLM === "true" &&
    options?.llm?.apiKey &&
    messages.length > 0
  ) {
    try {
      const transcript = formatSummaryTranscript(messages);
      const llm =
        (await options.llm.tryLlm?.()) ??
        (await summarizeWithSdkAgent(
          options.llm.sdk,
          options.llm.apiKey,
          options.llm.session,
          transcript,
        ));
      if (llm) return llm;
    } catch {
      // best-effort → rule fallback
    }
  }
  return buildRuleBasedSessionSummary(messages);
}
