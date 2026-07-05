import { v5 as uuidv5 } from "uuid";

/** 채널 pull 멱등 logical key → UUID v5 (01 §5.2 requestId, MCP mcp-request-id 동일 패턴) */
const CHANNEL_IDEMPOTENCY_NS = "b2c3d4e5-f6a7-4890-b123-456789abcdef";

export function channelRequestIdV5(logicalKey: string): string {
  return uuidv5(logicalKey, CHANNEL_IDEMPOTENCY_NS);
}

export function intranetMessageRequestId(messageId: string): string {
  return channelRequestIdV5(`intranet:message:${messageId}`);
}

export function telegramUpdateRequestIdLogical(updateId: number): string {
  return channelRequestIdV5(`telegram:update:${updateId}`);
}
