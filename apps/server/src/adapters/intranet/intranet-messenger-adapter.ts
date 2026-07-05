/** S31 / UR-13 — 사내 메신저 pull API 계약 (JSON) */

import { intranetMessageRequestId } from "../shared/channel-request-id.js";

export { intranetMessageRequestId };

export interface IntranetPollMessage {
  id: string;
  chatId: string;
  text: string;
}

export interface IntranetPollResponse {
  messages: IntranetPollMessage[];
  cursor: string;
}

export function parseIntranetPollResponse(body: unknown): IntranetPollResponse {
  if (!body || typeof body !== "object") {
    return { messages: [], cursor: "" };
  }
  const data = body as {
    messages?: unknown;
    cursor?: unknown;
  };
  const messages = Array.isArray(data.messages)
    ? data.messages
        .map((m) => {
          if (!m || typeof m !== "object") return null;
          const row = m as Record<string, unknown>;
          if (
            typeof row.id !== "string" ||
            typeof row.chatId !== "string" ||
            typeof row.text !== "string"
          ) {
            return null;
          }
          return { id: row.id, chatId: row.chatId, text: row.text };
        })
        .filter((m): m is IntranetPollMessage => m !== null)
    : [];
  return {
    messages,
    cursor: typeof data.cursor === "string" ? data.cursor : "",
  };
}

export async function fetchIntranetMessages(
  pollUrl: string,
  cursor: string,
  authHeader: string | undefined,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<IntranetPollResponse> {
  const url = new URL(pollUrl);
  if (cursor) url.searchParams.set("cursor", cursor);

  const headers: Record<string, string> = { Accept: "application/json" };
  if (authHeader) headers.Authorization = authHeader;

  const res = await fetchImpl(url.toString(), { method: "GET", headers, signal });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Intranet poll failed: ${res.status} ${body}`);
  }
  return parseIntranetPollResponse(await res.json());
}
