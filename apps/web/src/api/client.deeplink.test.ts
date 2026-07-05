import { describe, expect, it } from "vitest";
import { parseDeeplink } from "./client.js";

describe("parseDeeplink (09 → 15)", () => {
  it("parses terminal deeplink for exec notifications", () => {
    expect(parseDeeplink("/project/abc123/terminal")).toEqual({
      projectId: "abc123",
      view: "terminal",
    });
  });

  it("parses diff deeplink", () => {
    expect(parseDeeplink("/project/abc123/diff")).toEqual({
      projectId: "abc123",
      view: "diff",
    });
  });

  it("parses git deeplink", () => {
    expect(parseDeeplink("/project/abc123/git")).toEqual({
      projectId: "abc123",
      view: "git",
    });
  });
});
