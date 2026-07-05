import { useCallback, useEffect, useRef, useState } from "react";
import type { Project, Session, RunningSessionInfo } from "../api/client.js";
import type { PromptAttachment } from "../api/client.js";
import {
  createApiKey,
  createChannelLink,
  deleteApiKey,
  deleteChannelLink,
  fetchAuthToken,
  listApiKeys,
  listChannelLinks,
  type ApiKeyRecord,
  type ChannelLink,
} from "../api/client.js";
import type { AppSettings } from "../config.js";
import type { ConnectionStatus } from "../api/event-stream.js";
import type { ChatMessage, SessionUiState, WorkItem } from "../state/session-ui.js";
import { userMessageDisplayContent } from "../state/session-ui.js";
import { appendSpeechTranscript } from "../lib/speech-input.js";
import { getCachedAttachmentBlob } from "../lib/attachment-blob-cache.js";
import { useSpeechInput } from "../hooks/useSpeechInput.js";
import { MAX_ATTACHMENT_BYTES } from "../config.js";

interface SidebarProps {
  projects: Project[];
  selectedProjectId: string | null;
  sessions: Session[];
  selectedSessionId: string | null;
  onSelectProject: (id: string) => void;
  onSelectSession: (id: string) => void;
  onCreateProject: (name: string, gitUrl?: string) => void;
  onTogglePin: (projectId: string, pinned: boolean) => void;
  onArchiveProject: (projectId: string) => void;
  onRestoreProject: (projectId: string) => void;
  projectStatusFilter: "active" | "archived";
  onProjectStatusFilterChange: (filter: "active" | "archived") => void;
  onCreateSession: () => void;
  loading: boolean;
}

export function Sidebar({
  projects,
  selectedProjectId,
  sessions,
  selectedSessionId,
  onSelectProject,
  onSelectSession,
  onCreateProject,
  onTogglePin,
  onArchiveProject,
  onRestoreProject,
  projectStatusFilter,
  onProjectStatusFilterChange,
  onCreateSession,
  loading,
}: SidebarProps) {
  return (
    <aside className="sidebar">
      <section className="sidebar-section">
        <div className="section-header">
          <h2>{projectStatusFilter === "archived" ? "아카이브" : "프로젝트"}</h2>
          <div className="section-header-actions">
            <button
              type="button"
              className="btn-icon"
              title={projectStatusFilter === "active" ? "아카이브 보기" : "활성 프로젝트"}
              onClick={() =>
                onProjectStatusFilterChange(
                  projectStatusFilter === "active" ? "archived" : "active",
                )
              }
            >
              {projectStatusFilter === "active" ? "📦" : "←"}
            </button>
            {projectStatusFilter === "active" && (
              <button
                type="button"
                className="btn-icon"
                title="새 프로젝트"
                onClick={() => {
                  const name = prompt("프로젝트 이름");
                  if (!name?.trim()) return;
                  const gitUrl = prompt("Git clone URL (선택, 비우면 빈 프로젝트)")?.trim();
                  onCreateProject(name.trim(), gitUrl || undefined);
                }}
              >
                +
              </button>
            )}
          </div>
        </div>
        <ul className="list">
          {projects.map((p) => (
            <li key={p.id} className="project-row">
              <button
                type="button"
                className={`list-item ${selectedProjectId === p.id ? "active" : ""}`}
                onClick={() => onSelectProject(p.id)}
              >
                {p.pinned && <span className="pin-mark">📌</span>}
                {p.name}
              </button>
              <button
                type="button"
                className="btn-icon pin-btn"
                title={p.pinned ? "핀 해제" : "핀"}
                onClick={() => onTogglePin(p.id, !p.pinned)}
              >
                {p.pinned ? "★" : "☆"}
              </button>
              {projectStatusFilter === "active" ? (
                <button
                  type="button"
                  className="btn-icon"
                  title="아카이브"
                  onClick={() => onArchiveProject(p.id)}
                >
                  📦
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-icon"
                  title="복원"
                  onClick={() => onRestoreProject(p.id)}
                >
                  ↩
                </button>
              )}
            </li>
          ))}
          {projects.length === 0 && !loading && (
            <li className="muted">프로젝트 없음</li>
          )}
        </ul>
      </section>

      {selectedProjectId && projectStatusFilter === "active" && (
        <section className="sidebar-section">
          <div className="section-header">
            <h2>세션</h2>
            <button
              type="button"
              className="btn-icon"
              title="새 세션"
              onClick={onCreateSession}
            >
              +
            </button>
          </div>
          <ul className="list">
            {sessions.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  className={`list-item ${selectedSessionId === s.id ? "active" : ""}`}
                  onClick={() => onSelectSession(s.id)}
                >
                  <span>{s.title ?? s.id.slice(0, 8)}</span>
                  {s.summary && (
                    <span className="session-summary">{s.summary}</span>
                  )}
                  {s.branch && (
                    <span className="badge badge-branch">{s.branch}</span>
                  )}
                  <span className="badge">{s.status}</span>
                </button>
              </li>
            ))}
            {sessions.length === 0 && (
              <li className="muted">세션 없음</li>
            )}
          </ul>
        </section>
      )}
    </aside>
  );
}

