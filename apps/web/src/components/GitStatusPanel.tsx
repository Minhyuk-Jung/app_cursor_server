import { useCallback, useEffect, useState } from "react";
import { ApiError, getProjectGit } from "../api/client.js";
import type { AppSettings } from "../config.js";

interface GitStatusPanelProps {
  settings: AppSettings;
  projectId: string;
  refreshKey?: number;
  onOpenDiff?: () => void;
}

export function GitStatusPanel({
  settings,
  projectId,
  refreshKey = 0,
  onOpenDiff,
}: GitStatusPanelProps) {
  const [branch, setBranch] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [changedCount, setChangedCount] = useState(0);
  const [stagedCount, setStagedCount] = useState(0);
  const [unstagedCount, setUnstagedCount] = useState(0);
  const [lastCommitMessage, setLastCommitMessage] = useState<string | null>(null);
  const [ahead, setAhead] = useState<number | null>(null);
  const [behind, setBehind] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const status = await getProjectGit(settings, projectId);
      setBranch(status.branch);
      setDirty(status.dirty);
      setChangedCount(status.changedCount);
      setStagedCount(status.stagedCount);
      setUnstagedCount(status.unstagedCount);
      setLastCommitMessage(status.lastCommitMessage);
      setAhead(status.ahead);
      setBehind(status.behind);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [settings, projectId]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus, refreshKey]);

  return (
    <aside className="git-status-panel" data-testid="git-status-panel">
      <header className="panel-header">
        <h2>Git 상태</h2>
        <button
          type="button"
          className="btn-sm"
          onClick={() => void loadStatus()}
          disabled={loading}
        >
          {loading ? "불러오는 중…" : "새로고침"}
        </button>
      </header>

      {error ? <p className="error-text">{error}</p> : null}

      {loading ? (
        <p className="muted-text">Git 상태를 불러오는 중…</p>
      ) : (
        <dl className="git-status-grid">
          <div>
            <dt>브랜치</dt>
            <dd>{branch ?? "—"}</dd>
          </div>
          {lastCommitMessage ? (
            <div>
              <dt>최근 커밋</dt>
              <dd>{lastCommitMessage}</dd>
            </div>
          ) : null}
          <div>
            <dt>원격 동기</dt>
            <dd data-testid="git-upstream-sync">
              {ahead !== null && behind !== null ? (
                <>
                  ↑{ahead} · ↓{behind}
                </>
              ) : (
                <span className="muted-text">upstream 미설정</span>
              )}
            </dd>
          </div>
          <div>
            <dt>작업 트리</dt>
            <dd className={dirty ? "git-dirty" : "git-clean"}>
              {dirty ? `변경 ${changedCount}건` : "깨끗함"}
            </dd>
          </div>
          {dirty ? (
            <div>
              <dt>스테이징 / unstaged</dt>
              <dd>
                {stagedCount} · {unstagedCount}
              </dd>
            </div>
          ) : null}
        </dl>
      )}

      {dirty && onOpenDiff ? (
        <button type="button" className="btn-sm" onClick={onOpenDiff}>
          변경 리뷰(diff) 열기
        </button>
      ) : null}

      <p className="muted-text git-status-hint">
        커밋·푸시·PR은 변경 리뷰 탭에서 수행합니다.
      </p>
    </aside>
  );
}
