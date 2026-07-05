import type { Scope } from "@app/shared";
import type { AuthContext } from "./auth.js";

interface WsTokenEntry {
  userId: string;
  scopes: Scope[];
  expiresAt: number;
}

const tokens = new Map<string, WsTokenEntry>();

const DEFAULT_TTL_MS = 60_000;

export function issueWsToken(ctx: AuthContext, ttlMs = DEFAULT_TTL_MS): {
  token: string;
  expiresAt: string;
} {
  const token = crypto.randomUUID();
  const expiresAt = Date.now() + ttlMs;
  tokens.set(token, {
    userId: ctx.userId,
    scopes: [...ctx.scopes],
    expiresAt,
  });
  purgeExpired();
  return { token, expiresAt: new Date(expiresAt).toISOString() };
}

/** 단기 WS 토큰 검증 (02 §7, 03 §6.1.1) — 연결 시 1회 소비 */
export function redeemWsToken(token: string): AuthContext | null {
  purgeExpired();
  const entry = tokens.get(token);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    tokens.delete(token);
    return null;
  }
  tokens.delete(token);
  return {
    subjectType: "user",
    userId: entry.userId,
    scopes: entry.scopes,
  };
}

function purgeExpired(): void {
  const now = Date.now();
  for (const [key, entry] of tokens) {
    if (entry.expiresAt < now) tokens.delete(key);
  }
}

/** 테스트용 */
export function clearWsTokens(): void {
  tokens.clear();
}
