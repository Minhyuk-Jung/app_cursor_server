import {
  markInboxRead,
  resolveInboxNavigation,
  type InboxItem,
} from "../api/client.js";
import type { AppSettings } from "../config.js";

interface InboxPanelProps {
  settings: AppSettings;
  open: boolean;
  items: InboxItem[];
  loading: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onNavigate: (
    projectId: string,
    opts?: { sessionId?: string; view?: "diff" | "terminal" | "git" },
  ) => void;
  onItemRead?: (id: string) => void;
  onRequestPush?: () => void;
}

const KIND_LABEL: Record<string, string> = {
  error: "오류",
  approval_required: "승인",
  review_ready: "리뷰",
  git_status: "Git",
  run_done: "완료",
  exec_timeout: "터미널",
  exec_memory_limit: "터미널",
  info: "정보",
};

export function InboxPanel({
  settings,
  open,
  items,
  loading,
  onClose,
  onRefresh,
  onNavigate,
  onItemRead,
  onRequestPush,
}: InboxPanelProps) {
  if (!open) return null;

  const handleSelect = async (item: InboxItem) => {
    const { projectId, sessionId, view } = resolveInboxNavigation(item);

    if (projectId) {
      onNavigate(projectId, { sessionId, view });
      onClose();
    }

    if (!item.read) {
      onItemRead?.(item.id);
      try {
        await markInboxRead(settings, item.id);
      } catch {
        // 읽음 PATCH 실패해도 deeplink 네비게이션은 유지
      }
    }
  };

  return (
    <div className="inbox-drawer-backdrop" onClick={onClose} role="presentation">
      <aside
        className="inbox-drawer"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="전역 인박스"
      >
        <header className="panel-header">
          <h2>인박스</h2>
          <div className="file-toolbar">
            {onRequestPush && (
              <button type="button" className="btn-sm" onClick={() => void onRequestPush()}>
                🔔
              </button>
            )}
            <button type="button" className="btn-sm" onClick={() => void onRefresh()}>
              ↻
            </button>
            <button type="button" className="btn-sm" onClick={onClose}>
              ×
            </button>
          </div>
        </header>

        {loading && <p className="muted empty-hint">로딩…</p>}

        <ul className="inbox-list">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className={`inbox-item ${item.read ? "read" : "unread"} inbox-${item.kind}`}
                data-testid={`inbox-item-${item.id}`}
                onClick={() => void handleSelect(item)}
              >
                <span className="inbox-kind">
                  {KIND_LABEL[item.kind] ?? item.kind}
                </span>
                <strong>{item.title}</strong>
                <span className="inbox-summary">{item.summary}</span>
                {item.groupCount > 1 && (
                  <span className="badge">×{item.groupCount}</span>
                )}
                <time className="muted">
                  {new Date(item.createdAt).toLocaleString()}
                </time>
              </button>
            </li>
          ))}
          {!loading && items.length === 0 && (
            <li className="muted empty-hint">알림 없음</li>
          )}
        </ul>
      </aside>
    </div>
  );
}
