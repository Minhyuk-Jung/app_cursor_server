import { describe, expect, it } from "vitest";
import {
  hasNestedInlineMarkup,
  isAutolinkToken,
  normalizeAutolinkUrl,
  splitAutolinkTokens,
} from "./markdown-inline";

describe("markdown-inline", () => {
  it("splits https and www autolinks", () => {
    expect(splitAutolinkTokens("see www.example.com/docs ok")).toEqual([
      "see ",
      "www.example.com/docs",
      " ok",
    ]);
  });

  it("normalizes www to https", () => {
    expect(normalizeAutolinkUrl("www.example.com")).toBe(
      "https://www.example.com",
    );
    expect(normalizeAutolinkUrl("https://x.test")).toBe("https://x.test");
  });

  it("detects autolink tokens", () => {
    expect(isAutolinkToken("https://a.test")).toBe(true);
    expect(isAutolinkToken("www.a.test")).toBe(true);
    expect(isAutolinkToken("plain")).toBe(false);
  });

  it("detects nested inline markup", () => {
    expect(hasNestedInlineMarkup("**bold *inner* text**")).toBe(true);
    expect(hasNestedInlineMarkup("plain text")).toBe(false);
  });
});
