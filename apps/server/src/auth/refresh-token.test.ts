import { describe, expect, it } from "vitest";
import { Scope as ScopeEnum } from "@app/shared";
import {
  issueRefreshToken,
  redeemRefreshToken,
  clearRefreshTokens,
} from "./refresh-token.js";

describe("refresh token (03 §10)", () => {
  it("issues and redeems with rotation", () => {
    clearRefreshTokens();
    const { refreshToken } = issueRefreshToken(
      "user-1",
      [ScopeEnum.PROJECT_READ],
      60_000,
    );
    const ctx = redeemRefreshToken(refreshToken);
    expect(ctx?.userId).toBe("user-1");
    expect(redeemRefreshToken(refreshToken)).toBeNull();
  });
});
