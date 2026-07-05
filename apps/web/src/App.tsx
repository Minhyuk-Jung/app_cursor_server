import { useCallback, useEffect, useRef, useState } from "react";
import {
  createProject,
  createSession,
  cancelRun,
  getProject,
  getGlobalStatus,
  getUsage,
  listProjects,
  listModels,
  resolveApproval,
  sendPrompt,
  steerRun,
  updateProject,
  uploadAttachment,
  bindSettingsUpdater,
  ApiError,
  type Project,
  type PromptAttachment,
  type RunningSessionInfo,
  type Session,
} from "./api/client.js";
import { UsagePanel } from "./components/UsagePanel.js";
import { InboxPanel } from "./components/InboxPanel.js";
import { loadSettings, saveSettings } from "./config.js";
import {
  ChatPanel,
  SettingsDrawer,
  Sidebar,
  WorkPanel,
  RunningPanel,
} from "./components/Panels.js";
import { FileTreePanel, FileViewerPanel } from "./components/FilePanels.js";
import { GitDiffPanel } from "./components/GitDiffPanel.js";
import { GitStatusPanel } from "./components/GitStatusPanel.js";
import { TerminalPanel } from "./components/TerminalPanel.js";
import { useInbox } from "./hooks/useInbox.js";
import { useSessionStream } from "./hooks/useSessionStream.js";
import "./styles.css";

