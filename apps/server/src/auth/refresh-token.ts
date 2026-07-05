import type { Scope } from "@app/shared";
import { createHash, randomBytes } from "node:crypto";

interface RefreshEntry {
  userId: string;
  scopes: Scope[];
  expiresAt: number;
}

const store = new Map<string, RefreshEntry>();

export function issueRefreshToken(
  userId: string,
  scopes: Scope[],
  ttlMs: number,
): { refreshToken: string; expiresAt: string } {
  const refreshToken = randomBytes(32).toString("base64url");
  const expiresAt = Date.now() + ttlMs;
  store.set(hashToken(refreshToken), { userId, scopes: [...scopes], expiresAt });
  purgeExpired();
  return { refreshToken, expiresAt: new Date(expiresAt).toISOString() };
}

/** 03 §10: refresh 시 회전(1회 사용) */
export function redeemRefreshToken(token: string): {
  userId: string;
  scopes: Scope[];
} | null {
  purgeExpired();
  const key = hashToken(token);
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  store.delete(key);
  return { userId: entry.userId, scopes: entry.scopes };
}

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function purgeExpired(): void {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.expiresAt < now) store.delete(key);
  }
}

/** 테스트용 */
export function clearRefreshTokens(): void {
  store.clear();
}
