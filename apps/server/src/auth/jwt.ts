import { createHmac, timingSafeEqual } from "node:crypto";
import type { Scope } from "@app/shared";

export interface JwtAccessPayload {
  sub: string;
  scopes: Scope[];
  iat: number;
  exp: number;
}

function base64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf.toString("base64url");
}

function decodeBase64url(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

export function isJwtFormat(token: string): boolean {
  const parts = token.split(".");
  return parts.length === 3 && parts.every((p) => p.length > 0);
}

/** HS256 JWT 발급 (03 §6.1) */
export function signAccessToken(
  userId: string,
  scopes: Scope[],
  secret: string,
  ttlSec: number,
): { token: string; expiresAt: string } {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const payload: JwtAccessPayload = {
    sub: userId,
    scopes,
    iat: now,
    exp: now + ttlSec,
  };
  const body = base64url(JSON.stringify(payload));
  const sig = createHmac("sha256", secret)
    .update(`${header}.${body}`)
    .digest("base64url");
  const expiresAt = new Date(payload.exp * 1000).toISOString();
  return { token: `${header}.${body}.${sig}`, expiresAt };
}

export function verifyAccessToken(
  token: string,
  secret: string,
): JwtAccessPayload | null {
  if (!isJwtFormat(token)) return null;

  const [header, body, sig] = token.split(".") as [string, string, string];
  const expected = createHmac("sha256", secret)
    .update(`${header}.${body}`)
    .digest("base64url");

  try {
    if (
      !timingSafeEqual(Buffer.from(sig, "utf8"), Buffer.from(expected, "utf8"))
    ) {
      return null;
    }
  } catch {
    return null;
  }

  let payload: JwtAccessPayload;
  try {
    payload = JSON.parse(decodeBase64url(body)) as JwtAccessPayload;
  } catch {
    return null;
  }

  if (!payload.sub || !Array.isArray(payload.scopes)) return null;
  if (payload.exp <= Math.floor(Date.now() / 1000)) return null;

  return payload;
}
