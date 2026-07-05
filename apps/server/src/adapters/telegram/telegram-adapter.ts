import { ChannelSource } from "@app/shared";
import {
  devChatOpsHelpText,
  parseDevChatOps,
} from "../shared/dev-chatops.js";

export interface TelegramUpdate {
  update_id?: number;
  message?: {
    text?: string;
    chat?: { id: number };
    from?: { id: number };
  };
}

export interface TelegramGetUpdatesResponse {
  ok: boolean;
  result: TelegramUpdate[];
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number };
}

export type ParsedTelegramCommand = ReturnType<typeof parseDevChatOps> & {
  source: typeof ChannelSource.TELEGRAM;
};

export class TelegramApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterSec?: number,
  ) {
    super(message);
    this.name = "TelegramApiError";
  }
}

export function parseTelegramApiError(
  status: number,
  body: string,
): TelegramApiError {
  try {
    const data = JSON.parse(body) as TelegramGetUpdatesResponse;
    const retryAfter = data.parameters?.retry_after;
    if (status === 429 && typeof retryAfter === "number") {
      return new TelegramApiError(
        `Telegram API rate limited: ${body}`,
        status,
        retryAfter,
      );
    }
    return new TelegramApiError(
      data.description ?? body,
      status,
      retryAfter,
    );
  } catch {
    return new TelegramApiError(body, status);
  }
}

export function parseTelegramInbound(
  update: TelegramUpdate,
): { chatId: string; command: ParsedTelegramCommand | null } | null {
  const message = update.message;
  if (!message?.text?.trim() || message.chat?.id == null) return null;

  const chatId = String(message.chat.id);
  const cmd = parseDevChatOps(message.text);
  if (!cmd) return { chatId, command: null };
  return {
    chatId,
    command: { ...cmd, source: ChannelSource.TELEGRAM },
  };
}

export function formatTelegramOutbound(input: {
  kind: string;
  title: string;
  summary: string;
  deeplink: string;
}): string {
  return `[${input.kind}] ${input.title}\n${input.summary}\n→ ${input.deeplink}`;
}

export function formatTelegramExecResult(input: {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}): string {
  const combined =
    input.stdout.trim() ||
    input.stderr.trim() ||
    "(출력 없음)";
  const clipped =
    combined.length > 3500 ? `${combined.slice(0, 3500)}…` : combined;
  return `[exec] exit ${input.exitCode ?? "?"}\n${clipped}`;
}

export function verifyTelegramWebhookSecret(
  provided: string | undefined,
  expected: string | undefined,
): boolean {
  if (!expected) return true;
  return provided === expected;
}

const SEND_MAX_ATTEMPTS = 3;

export async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  let lastErr: Error | undefined;
  for (let attempt = 0; attempt < SEND_MAX_ATTEMPTS; attempt += 1) {
    try {
      const res = await fetchImpl(
        `https://api.telegram.org/bot${botToken}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text }),
        },
      );
      if (res.ok) return;
      const body = await res.text();
      const err = parseTelegramApiError(res.status, body);
      lastErr = err;
      if (err.status === 429 && err.retryAfterSec) {
        await sleep(err.retryAfterSec * 1000);
        continue;
      }
      if (res.status >= 500 && attempt < SEND_MAX_ATTEMPTS - 1) {
        await sleep(500 * (attempt + 1));
        continue;
      }
      throw err;
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      if (attempt < SEND_MAX_ATTEMPTS - 1) {
        await sleep(500 * (attempt + 1));
        continue;
      }
    }
  }
  throw lastErr ?? new Error("Telegram send failed");
}

/** P7 S31 — long polling getUpdates (outbound-only 방화벽 대응) */
export async function fetchTelegramUpdates(
  botToken: string,
  offset: number,
  timeoutSec: number,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<TelegramUpdate[]> {
  const url = new URL(`https://api.telegram.org/bot${botToken}/getUpdates`);
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("timeout", String(timeoutSec));
  url.searchParams.set("allowed_updates", JSON.stringify(["message"]));

  const res = await fetchImpl(url.toString(), { method: "GET", signal });
  if (!res.ok) {
    const body = await res.text();
    throw parseTelegramApiError(res.status, body);
  }

  const data = (await res.json()) as TelegramGetUpdatesResponse;
  if (!data.ok) {
    throw new TelegramApiError(
      data.description ?? "Telegram getUpdates returned ok=false",
      data.error_code ?? 502,
      data.parameters?.retry_after,
    );
  }
  return data.result ?? [];
}

/** Pull 모드 시작 시 webhook 비활성화 */
export async function deleteTelegramWebhook(
  botToken: string,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetchImpl(
    `https://api.telegram.org/bot${botToken}/deleteWebhook`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ drop_pending_updates: false }),
      signal,
    },
  );
  if (!res.ok) {
    const body = await res.text();
    throw parseTelegramApiError(res.status, body);
  }
  const data = (await res.json()) as { ok: boolean };
  if (!data.ok) {
    throw new TelegramApiError("Telegram deleteWebhook returned ok=false", 502);
  }
}

export function telegramLinkHelp(chatId: string): string {
  return `계정이 연결되지 않았습니다.\nTelegram chat ID: ${chatId}\n웹 설정에서 POST /api/v1/channel-links 로 연결하세요.`;
}

export { devChatOpsHelpText };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
