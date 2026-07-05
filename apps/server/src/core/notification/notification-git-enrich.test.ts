import { describe, expect, it } from "vitest";
import { NotificationKind } from "./notification-engine.js";
import { enrichRunDoneWithGit } from "./notification-git-enrich.js";

const baseRunDone = {
  kind: NotificationKind.RUN_DONE,
  priority: 50,
  title: "실행 완료",
  summary: "run finished",
  deeplink: "/project/p1/session/s1",
  groupable: true,
};

describe("enrichRunDoneWithGit (18~20차)", () => {
  it("keeps run_done when repo is clean", () => {
    const result = enrichRunDoneWithGit(baseRunDone, "p1", {
      listChanges: [],
      stagedCount: 0,
      unstagedCount: 0,
    });
    expect(result.kind).toBe(NotificationKind.RUN_DONE);
  });

  it("emits git_status when dirty without listChanges", () => {
    const result = enrichRunDoneWithGit(baseRunDone, "p1", {
      listChanges: [],
      stagedCount: 2,
      unstagedCount: 1,
    });
    expect(result.kind).toBe(NotificationKind.GIT_STATUS);
    expect(result.deeplink).toBe("/project/p1/git");
    expect(result.summary).toContain("스테이징 2");
  });

  it("emits review_ready when listChanges present", () => {
    const result = enrichRunDoneWithGit(baseRunDone, "p1", {
      listChanges: ["a.ts", "b.ts"],
      stagedCount: 1,
      unstagedCount: 1,
    });
    expect(result.kind).toBe(NotificationKind.REVIEW_READY);
    expect(result.deeplink).toBe("/project/p1/diff");
    expect(result.summary).toContain("2개 파일");
  });

  it("passes through non-run_done candidates", () => {
    const error = { ...baseRunDone, kind: NotificationKind.ERROR };
    expect(
      enrichRunDoneWithGit(error, "p1", {
        listChanges: ["x"],
        stagedCount: 0,
        unstagedCount: 0,
      }).kind,
    ).toBe(NotificationKind.ERROR);
  });
});
