import { describe, expect, it } from "vitest";
import { issueWsToken, redeemWsToken, clearWsTokens } from "./ws-token.js";
import { Scope as ScopeEnum } from "@app/shared";

describe("ws-token", () => {
  it("issues one-time token", () => {
    clearWsTokens();
    const { token } = issueWsToken({
      subjectType: "user",
      userId: "u1",
      scopes: [ScopeEnum.PROJECT_READ],
    });
    const ctx = redeemWsToken(token);
    expect(ctx?.userId).toBe("u1");
    expect(redeemWsToken(token)).toBeNull();
  });
});
