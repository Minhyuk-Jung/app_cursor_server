import { ChannelSource } from "@app/shared";
import { createHmac, timingSafeEqual } from "node:crypto";

export interface CustomInboundPayload {
  sessionId?: string;
  text?: string;
  command?: string;
  projectName?: string;
  projectId?: string;
}

export interface ParsedCustomCommand {
  kind: "send_prompt" | "status" | "exec_command";
  sessionId?: string;
  text?: string;
  projectId?: string;
  command?: string;
  source: typeof ChannelSource.CUSTOM;
}

export function parseCustomInbound(
  body: CustomInboundPayload,
): ParsedCustomCommand | null {
  const command = (body.command ?? "prompt").toLowerCase();

  if (command === "status") {
    return { kind: "status", source: ChannelSource.CUSTOM };
  }

  if (command === "exec") {
    const projectId = body.projectId?.trim();
    const cmd = body.text?.trim();
    if (!projectId || !cmd) return null;
    return {
      kind: "exec_command",
      projectId,
      command: cmd,
      source: ChannelSource.CUSTOM,
    };
  }

  if (!body.sessionId || !body.text?.trim()) {
    return null;
  }

  return {
    kind: "send_prompt",
    sessionId: body.sessionId,
    text: body.text.trim(),
    source: ChannelSource.CUSTOM,
  };
}

export function formatCustomOutbound(input: {
  kind: string;
  title: string;
  summary: string;
  deeplink: string;
}): { text: string } {
  return {
    text: `[${input.kind}] ${input.title}: ${input.summary} → ${input.deeplink}`,
  };
}

export function verifyCustomSignature(
  rawBody: string,
  signature: string | undefined,
  secret: string | undefined,
): boolean {
  if (!secret) return true;
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  try {
    return timingSafeEqual(
      Buffer.from(expected, "utf8"),
      Buffer.from(signature, "utf8"),
    );
  } catch {
    return false;
  }
}

/** 10 §10: 재생 공격 방지 — ±maxSkewSec 이내만 허용 */
export function verifyWebhookTimestamp(
  timestampHeader: string | undefined,
  maxSkewSec = 300,
): boolean {
  if (!timestampHeader) return false;
  const ts = Number(timestampHeader);
  if (!Number.isFinite(ts)) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  return Math.abs(nowSec - ts) <= maxSkewSec;
}

export async function deliverCustomWebhook(
  url: string,
  payload: { kind: string; title: string; summary: string; deeplink: string },
): Promise<void> {
  const body = formatCustomOutbound(payload);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Webhook delivery failed: ${res.status}`);
  }
}