interface PendingAttachment extends PromptAttachment {
  previewUrl?: string;
}

function AuthenticatedAttachmentDisplay({
  settings,
  projectId,
  attachment,
  onExpandImage,
}: {
  settings: AppSettings;
  projectId: string;
  attachment: PromptAttachment;
  onExpandImage?: (url: string) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (attachment.kind !== "image") return;
    let objectUrl: string | null = null;
    let cancelled = false;
    void getCachedAttachmentBlob(settings, projectId, attachment.ref)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [settings.apiBaseUrl, settings.apiKey, settings.accessToken, projectId, attachment.ref, attachment.kind]);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const blob = await getCachedAttachmentBlob(
        settings,
        projectId,
        attachment.ref,
      );
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      const ext = attachment.mime?.split("/")[1]?.split("+")[0] ?? "bin";
      anchor.download = `attachment-${attachment.ref.slice(0, 8)}.${ext}`;
      anchor.click();
      URL.revokeObjectURL(objectUrl);
    } catch {
      setFailed(true);
    } finally {
      setDownloading(false);
    }
  };

  if (attachment.kind === "file" || attachment.kind === "file_ref") {
    return (
      <button
        type="button"
        className="btn-sm attachment-download"
        disabled={downloading || failed}
        onClick={() => void handleDownload()}
      >
        {downloading ? "…" : "⬇"} {attachment.kind}:{attachment.ref.slice(0, 8)}…
      </button>
    );
  }

  if (attachment.kind !== "image") {
    return (
      <span>
        {attachment.kind}:{attachment.ref.slice(0, 8)}…
      </span>
    );
  }
  if (failed) return <span className="muted">이미지 로드 실패</span>;
  if (!url) return <span className="muted">로딩…</span>;
  return (
    <button
      type="button"
      className="attachment-thumb-btn"
      onClick={() => onExpandImage?.(url)}
      title="클릭하여 확대"
    >
      <img src={url} alt="첨부" className="attachment-preview" />
    </button>
  );
}

interface ChatPanelProps {
  messages: ChatMessage[];
  runStatus: string | null;
  activeRunId: string | null;
  connStatus: ConnectionStatus;
  disabled: boolean;
  settings?: AppSettings;
  projectId?: string;
  hasMoreMessages?: boolean;
  loadingOlder?: boolean;
  onLoadOlder?: () => void;
  onSend: (text: string, attachments?: PromptAttachment[]) => void;
  onSteer?: (text: string) => void;
  onCancel: () => void;
  onUploadAttachment?: (file: File) => Promise<PromptAttachment>;
}

