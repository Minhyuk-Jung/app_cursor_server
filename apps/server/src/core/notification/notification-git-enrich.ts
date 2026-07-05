import { NotificationKind } from "./notification-engine.js";

export type NotificationCandidate = {
  kind: string;
  priority: number;
  title: string;
  summary: string;
  deeplink: string;
  groupable: boolean;
};

export type GitEnrichInput = {
  listChanges: string[];
  stagedCount: number;
  unstagedCount: number;
};

/** 18차 — run_done enrich: review_ready vs dirty-only git_status */
export function enrichRunDoneWithGit(
  candidate: NotificationCandidate,
  projectId: string,
  git: GitEnrichInput,
): NotificationCandidate {
  if (candidate.kind !== NotificationKind.RUN_DONE) {
    return candidate;
  }

  if (git.listChanges.length === 0) {
    if (git.stagedCount === 0 && git.unstagedCount === 0) {
      return candidate;
    }
    return {
      kind: NotificationKind.GIT_STATUS,
      priority: 82,
      title: "Git 상태",
      summary: `스테이징 ${git.stagedCount} · unstaged ${git.unstagedCount}`,
      deeplink: `/project/${projectId}/git`,
      groupable: false,
    };
  }

  return {
    kind: NotificationKind.REVIEW_READY,
    priority: 85,
    title: "변경 리뷰 대기",
    summary: `${git.listChanges.length}개 파일 변경 — diff 리뷰 (staged ${git.stagedCount} · unstaged ${git.unstagedCount})`,
    deeplink: `/project/${projectId}/diff`,
    groupable: false,
  };
}
