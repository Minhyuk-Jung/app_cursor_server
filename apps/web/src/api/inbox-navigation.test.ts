import { describe, expect, it } from "vitest";
import { resolveInboxNavigation } from "./client.js";

describe("resolveInboxNavigation (09 → 15)", () => {
  it("uses terminal deeplink for exec_timeout", () => {
    expect(
      resolveInboxNavigation({
        kind: "exec_timeout",
        deeplink: "/project/p1/terminal",
        projectId: "p1",
      }),
    ).toEqual({
      projectId: "p1",
      view: "terminal",
    });
  });

  it("falls back to projectId + terminal view for exec_memory_limit without deeplink", () => {
    expect(
      resolveInboxNavigation({
        kind: "exec_memory_limit",
        deeplink: "",
        projectId: "p2",
      }),
    ).toEqual({
      projectId: "p2",
      view: "terminal",
    });
  });

  it("parses diff deeplink", () => {
    expect(
      resolveInboxNavigation({
        kind: "review_ready",
        deeplink: "/project/p3/diff",
        projectId: "p3",
      }),
    ).toEqual({
      projectId: "p3",
      view: "diff",
    });
  });

  it("parses git deeplink for git_status", () => {
    expect(
      resolveInboxNavigation({
        kind: "git_status",
        deeplink: "/project/p5/git",
        projectId: "p5",
      }),
    ).toEqual({
      projectId: "p5",
      view: "git",
    });
  });

  it("returns sessionId from session deeplink without panel view", () => {
    expect(
      resolveInboxNavigation({
        kind: "run_done",
        deeplink: "/project/p4/session/s1",
        projectId: "p4",
      }),
    ).toEqual({
      projectId: "p4",
      sessionId: "s1",
    });
  });
});
