import { describe, expect, it } from "vitest";
import { parseDeeplink } from "./deeplink";

describe("mobile parseDeeplink", () => {
  it("parses session deeplink", () => {
    expect(parseDeeplink("/project/p1/session/s1")).toEqual({
      projectId: "p1",
      sessionId: "s1",
      view: "session",
    });
  });

  it("parses diff deeplink", () => {
    expect(parseDeeplink("/project/p1/diff")).toEqual({
      projectId: "p1",
      view: "diff",
    });
  });

  it("parses terminal deeplink", () => {
    expect(parseDeeplink("/project/p1/terminal")).toEqual({
      projectId: "p1",
      view: "terminal",
    });
  });

  it("parses git deeplink", () => {
    expect(parseDeeplink("/project/p1/git")).toEqual({
      projectId: "p1",
      view: "git",
    });
  });
});
