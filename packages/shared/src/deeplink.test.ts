import { describe, expect, it } from "vitest";
import { parseDeeplink, resolveInboxNavigation } from "./deeplink.js";

describe("shared parseDeeplink", () => {
  it("parses session deeplink", () => {
    expect(parseDeeplink("/project/p1/session/s1")).toEqual({
      projectId: "p1",
      sessionId: "s1",
      view: "session",
    });
  });

  it("parses diff, terminal, git deeplinks", () => {
    expect(parseDeeplink("/project/p1/diff")).toEqual({
      projectId: "p1",
      view: "diff",
    });
    expect(parseDeeplink("/project/p1/terminal")).toEqual({
      projectId: "p1",
      view: "terminal",
    });
    expect(parseDeeplink("/project/p1/git")).toEqual({
      projectId: "p1",
      view: "git",
    });
  });
});

describe("shared resolveInboxNavigation", () => {
  it("parses git deeplink for git_status", () => {
    expect(
      resolveInboxNavigation({
        kind: "git_status",
        deeplink: "/project/p3/git",
        projectId: "p3",
      }),
    ).toEqual({
      projectId: "p3",
      view: "git",
    });
  });

  it("falls back to terminal for exec_timeout", () => {
    expect(
      resolveInboxNavigation({
        kind: "exec_timeout",
        deeplink: "",
        projectId: "p2",
      }),
    ).toEqual({
      projectId: "p2",
      view: "terminal",
    });
  });
});