export function ChatPanel({
  messages,
  runStatus,
  activeRunId,
  connStatus,
  disabled,
  settings,
  projectId,
  hasMoreMessages,
  loadingOlder,
  onLoadOlder,
  onSend,
  onSteer,
  onCancel,
  onUploadAttachment,
}: ChatPanelProps) {
  const [text, setText] = useState("");
  const [steerMode, setSteerMode] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<
    PendingAttachment[]
  >([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [expandedImageUrl, setExpandedImageUrl] = useState<string | null>(null);

  const pendingAttachmentsRef = useRef(pendingAttachments);
  pendingAttachmentsRef.current = pendingAttachments;

  useEffect(() => {
    return () => {
      for (const att of pendingAttachmentsRef.current) {
        if (att.previewUrl) URL.revokeObjectURL(att.previewUrl);
      }
    };
  }, []);

  const onVoiceTranscript = useCallback(
    (transcript: string) => {
      setText((prev) => appendSpeechTranscript(prev, transcript));
    },
    [],
  );

  const {
    supported: voiceSupported,
    listening: voiceListening,
    error: voiceError,
    toggle: toggleVoice,
  } = useSpeechInput({ onFinalTranscript: onVoiceTranscript });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed && pendingAttachments.length === 0) return;
    if (steerMode && onSteer && activeRunId) {
      onSteer(trimmed);
    } else {
      onSend(trimmed || "(첨부)", pendingAttachments.length ? pendingAttachments : undefined);
    }
    setText("");
    setPendingAttachments((prev) => {
      for (const att of prev) {
        if (att.previewUrl) URL.revokeObjectURL(att.previewUrl);
      }
      return [];
    });
    setSteerMode(false);
  };

  const canSteer =
    Boolean(activeRunId) &&
    runStatus &&
    ["running", "streaming", "queued", "waiting_approval"].includes(runStatus);

  const handleFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !onUploadAttachment) return;
    setUploadError(null);
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setUploadError(`파일 크기는 ${MAX_ATTACHMENT_BYTES / (1024 * 1024)}MB 이하여야 합니다`);
      return;
    }
    setUploading(true);
    try {
      const att = await onUploadAttachment(file);
      const previewUrl =
        file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined;
      setPendingAttachments((prev) => [...prev, { ...att, previewUrl }]);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  };

  const removePendingAttachment = (ref: string) => {
    setPendingAttachments((prev) => {
      const target = prev.find((x) => x.ref === ref);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((x) => x.ref !== ref);
    });
  };

  return (
    <section className="chat-panel">
      <header className="panel-header">
        <h2>채팅</h2>
        <div className="status-row">
          <span className={`conn-dot conn-${connStatus}`} />
          <span className="muted">{connStatus}</span>
          {runStatus && <span className="badge">{runStatus}</span>}
          {runStatus &&
            ["running", "streaming", "queued"].includes(runStatus) && (
              <button type="button" className="btn-sm" onClick={onCancel}>
                취소
              </button>
            )}
          {canSteer && onSteer && (
            <button
              type="button"
              className={`btn-sm ${steerMode ? "active" : ""}`}
              onClick={() => setSteerMode((v) => !v)}
            >
              {steerMode ? "steer ON" : "추가 지시"}
            </button>
          )}
        </div>
      </header>

      <div className="messages">
        {hasMoreMessages && onLoadOlder && (
          <button
            type="button"
            className="btn-sm load-older-messages"
            disabled={loadingOlder}
            onClick={onLoadOlder}
          >
            {loadingOlder ? "불러오는 중…" : "이전 메시지 더 보기"}
          </button>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`message message-${m.role}`}>
            <div className="message-role">{m.role}</div>
            <div className="message-body">
              {userMessageDisplayContent(m.content, m.attachments)}
              {m.streaming && <span className="cursor-blink">▍</span>}
              {m.attachments && m.attachments.length > 0 && (
                <ul className="message-attachments">
                  {m.attachments.map((a) => (
                    <li
                      key={a.ref}
                      className={a.kind === "image" ? "attachment-image" : undefined}
                    >
                      {settings && projectId ? (
                        <AuthenticatedAttachmentDisplay
                          settings={settings}
                          projectId={projectId}
                          attachment={a as PromptAttachment}
                          onExpandImage={setExpandedImageUrl}
                        />
                      ) : (
                        <span>
                          {a.kind}:{a.ref.slice(0, 8)}…
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ))}
        {messages.length === 0 && (
          <p className="muted empty-hint">프롬프트를 입력해 대화를 시작하세요.</p>
        )}
      </div>

      <form className="prompt-form" onSubmit={handleSubmit}>
        {pendingAttachments.length > 0 && (
          <ul className="pending-attachments">
            {pendingAttachments.map((a) => (
              <li key={a.ref} className={a.previewUrl ? "attachment-image" : undefined}>
                {a.previewUrl ? (
                  <img
                    src={a.previewUrl}
                    alt="첨부 미리보기"
                    className="attachment-preview"
                  />
                ) : (
                  <span>{a.kind}:{a.ref.slice(0, 8)}…</span>
                )}
                <button
                  type="button"
                  className="btn-sm"
                  onClick={() => removePendingAttachment(a.ref)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        {voiceError && <p className="voice-error muted">{voiceError}</p>}
        {uploadError && <p className="voice-error muted">{uploadError}</p>}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={steerMode ? "진행 중 run에 추가 지시…" : "지시를 입력…"}
          rows={3}
          disabled={disabled}
        />
        <div className="prompt-actions">
          {voiceSupported && (
            <button
              type="button"
              className={`btn-sm voice-btn ${voiceListening ? "active listening" : ""}`}
              disabled={disabled || uploading}
              onClick={toggleVoice}
              title={voiceListening ? "음성 입력 중…" : "음성 입력"}
            >
              {voiceListening ? "● 듣는 중" : "🎤 음성"}
            </button>
          )}
          {onUploadAttachment && (
            <label className="btn-sm attach-label">
              {uploading ? "업로드…" : "이미지/첨부"}
              <input
                type="file"
                hidden
                accept="image/*,.pdf,.txt,.md,.json,.csv"
                capture="environment"
                disabled={disabled || uploading}
                onChange={(e) => void handleFilePick(e)}
              />
            </label>
          )}
          <button
            type="submit"
            disabled={
              disabled ||
              uploading ||
              (!text.trim() && pendingAttachments.length === 0)
            }
          >
            {steerMode ? "steer 전송" : "전송"}
          </button>
        </div>
      </form>
      {expandedImageUrl && (
        <div
          className="attachment-lightbox"
          role="dialog"
          aria-modal="true"
          onClick={() => setExpandedImageUrl(null)}
        >
          <img src={expandedImageUrl} alt="첨부 확대" />
          <button
            type="button"
            className="btn-sm attachment-lightbox-close"
            onClick={() => setExpandedImageUrl(null)}
          >
            닫기
          </button>
        </div>
      )}
    </section>
  );
}

interface WorkPanelProps {
  items: WorkItem[];
  pendingApproval: SessionUiState["pendingApproval"];
  onApprove?: (approvalId: string) => void;
  onReject?: (approvalId: string) => void;
}

export function WorkPanel({
  items,
  pendingApproval,
  onApprove,
  onReject,
}: WorkPanelProps) {
  return (
    <section className="work-panel">
      <header className="panel-header">
        <h2>작업 현황</h2>
      </header>

      {pendingApproval && (
        <div className="approval-banner">
          <strong>승인 필요 (실행 중)</strong>
          <p>{pendingApproval.detail}</p>
          <div className="approval-actions">
            <button
              type="button"
              className="btn-primary"
              onClick={() => onApprove?.(pendingApproval.approvalId)}
            >
              승인
            </button>
            <button
              type="button"
              className="btn-danger"
              onClick={() => onReject?.(pendingApproval.approvalId)}
            >
              거절
            </button>
          </div>
        </div>
      )}

      <ul className="work-list">
        {items.map((item) => (
          <li key={item.id} className={`work-item work-${item.type}`}>
            <span className="work-type">{item.type}</span>
            <span className="work-summary">{item.summary}</span>
            {item.detail && item.detail.length > 0 && (
              <pre className="work-detail">{item.detail.slice(0, 2000)}</pre>
            )}
            <time className="muted">{new Date(item.at).toLocaleTimeString()}</time>
          </li>
        ))}
        {items.length === 0 && (
          <li className="muted empty-hint">
            tool / plan / file_change 이벤트가 여기 표시됩니다.
          </li>
        )}
      </ul>
    </section>
  );
}

interface SettingsDrawerProps {
  open: boolean;
  settings: AppSettings;
  onSave: (settings: AppSettings) => void;
  onClose: () => void;
}

function ChannelLinksSection({ settings }: { settings: AppSettings }) {
  const [links, setLinks] = useState<ChannelLink[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [channel, setChannel] = useState("telegram");
  const [externalUserId, setExternalUserId] = useState("");
  const [saving, setSaving] = useState(false);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      setLinks(await listChannelLinks(settings));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [settings.apiBaseUrl, settings.apiKey]);

  const handleAdd = async () => {
    if (!externalUserId.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await createChannelLink(settings, channel.trim(), externalUserId.trim());
      setExternalUserId("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setError(null);
    try {
      await deleteChannelLink(settings, id);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section className="settings-section">
      <h3>채널 연결</h3>
      <p className="hint">
        Telegram Chat ID를 연결하면 /dev 명령을 사용할 수 있습니다.
      </p>
      {error && <p className="error-text">{error}</p>}
      <ul className="channel-link-list">
        {loading && links.length === 0 ? (
          <li>불러오는 중…</li>
        ) : links.length === 0 ? (
          <li className="muted">연결된 채널 없음</li>
        ) : (
          links.map((link) => (
            <li key={link.id}>
              <span>
                {link.channel}: {link.externalUserId}
              </span>
              <button type="button" onClick={() => void handleDelete(link.id)}>
                삭제
              </button>
            </li>
          ))
        )}
      </ul>
      <div className="channel-link-form">
        <label>
          채널
          <select value={channel} onChange={(e) => setChannel(e.target.value)}>
            <option value="telegram">telegram</option>
          </select>
        </label>
        <label>
          외부 사용자 ID (Telegram chat ID)
          <input
            value={externalUserId}
            onChange={(e) => setExternalUserId(e.target.value)}
            placeholder="예: 999001"
          />
        </label>
        <button
          type="button"
          className="btn-primary"
          disabled={saving || !externalUserId.trim()}
          onClick={() => void handleAdd()}
        >
          연결 추가
        </button>
      </div>
    </section>
  );
}

export function SettingsDrawer({
  open,
  settings,
  onSave,
  onClose,
}: SettingsDrawerProps) {
  const [url, setUrl] = useState(settings.apiBaseUrl);
  const [key, setKey] = useState(settings.apiKey);
  const [accessToken, setAccessToken] = useState(settings.accessToken);
  const [refreshToken, setRefreshToken] = useState(settings.refreshToken);
  const [jwtStatus, setJwtStatus] = useState<string | null>(null);
  const [jwtLoading, setJwtLoading] = useState(false);
  const [apiKeys, setApiKeys] = useState<ApiKeyRecord[]>([]);
  const [apiKeysLoading, setApiKeysLoading] = useState(false);
  const [newKeyPlain, setNewKeyPlain] = useState<string | null>(null);
  const [apiKeyStatus, setApiKeyStatus] = useState<string | null>(null);

  const draftSettings = (): AppSettings => ({
    apiBaseUrl: url.trim(),
    apiKey: key.trim(),
    accessToken,
    refreshToken,
  });

  useEffect(() => {
    setUrl(settings.apiBaseUrl);
    setKey(settings.apiKey);
    setAccessToken(settings.accessToken);
    setRefreshToken(settings.refreshToken);
    setJwtStatus(null);
    setNewKeyPlain(null);
    setApiKeyStatus(null);
  }, [settings.apiBaseUrl, settings.apiKey, settings.accessToken, settings.refreshToken, open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setApiKeysLoading(true);
    void listApiKeys(draftSettings())
      .then((keys) => {
        if (!cancelled) setApiKeys(keys);
      })
      .catch((e) => {
        if (!cancelled) {
          setApiKeyStatus(e instanceof Error ? e.message : String(e));
        }
      })
      .finally(() => {
        if (!cancelled) setApiKeysLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, url, key, accessToken]);

  const handleFetchJwt = async () => {
    setJwtLoading(true);
    setJwtStatus(null);
    try {
      const next = await fetchAuthToken(draftSettings());
      setAccessToken(next.accessToken);
      setRefreshToken(next.refreshToken);
      setJwtStatus("JWT 발급 완료");
    } catch (e) {
      setJwtStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setJwtLoading(false);
    }
  };

  const handleCreateApiKey = async () => {
    setApiKeyStatus(null);
    setNewKeyPlain(null);
    try {
      const created = await createApiKey(draftSettings(), { expiresInDays: 90 });
      setNewKeyPlain(created.apiKey);
      setApiKeys(await listApiKeys(draftSettings()));
      setApiKeyStatus("API 키가 생성되었습니다. 한 번만 표시됩니다.");
    } catch (e) {
      setApiKeyStatus(e instanceof Error ? e.message : String(e));
    }
  };

  const handleDeleteApiKey = async (id: string) => {
    setApiKeyStatus(null);
    try {
      await deleteApiKey(draftSettings(), id);
      setApiKeys(await listApiKeys(draftSettings()));
    } catch (e) {
      setApiKeyStatus(e instanceof Error ? e.message : String(e));
    }
  };

  if (!open) return null;

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <h2>설정</h2>
        <label>
          API 주소
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="http://localhost:3000"
          />
        </label>
        <label>
          API 키
          <input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            type="password"
          />
        </label>
        <section className="settings-section">
          <h3>JWT</h3>
          <p className="hint">
            API 키로 access/refresh 토큰을 발급합니다. API 호출 시 access
            token이 우선 사용됩니다.
          </p>
          {accessToken && (
            <p className="muted">access token: {accessToken.slice(0, 12)}…</p>
          )}
          {jwtStatus && (
            <p className={jwtStatus.startsWith("JWT") ? "hint" : "error-text"}>
              {jwtStatus}
            </p>
          )}
          <button
            type="button"
            className="btn-primary"
            disabled={jwtLoading || !key.trim()}
            onClick={() => void handleFetchJwt()}
          >
            {jwtLoading ? "발급 중…" : "JWT 발급"}
          </button>
        </section>
        <section className="settings-section">
          <h3>API 키 관리</h3>
          <p className="hint">
            서버에 등록된 API 키를 조회·생성·삭제합니다.
          </p>
          {apiKeysLoading && <p className="muted">불러오는 중…</p>}
          {apiKeyStatus && (
            <p className={apiKeyStatus.includes("생성") ? "hint" : "error-text"}>
              {apiKeyStatus}
            </p>
          )}
          {newKeyPlain && (
            <p className="hint">
              새 키: <code>{newKeyPlain}</code>
            </p>
          )}
          <ul className="list api-key-list">
            {apiKeys.map((k) => (
              <li key={k.id} className="api-key-row">
                <span className="mono">{k.id.slice(0, 8)}…</span>
                <span className="muted">{k.scopes.split(",").length} scopes</span>
                <button
                  type="button"
                  className="btn-icon danger"
                  title="삭제"
                  onClick={() => void handleDeleteApiKey(k.id)}
                >
                  ×
                </button>
              </li>
            ))}
            {apiKeys.length === 0 && !apiKeysLoading && (
              <li className="muted">등록된 키 없음</li>
            )}
          </ul>
          <button
            type="button"
            className="btn-primary"
            disabled={apiKeysLoading || !key.trim()}
            onClick={() => void handleCreateApiKey()}
          >
            API 키 생성
          </button>
        </section>
        <ChannelLinksSection settings={draftSettings()} />
        <div className="drawer-actions">
          <button type="button" onClick={onClose}>
            닫기
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              onSave(draftSettings());
              onClose();
            }}
          >
            저장
          </button>
        </div>
      </div>
    </div>
  );
}

interface RunningPanelProps {
  open: boolean;
  sessions: RunningSessionInfo[];
  onClose: () => void;
  onSelect: (projectId: string, sessionId: string) => void;
}

export function RunningPanel({
  open,
  sessions,
  onClose,
  onSelect,
}: RunningPanelProps) {
  if (!open) return null;

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer running-panel" onClick={(e) => e.stopPropagation()}>
        <h2>실행 중 ({sessions.length})</h2>
        {sessions.length === 0 ? (
          <p className="muted">현재 실행 중인 세션이 없습니다.</p>
        ) : (
          <ul className="running-session-list">
            {sessions.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  className="list-item"
                  onClick={() => onSelect(s.projectId, s.id)}
                >
                  <span className="running-status">{s.status}</span>
                  <strong>{s.projectName}</strong>
                  <span className="muted">{s.title ?? s.id.slice(0, 8)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="drawer-actions">
          <button type="button" onClick={onClose}>
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
