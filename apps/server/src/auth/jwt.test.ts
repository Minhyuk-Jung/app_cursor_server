import { describe, expect, it } from "vitest";
import { Scope as ScopeEnum } from "@app/shared";
import { isJwtFormat, signAccessToken, verifyAccessToken } from "./jwt.js";

const SECRET = "test-jwt-secret";
const SCOPES = [ScopeEnum.PROJECT_READ, ScopeEnum.PROMPT_SEND];

describe("JWT (03 §6.1, SR-09)", () => {
  it("issues and verifies access token", () => {
    const { token, expiresAt } = signAccessToken(
      "user-1",
      SCOPES,
      SECRET,
      3600,
    );
    expect(isJwtFormat(token)).toBe(true);
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());

    const payload = verifyAccessToken(token, SECRET);
    expect(payload?.sub).toBe("user-1");
    expect(payload?.scopes).toEqual(SCOPES);
  });

  it("rejects invalid signature", () => {
    const { token } = signAccessToken("user-1", SCOPES, SECRET, 3600);
    const forged = `${token.slice(0, -1)}x`;
    expect(verifyAccessToken(forged, SECRET)).toBeNull();
  });

  it("rejects expired token", () => {
    const { token } = signAccessToken("user-1", SCOPES, SECRET, -1);
    expect(verifyAccessToken(token, SECRET)).toBeNull();
  });
});