export default function App() {
  const [settings, setSettings] = useState(loadSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null,
  );
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [treeRefresh, setTreeRefresh] = useState(0);
  const [fileRefresh, setFileRefresh] = useState(0);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [projectView, setProjectView] = useState<
    "files" | "git" | "diff" | "terminal"
  >("files");
  const [globalRunning, setGlobalRunning] = useState(0);
  const [runningSessions, setRunningSessions] = useState<RunningSessionInfo[]>(
    [],
  );
  const [runningPanelOpen, setRunningPanelOpen] = useState(false);
  const [projectStatusFilter, setProjectStatusFilter] = useState<
    "active" | "archived"
  >("active");
  const [usageOpen, setUsageOpen] = useState(false);
  const [usageTotal, setUsageTotal] = useState<number | null>(null);
  const [usageWarning, setUsageWarning] = useState(false);
  const workItemsLenRef = useRef(0);

  const {
    items: inboxItems,
    loading: inboxLoading,
    unreadCount,
    refresh: refreshInbox,
    markItemRead: markInboxItemRead,
    requestPushPermission,
  } = useInbox(settings);

  const {
    uiState,
    connStatus,
    reloadMessages,
    loadOlderMessages,
    hasMoreMessages,
    loadingOlder,
    setUiState,
  } = useSessionStream(settings, selectedSessionId);

  useEffect(() => {
    bindSettingsUpdater((next) => {
      saveSettings(next);
      setSettings(next);
    });
  }, []);

  const refreshProjects = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listProjects(settings, projectStatusFilter);
      setProjects(list);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [settings, projectStatusFilter]);

  const refreshSessions = useCallback(
    async (projectId: string) => {
      try {
        const project = await getProject(settings, projectId);
        setSessions(project.sessions ?? []);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : String(e));
      }
    },
    [settings],
  );

  useEffect(() => {
    void refreshProjects();
  }, [refreshProjects]);

  useEffect(() => {
    void getGlobalStatus(settings)
      .then((s) => {
        setGlobalRunning(s.activeSessions);
        setRunningSessions(s.runningSessions ?? []);
      })
      .catch(() => {});
    void getUsage(settings)
      .then((u) => {
        setUsageTotal(u.total);
        setUsageWarning(Boolean(u.warning));
      })
      .catch(() => {});
    const timer = setInterval(() => {
      void getGlobalStatus(settings)
        .then((s) => {
          setGlobalRunning(s.activeSessions);
          setRunningSessions(s.runningSessions ?? []);
        })
        .catch(() => {});
      void getUsage(settings)
        .then((u) => {
          setUsageTotal(u.total);
          setUsageWarning(Boolean(u.warning));
        })
        .catch(() => {});
    }, 15_000);
    return () => clearInterval(timer);
  }, [settings]);

  useEffect(() => {
    if (selectedProjectId) {
      void refreshSessions(selectedProjectId);
    } else {
      setSessions([]);
      setSelectedFilePath(null);
    }
  }, [selectedProjectId, refreshSessions]);

  useEffect(() => {
    const items = uiState.workItems;
    if (items.length <= workItemsLenRef.current) {
      workItemsLenRef.current = items.length;
      return;
    }
    const newItems = items.slice(workItemsLenRef.current);
    workItemsLenRef.current = items.length;
    if (newItems.some((i) => i.type === "file_change")) {
      setTreeRefresh((n) => n + 1);
      setFileRefresh((n) => n + 1);
      if (
        selectedFilePath &&
        newItems.some(
          (i) => i.type === "file_change" && i.path === selectedFilePath,
        )
      ) {
        setFileRefresh((n) => n + 1);
      }
    }
  }, [uiState.workItems, selectedFilePath]);

  const handleCreateProject = async (name: string, gitUrl?: string) => {
    try {
      const created = await createProject(settings, name, gitUrl);
      await refreshProjects();
      setSelectedProjectId(created.projectId);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  };

  const handleArchiveProject = async (projectId: string) => {
    try {
      await updateProject(settings, projectId, { status: "archived" });
      if (selectedProjectId === projectId) {
        setSelectedProjectId(null);
        setSelectedSessionId(null);
      }
      await refreshProjects();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  };

  const handleRestoreProject = async (projectId: string) => {
    try {
      await updateProject(settings, projectId, { status: "active" });
      await refreshProjects();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  };

  const handleTogglePin = async (projectId: string, pinned: boolean) => {
    try {
      await updateProject(settings, projectId, { pinned });
      await refreshProjects();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  };

  const handleSteer = async (text: string) => {
    if (!uiState.activeRunId) return;
    setSending(true);
    setError(null);
    try {
      await steerRun(settings, uiState.activeRunId, text);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  const handleCreateSession = async () => {
    if (!selectedProjectId) return;
    try {
      const title = prompt("세션 제목 (선택)") ?? undefined;
      let model: string | undefined;
      try {
        const models = await listModels(settings);
        if (models.length > 0) {
          const pick = prompt(
            `모델 ID (기본: ${models[0]!.id})`,
            models[0]!.id,
          );
          if (pick?.trim()) model = pick.trim();
        }
      } catch {
        // models optional
      }
      const created = await createSession(
        settings,
        selectedProjectId,
        title || undefined,
        model,
      );
      await refreshSessions(selectedProjectId);
      setSelectedSessionId(created.sessionId);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  };

  const handleSend = async (text: string, attachments?: PromptAttachment[]) => {
    if (!selectedSessionId) return;
    setSending(true);
    setError(null);
    const displayText = text.trim() || "(첨부)";
    setUiState((s) => ({
      ...s,
      messages: [
        ...s.messages,
        {
          id: `u-${Date.now()}`,
          role: "user",
          content: displayText,
          attachments: attachments?.length ? attachments : undefined,
        },
      ],
    }));
    try {
      await sendPrompt(settings, selectedSessionId, text, attachments);
      await reloadMessages();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
      await reloadMessages();
    } finally {
      setSending(false);
    }
  };

  const handleUploadAttachment = async (file: File): Promise<PromptAttachment> => {
    if (!selectedProjectId) {
      throw new Error("프로젝트를 선택하세요");
    }
    const buf = await file.arrayBuffer();
    const saved = await uploadAttachment(
      settings,
      selectedProjectId,
      buf,
      file.type || undefined,
    );
    const kind = file.type.startsWith("image/") ? "image" : "file";
    return { kind, ref: saved.ref, mime: saved.mime };
  };

  const handleCancel = async () => {
    if (!uiState.activeRunId) return;
    try {
      await cancelRun(settings, uiState.activeRunId);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  };

  const handleApproval = async (
    approvalId: string,
    decision: "approve" | "reject",
  ) => {
    try {
      await resolveApproval(settings, approvalId, decision);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>Cursor Remote Dev</h1>
        <div className="header-actions">
          {usageTotal !== null && (
            <button
              type="button"
              className={`btn-sm badge-usage-btn ${usageWarning ? "warning" : ""}`}
              onClick={() => setUsageOpen(true)}
            >
              오늘 {usageTotal}회{usageWarning ? " ⚠" : ""}
            </button>
          )}
          {globalRunning > 0 && (
            <button
              type="button"
              className="btn-sm badge-running badge-running-btn"
              onClick={() => setRunningPanelOpen(true)}
            >
              {globalRunning} 실행 중
            </button>
          )}
          <button
            type="button"
            className="btn-sm inbox-btn"
            onClick={() => setInboxOpen(true)}
          >
            인박스{unreadCount > 0 ? ` (${unreadCount})` : ""}
          </button>
          <button type="button" className="btn-sm" onClick={() => setSettingsOpen(true)}>
            설정
          </button>
        </div>
      </header>

      {error && (
        <div className="error-banner" role="alert">
          {error}
          <button type="button" onClick={() => setError(null)}>
            ×
          </button>
        </div>
      )}

      <div className="app-body">
        <Sidebar
          projects={projects}
          selectedProjectId={selectedProjectId}
          sessions={sessions}
          selectedSessionId={selectedSessionId}
          onSelectProject={setSelectedProjectId}
          onSelectSession={setSelectedSessionId}
          onCreateProject={handleCreateProject}
          onTogglePin={handleTogglePin}
          onArchiveProject={handleArchiveProject}
          onRestoreProject={handleRestoreProject}
          projectStatusFilter={projectStatusFilter}
          onProjectStatusFilterChange={setProjectStatusFilter}
          onCreateSession={handleCreateSession}
          loading={loading}
        />

        {selectedProjectId ? (
          <div className="ide-layout">
            <FileTreePanel
              settings={settings}
              projectId={selectedProjectId}
              selectedPath={selectedFilePath}
              onSelectFile={(p) => {
                setSelectedFilePath(p);
                setProjectView("files");
              }}
              refreshKey={treeRefresh}
              onTreeChanged={() => setTreeRefresh((n) => n + 1)}
            />
            <div className="project-main">
              <div className="project-tabs">
                <button
                  type="button"
                  className={projectView === "files" ? "active" : ""}
                  onClick={() => setProjectView("files")}
                >
                  파일
                </button>
                <button
                  type="button"
                  className={projectView === "git" ? "active" : ""}
                  onClick={() => setProjectView("git")}
                  data-testid="project-tab-git"
                >
                  Git
                </button>
                <button
                  type="button"
                  className={projectView === "diff" ? "active" : ""}
                  onClick={() => setProjectView("diff")}
                >
                  변경 리뷰
                </button>
                <button
                  type="button"
                  className={projectView === "terminal" ? "active" : ""}
                  onClick={() => setProjectView("terminal")}
                  data-testid="project-tab-terminal"
                >
                  터미널
                </button>
              </div>
              {projectView === "files" ? (
                <FileViewerPanel
                  settings={settings}
                  projectId={selectedProjectId}
                  filePath={selectedFilePath}
                  refreshKey={fileRefresh}
                  onSaved={() => setTreeRefresh((n) => n + 1)}
                />
              ) : projectView === "git" ? (
                <GitStatusPanel
                  settings={settings}
                  projectId={selectedProjectId}
                  refreshKey={fileRefresh}
                  onOpenDiff={() => setProjectView("diff")}
                />
              ) : projectView === "diff" ? (
                <GitDiffPanel
                  settings={settings}
                  projectId={selectedProjectId}
                  activeRunId={uiState.activeRunId}
                  refreshKey={fileRefresh}
                />
              ) : (
                <TerminalPanel
                  settings={settings}
                  projectId={selectedProjectId}
                />
              )}
            </div>
            {selectedSessionId ? (
              <div className="session-panels">
                <ChatPanel
                  messages={uiState.messages}
                  runStatus={uiState.runStatus}
                  activeRunId={uiState.activeRunId}
                  connStatus={connStatus}
                  disabled={sending || !selectedSessionId}
                  settings={settings}
                  projectId={selectedProjectId ?? undefined}
                  hasMoreMessages={hasMoreMessages}
                  loadingOlder={loadingOlder}
                  onLoadOlder={() => void loadOlderMessages()}
                  onSend={handleSend}
                  onSteer={handleSteer}
                  onCancel={handleCancel}
                  onUploadAttachment={
                    selectedProjectId ? handleUploadAttachment : undefined
                  }
                />
                <WorkPanel
                  items={uiState.workItems}
                  pendingApproval={uiState.pendingApproval}
                  onApprove={(id) => void handleApproval(id, "approve")}
                  onReject={(id) => void handleApproval(id, "reject")}
                />
              </div>
            ) : (
              <main className="main-empty session-placeholder">
                <p>세션을 선택하면 채팅·작업현황이 표시됩니다.</p>
              </main>
            )}
          </div>
        ) : (
          <main className="main-empty">
            <p>프로젝트와 세션을 선택하거나 새로 만드세요.</p>
          </main>
        )}
      </div>

      <SettingsDrawer
        open={settingsOpen}
        settings={settings}
        onSave={(next) => {
          saveSettings(next);
          setSettings(next);
        }}
        onClose={() => setSettingsOpen(false)}
      />

      <InboxPanel
        settings={settings}
        open={inboxOpen}
        items={inboxItems}
        loading={inboxLoading}
        onClose={() => setInboxOpen(false)}
        onRefresh={refreshInbox}
        onRequestPush={() => void requestPushPermission()}
        onNavigate={(projectId, opts) => {
          setSelectedProjectId(projectId);
          if (opts?.view === "git") {
            setProjectView("git");
          } else if (opts?.view === "diff") {
            setProjectView("diff");
          } else if (opts?.view === "terminal") {
            setProjectView("terminal");
          }
          if (opts?.sessionId) setSelectedSessionId(opts.sessionId);
        }}
        onItemRead={markInboxItemRead}
      />

      <RunningPanel
        open={runningPanelOpen}
        sessions={runningSessions}
        onClose={() => setRunningPanelOpen(false)}
        onSelect={(projectId, sessionId) => {
          setSelectedProjectId(projectId);
          setSelectedSessionId(sessionId);
          setRunningPanelOpen(false);
        }}
      />

      <UsagePanel
        settings={settings}
        open={usageOpen}
        onClose={() => setUsageOpen(false)}
      />
    </div>
  );
}
