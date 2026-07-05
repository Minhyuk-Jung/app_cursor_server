import { useCallback, useEffect, useState } from "react";
import type { AppSettings } from "../config.js";
import {
  commitProjectChanges,
  createProjectPullRequest,
  getProjectDiff,
  pushProject,
  rollbackProject,
  type GitChangeItem,
  type GitDiffFile,
} from "../api/client.js";

interface GitDiffPanelProps {
  settings: AppSettings;
  projectId: string;
  activeRunId?: string | null;
  refreshKey?: number;
}

type ReviewDecision = "pending" | "approved" | "rejected";

export function GitDiffPanel({
  settings,
  projectId,
  activeRunId,
  refreshKey = 0,
}: GitDiffPanelProps) {
  const [changes, setChanges] = useState<GitChangeItem[]>([]);
  const [files, setFiles] = useState<GitDiffFile[]>([]);
  const [conflicts, setConflicts] = useState<string[]>([]);
  const [decisions, setDecisions] = useState<Record<string, ReviewDecision>>({});
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [commitMessage, setCommitMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const loadDiff = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getProjectDiff(settings, projectId);
      setChanges(data.changes);
      setFiles(data.files);
      setConflicts(data.conflicts ?? []);
      setDecisions((prev) => {
        const next: Record<string, ReviewDecision> = {};
        for (const c of data.changes) {
          next[c.path] = prev[c.path] ?? "pending";
        }
        return next;
      });
      if (data.changes.length > 0) {
        setSelectedPath((prev) => prev ?? data.changes[0]!.path);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [settings, projectId]);

  useEffect(() => {
    void loadDiff();
  }, [loadDiff, refreshKey]);

  const selectedDiff = files.find((f) => f.path === selectedPath);

  const approvedPaths = changes
    .filter((c) => decisions[c.path] === "approved")
    .map((c) => c.path);

  const handleCommit = async () => {
    if (!commitMessage.trim() || approvedPaths.length === 0) return;
    setLoading(true);
    setError(null);
    setStatus(null);
    try {
      await commitProjectChanges(
        settings,
        projectId,
        commitMessage.trim(),
        approvedPaths,
      );
      setStatus("커밋 완료");
      setCommitMessage("");
      await loadDiff();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handlePush = async () => {
    setLoading(true);
    setError(null);
    setStatus(null);
    try {
      const result = await pushProject(settings, projectId);
      setStatus(`푸시 완료: ${result.remote}/${result.branch}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleCreatePr = async () => {
    const title =
      commitMessage.trim() ||
      `Review: ${approvedPaths.length} file(s) from remote session`;
    setLoading(true);
    setError(null);
    setStatus(null);
    try {
      const pr = await createProjectPullRequest(settings, projectId, title);
      setStatus(`PR 생성: #${pr.number} ${pr.url}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleRollback = async () => {
    if (!activeRunId) {
      setError("롤백할 실행(run)이 없습니다");
      return;
    }
    if (!confirm("스냅샷으로 되돌리시겠습니까?")) return;
    setLoading(true);
    setError(null);
    try {
      await rollbackProject(settings, projectId, { runId: activeRunId });
      setStatus("스냅샷으로 복원됨");
      await loadDiff();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <aside className="git-diff-panel">
      <div className="section-header">
        <h2>변경 리뷰</h2>
        <button type="button" className="btn-sm" onClick={() => void loadDiff()} disabled={loading}>
          새로고침
        </button>
      </div>

      {error && <p className="error-text">{error}</p>}
      {status && <p className="success-text">{status}</p>}
      {conflicts.length > 0 && (
        <p className="error-text">
          충돌 파일: {conflicts.join(", ")} — merge 해소 후 커밋하세요.
        </p>
      )}

      {loading && changes.length === 0 ? (
        <p className="muted">불러오는 중…</p>
      ) : changes.length === 0 ? (
        <p className="muted">변경된 파일 없음</p>
      ) : (
        <>
          <ul className="diff-file-list">
            {changes.map((c) => (
              <li key={c.path}>
                <button
                  type="button"
                  className={`diff-file-item ${selectedPath === c.path ? "active" : ""}`}
                  onClick={() => setSelectedPath(c.path)}
                >
                  <span className={`change-kind ${c.changeKind}`}>{c.changeKind}</span>
                  <span className="diff-path">{c.path}</span>
                </button>
                <div className="review-actions">
                  <button
                    type="button"
                    className={`btn-xs ${decisions[c.path] === "approved" ? "active" : ""}`}
                    onClick={() =>
                      setDecisions((d) => ({ ...d, [c.path]: "approved" }))
                    }
                  >
                    승인
                  </button>
                  <button
                    type="button"
                    className={`btn-xs ${decisions[c.path] === "rejected" ? "active" : ""}`}
                    onClick={() =>
                      setDecisions((d) => ({ ...d, [c.path]: "rejected" }))
                    }
                  >
                    거절
                  </button>
                </div>
              </li>
            ))}
          </ul>

          <pre className="diff-viewer">
            {selectedDiff?.hunks || "(diff 없음)"}
          </pre>

          <div className="diff-actions">
            <input
              type="text"
              placeholder="커밋 메시지"
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              className="commit-input"
            />
            <button
              type="button"
              className="btn-sm"
              disabled={loading || approvedPaths.length === 0}
              onClick={() => void handleCommit()}
            >
              승인분 커밋 ({approvedPaths.length})
            </button>
            <button
              type="button"
              className="btn-sm"
              disabled={loading}
              onClick={() => void handlePush()}
            >
              푸시
            </button>
            <button
              type="button"
              className="btn-sm"
              disabled={loading}
              onClick={() => void handleCreatePr()}
            >
              PR 생성
            </button>
            {activeRunId && (
              <button
                type="button"
                className="btn-sm btn-danger"
                disabled={loading}
                onClick={() => void handleRollback()}
              >
                스냅샷 롤백
              </button>
            )}
          </div>
        </>
      )}
    </aside>
  );
}
