/** UR-07 — GET /api/v1/projects/:id/git 응답 (web/mobile 공유) */
export interface ProjectGitStatus {
  branch: string;
  dirty: boolean;
  changedCount: number;
  stagedCount: number;
  unstagedCount: number;
  lastCommitMessage: string | null;
  /** upstream 대비 ahead 커밋 수 — upstream 없으면 null */
  ahead: number | null;
  /** upstream 대비 behind 커밋 수 — upstream 없으면 null */
  behind: number | null;
}
