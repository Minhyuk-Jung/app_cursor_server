import type { AppError, EventEnvelope, ProjectGitStatus } from "@app/shared";
import {
  ClientApiError,
  createApiFetch,
  parseDeeplink,
  parseJsonResponse,
  projectGitPath,
  resolveInboxNavigation,
  throwClientApiError,
} from "@app/shared";
import type { AppSettings } from "../config.js";

export { ClientApiError as ApiError, parseDeeplink, resolveInboxNavigation };

function authHeaders(settings: AppSettings): HeadersInit {
  const token = settings.accessToken ?? settings.apiKey;
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

function requestHeaders(
  settings: AppSettings,
  init?: RequestInit,
): HeadersInit {
  const extra = init?.headers ?? {};
  if (init?.body instanceof FormData) {
    const token = settings.accessToken ?? settings.apiKey;
    return { Authorization: `Bearer ${token}`, ...extra };
  }
  return { ...authHeaders(settings), ...extra };
}

let settingsUpdater: ((s: AppSettings) => void) | null = null;

export function bindSettingsUpdater(fn: (s: AppSettings) => void): void {
  settingsUpdater = fn;
}

export async function refreshAuthToken(
  settings: AppSettings,
): Promise<AppSettings> {
  const res = await fetch(`${settings.apiBaseUrl}/api/v1/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: settings.refreshToken }),
  });
  const data = await parseJsonResponse<{
    accessToken: string;
    refreshToken: string;
  }>(res, throwClientApiError);
  return {
    ...settings,
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
  };
}

const apiFetch = createApiFetch<AppSettings>({
  buildHeaders: requestHeaders,
  shouldRetryAuth: (url, res, settings) =>
    res.status === 401 &&
    !!settings.refreshToken &&
    !url.includes("/auth/token") &&
    !url.includes("/auth/refresh"),
  refreshSettings: refreshAuthToken,
  onSettingsRefreshed: (next) => settingsUpdater?.(next),
});

async function parseResponse<T>(res: Response): Promise<T> {
  return parseJsonResponse(res, throwClientApiError);
}

export interface Project {
  id: string;
  name: string;
  status: string;
  pinned: boolean;
  userId: string;
  sessions?: Session[];
}

export interface Session {
  id: string;
  projectId: string;
  title: string | null;
  branch?: string | null;
  model: string;
  status: string;
  agentId: string | null;
  summary?: string | null;
}

export interface Message {
  id: string;
  sessionId: string;
  role: string;
  content: string;
  attachmentsJson?: string | null;
  runId: string | null;
  createdAt: string;
}

export async function listProjects(
  settings: AppSettings,
  status: "active" | "archived" | "all" = "active",
): Promise<Project[]> {
  const url = new URL(`${settings.apiBaseUrl}/api/v1/projects`);
  url.searchParams.set("status", status);
  const res = await apiFetch(settings, url.toString(), {
    headers: authHeaders(settings),
  });
  const data = await parseResponse<{ projects: Project[] }>(res);
  return data.projects;
}

export async function createProject(
  settings: AppSettings,
  name: string,
  gitUrl?: string,
): Promise<{ projectId: string; name: string }> {
  const res = await apiFetch(settings,`${settings.apiBaseUrl}/api/v1/projects`, {
    method: "POST",
    headers: authHeaders(settings),
    body: JSON.stringify({ name, gitUrl }),
  });
  return parseResponse(res);
}

export async function updateProject(
  settings: AppSettings,
  projectId: string,
  patch: { name?: string; pinned?: boolean; status?: string },
): Promise<Project> {
  const res = await apiFetch(settings,`${settings.apiBaseUrl}/api/v1/projects/${projectId}`, {
    method: "PATCH",
    headers: authHeaders(settings),
    body: JSON.stringify(patch),
  });
  return parseResponse(res);
}

export async function getProject(
  settings: AppSettings,
  id: string,
): Promise<Project> {
  const res = await apiFetch(settings,`${settings.apiBaseUrl}/api/v1/projects/${id}`, {
    headers: authHeaders(settings),
  });
  return parseResponse(res);
}

export async function createSession(
  settings: AppSettings,
  projectId: string,
  title?: string,
  model?: string,
): Promise<{ sessionId: string }> {
  const res = await apiFetch(settings,
    `${settings.apiBaseUrl}/api/v1/projects/${projectId}/sessions`,
    {
      method: "POST",
      headers: authHeaders(settings),
      body: JSON.stringify({ title, model }),
    },
  );
  return parseResponse(res);
}

export async function listMessages(
  settings: AppSettings,
  sessionId: string,
  options?: { limit?: number; before?: string },
): Promise<{ messages: Message[]; hasMore: boolean }> {
  const params = new URLSearchParams();
  if (options?.limit !== undefined) params.set("limit", String(options.limit));
  if (options?.before) params.set("before", options.before);
  const qs = params.toString();
  const res = await apiFetch(settings,
    `${settings.apiBaseUrl}/api/v1/sessions/${sessionId}/messages${qs ? `?${qs}` : ""}`,
    { headers: authHeaders(settings) },
  );
  const data = await parseResponse<{ messages: Message[]; hasMore?: boolean }>(
    res,
  );
  return { messages: data.messages, hasMore: data.hasMore ?? false };
}

export async function saveProjectFile(
  settings: AppSettings,
  projectId: string,
  filePath: string,
  content: string,
): Promise<{ path: string; bytes: number }> {
  const res = await apiFetch(settings,
    `${settings.apiBaseUrl}/api/v1/projects/${projectId}/file`,
    {
      method: "PUT",
      headers: authHeaders(settings),
      body: JSON.stringify({ path: filePath, content }),
    },
  );
  return parseResponse(res);
}

export async function createProjectFile(
  settings: AppSettings,
  projectId: string,
  filePath: string,
  content = "",
): Promise<{ path: string; bytes: number }> {
  const res = await apiFetch(settings,
    `${settings.apiBaseUrl}/api/v1/projects/${projectId}/file`,
    {
      method: "POST",
      headers: authHeaders(settings),
      body: JSON.stringify({ path: filePath, kind: "file", content }),
    },
  );
  return parseResponse(res);
}

export async function createProjectDir(
  settings: AppSettings,
  projectId: string,
  dirPath: string,
): Promise<{ path: string }> {
  const res = await apiFetch(settings,
    `${settings.apiBaseUrl}/api/v1/projects/${projectId}/file`,
    {
      method: "POST",
      headers: authHeaders(settings),
      body: JSON.stringify({ path: dirPath, kind: "dir" }),
    },
  );
  return parseResponse(res);
}

export async function deleteProjectFile(
  settings: AppSettings,
  projectId: string,
  filePath: string,
): Promise<{ path: string }> {
  const url = new URL(
    `${settings.apiBaseUrl}/api/v1/projects/${projectId}/file`,
  );
  url.searchParams.set("path", filePath);
  const res = await apiFetch(settings,url, {
    method: "DELETE",
    headers: authHeaders(settings),
  });
  return parseResponse(res);
}

export async function renameProjectFile(
  settings: AppSettings,
  projectId: string,
  from: string,
  to: string,
): Promise<{ from: string; to: string }> {
  const res = await apiFetch(settings,
    `${settings.apiBaseUrl}/api/v1/projects/${projectId}/file`,
    {
      method: "PATCH",
      headers: authHeaders(settings),
      body: JSON.stringify({ from, to }),
    },
  );
  return parseResponse(res);
}

export async function uploadAttachment(
  settings: AppSettings,
  projectId: string,
  data: ArrayBuffer,
  mime?: string,
  filename = "upload",
): Promise<{ ref: string; mime?: string; size: number }> {
  const form = new FormData();
  form.append(
    "file",
    new Blob([data], { type: mime ?? "application/octet-stream" }),
    filename,
  );
  const res = await apiFetch(settings,
    `${settings.apiBaseUrl}/api/v1/projects/${projectId}/attachments`,
    {
      method: "POST",
      body: form,
    },
  );
  return parseResponse(res);
}

export async function fetchAttachmentBlob(
  settings: AppSettings,
  projectId: string,
  ref: string,
): Promise<Blob> {
  const token = settings.accessToken ?? settings.apiKey;
  const res = await apiFetch(settings,
    `${settings.apiBaseUrl}/api/v1/projects/${projectId}/attachments/${encodeURIComponent(ref)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    throw ClientApiError.adhoc(
      `Attachment fetch failed (${res.status})`,
      res.status,
      "fetch_failed",
      res.status >= 500,
    );
  }
  return res.blob();
}

export interface PromptAttachment {
  kind: "image" | "file" | "file_ref";
  ref: string;
  mime?: string;
}

export async function sendPrompt(
  settings: AppSettings,
  sessionId: string,
  text: string,
  attachments?: PromptAttachment[],
): Promise<{ runId: string; queued: boolean }> {
  const res = await apiFetch(settings,
    `${settings.apiBaseUrl}/api/v1/sessions/${sessionId}/messages`,
    {
      method: "POST",
      headers: authHeaders(settings),
      body: JSON.stringify({ text, attachments }),
    },
  );
  return parseResponse(res);
}

export async function cancelRun(
  settings: AppSettings,
  runId: string,
): Promise<void> {
  const res = await apiFetch(settings,`${settings.apiBaseUrl}/api/v1/runs/${runId}/cancel`, {
    method: "POST",
    headers: authHeaders(settings),
    body: "{}",
  });
  await parseResponse(res);
}

export async function replayEvents(
  settings: AppSettings,
  sessionId: string,
  cursor: number,
): Promise<EventEnvelope[]> {
  const url = new URL(`${settings.apiBaseUrl}/api/v1/events/replay`);
  url.searchParams.set("scope", "session");
  url.searchParams.set("scopeId", sessionId);
  url.searchParams.set("cursor", String(cursor));
  const res = await apiFetch(settings,url, { headers: authHeaders(settings) });
  const data = await parseResponse<{ events: EventEnvelope[] }>(res);
  return data.events;
}

export async function fetchWsToken(
  settings: AppSettings,
): Promise<{ token: string; expiresAt: string }> {
  const res = await apiFetch(settings,`${settings.apiBaseUrl}/api/v1/ws-token`, {
    method: "POST",
    headers: authHeaders(settings),
  });
  return parseResponse(res);
}

export async function listModels(
  settings: AppSettings,
): Promise<Array<{ id: string; name?: string }>> {
  const res = await apiFetch(settings,`${settings.apiBaseUrl}/api/v1/models`, {
    headers: authHeaders(settings),
  });
  const data = await parseResponse<{ models: Array<{ id: string; name?: string }> }>(
    res,
  );
  return data.models;
}

export async function resolveApproval(
  settings: AppSettings,
  approvalId: string,
  decision: "approve" | "reject",
): Promise<void> {
  const res = await apiFetch(settings,`${settings.apiBaseUrl}/api/v1/approvals/resolve`, {
    method: "POST",
    headers: authHeaders(settings),
    body: JSON.stringify({ approvalId, decision }),
  });
  await parseResponse(res);
}

export interface InboxItem {
  id: string;
  kind: string;
  title: string;
  summary: string;
  deeplink: string;
  priority: number;
  read: boolean;
  groupCount: number;
  projectId?: string | null;
  sessionId?: string | null;
  runId?: string | null;
  createdAt: string;
}

export async function listInbox(
  settings: AppSettings,
  unreadOnly = false,
): Promise<InboxItem[]> {
  const url = new URL(`${settings.apiBaseUrl}/api/v1/inbox`);
  if (unreadOnly) url.searchParams.set("unreadOnly", "true");
  const res = await apiFetch(settings,url, { headers: authHeaders(settings) });
  const data = await parseResponse<{ items: InboxItem[] }>(res);
  return data.items;
}

export async function markInboxRead(
  settings: AppSettings,
  id: string,
): Promise<void> {
  const res = await apiFetch(settings,`${settings.apiBaseUrl}/api/v1/inbox/${id}`, {
    method: "PATCH",
    headers: authHeaders(settings),
    body: JSON.stringify({ read: true }),
  });
  await parseResponse(res);
}

export interface RunningSessionInfo {
  id: string;
  projectId: string;
  projectName: string;
  title: string | null;
  status: string;
}

export interface GlobalStatus {
  projects: Project[];
  scheduler: { running: number; queued: number };
  activeSessions: number;
  runningSessions?: RunningSessionInfo[];
}

export async function getGlobalStatus(
  settings: AppSettings,
): Promise<GlobalStatus> {
  const url = new URL(`${settings.apiBaseUrl}/api/v1/status`);
  url.searchParams.set("scope", "all");
  const res = await apiFetch(settings,url, { headers: authHeaders(settings) });
  return parseResponse(res);
}

export async function fetchVapidPublicKey(
  settings: AppSettings,
): Promise<string | null> {
  try {
    const res = await apiFetch(settings,`${settings.apiBaseUrl}/api/v1/push/vapid-public-key`, {
      headers: authHeaders(settings),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { publicKey: string };
    return data.publicKey;
  } catch {
    return null;
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export async function subscribeWebPush(settings: AppSettings): Promise<boolean> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return false;
  }
  const publicKey = await fetchVapidPublicKey(settings);
  if (!publicKey) return false;

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
    });
  }

  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return false;

  const res = await apiFetch(settings,`${settings.apiBaseUrl}/api/v1/push/subscribe`, {
    method: "POST",
    headers: authHeaders(settings),
    body: JSON.stringify({
      endpoint: json.endpoint,
      keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    }),
  });
  return res.ok;
}

export interface UsageSummary {
  total: number;
  since: string;
  byKind: Record<string, number>;
  limit?: number;
  warning?: boolean;
  remaining?: number;
}

export interface GitChangeItem {
  path: string;
  changeKind: "added" | "modified" | "deleted" | "renamed";
  staged: boolean;
  oldPath?: string;
}

export interface GitDiffFile {
  path: string;
  hunks: string;
}

export interface ProjectDiff {
  changes: GitChangeItem[];
  files: GitDiffFile[];
  conflicts?: string[];
}

export type { ProjectGitStatus };

export async function getProjectGit(
  settings: AppSettings,
  projectId: string,
): Promise<ProjectGitStatus> {
  const res = await apiFetch(settings, projectGitPath(settings.apiBaseUrl, projectId), {
    headers: authHeaders(settings),
  });
  return parseResponse(res);
}

export async function getProjectDiff(
  settings: AppSettings,
  projectId: string,
  paths?: string[],
): Promise<ProjectDiff> {
  const url = new URL(`${settings.apiBaseUrl}/api/v1/projects/${projectId}/diff`);
  if (paths?.length) url.searchParams.set("paths", paths.join(","));
  const res = await apiFetch(settings,url, { headers: authHeaders(settings) });
  return parseResponse(res);
}

export async function commitProjectChanges(
  settings: AppSettings,
  projectId: string,
  message: string,
  paths: string[],
): Promise<{ commitHash: string }> {
  const res = await apiFetch(settings,
    `${settings.apiBaseUrl}/api/v1/projects/${projectId}/commit`,
    {
      method: "POST",
      headers: authHeaders(settings),
      body: JSON.stringify({ message, paths }),
    },
  );
  return parseResponse(res);
}

export async function pushProject(
  settings: AppSettings,
  projectId: string,
  remote?: string,
  branch?: string,
): Promise<{ remote: string; branch: string }> {
  const res = await apiFetch(settings,
    `${settings.apiBaseUrl}/api/v1/projects/${projectId}/push`,
    {
      method: "POST",
      headers: authHeaders(settings),
      body: JSON.stringify({ remote, branch }),
    },
  );
  return parseResponse(res);
}

export async function createProjectPullRequest(
  settings: AppSettings,
  projectId: string,
  title: string,
  body?: string,
  base?: string,
): Promise<{ url: string; number: number }> {
  const res = await apiFetch(settings,
    `${settings.apiBaseUrl}/api/v1/projects/${projectId}/pr`,
    {
      method: "POST",
      headers: authHeaders(settings),
      body: JSON.stringify({ title, body, base }),
    },
  );
  return parseResponse(res);
}

export async function rollbackProject(
  settings: AppSettings,
  projectId: string,
  input: { snapshotRef?: string; runId?: string },
): Promise<{ snapshotRef: string; restored: boolean }> {
  const res = await apiFetch(settings,
    `${settings.apiBaseUrl}/api/v1/projects/${projectId}/rollback`,
    {
      method: "POST",
      headers: authHeaders(settings),
      body: JSON.stringify(input),
    },
  );
  return parseResponse(res);
}

export async function getUsage(
  settings: AppSettings,
  range: "day" | "month" = "day",
): Promise<UsageSummary> {
  const url = new URL(`${settings.apiBaseUrl}/api/v1/usage`);
  url.searchParams.set("range", range);
  const res = await apiFetch(settings,url, { headers: authHeaders(settings) });
  return parseResponse(res);
}

export async function fetchAuthToken(
  settings: AppSettings,
): Promise<AppSettings> {
  const res = await apiFetch(settings,`${settings.apiBaseUrl}/api/v1/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey: settings.apiKey }),
  });
  const data = await parseJsonResponse<{
    accessToken: string;
    refreshToken: string;
  }>(res, throwClientApiError);
  return {
    ...settings,
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
  };
}

export async function steerRun(
  settings: AppSettings,
  runId: string,
  text: string,
): Promise<{ runId: string; sessionId: string; queued?: boolean }> {
  const res = await apiFetch(settings,`${settings.apiBaseUrl}/api/v1/runs/${runId}/steer`, {
    method: "POST",
    headers: authHeaders(settings),
    body: JSON.stringify({ text }),
  });
  return parseResponse(res);
}

export interface ChannelLink {
  id: string;
  channel: string;
  externalUserId: string;
  createdAt: string;
}

export async function listChannelLinks(
  settings: AppSettings,
): Promise<ChannelLink[]> {
  const res = await apiFetch(settings,`${settings.apiBaseUrl}/api/v1/channel-links`, {
    headers: authHeaders(settings),
  });
  const data = await parseResponse<{ links: ChannelLink[] }>(res);
  return data.links;
}

export async function createChannelLink(
  settings: AppSettings,
  channel: string,
  externalUserId: string,
): Promise<ChannelLink> {
  const res = await apiFetch(settings,`${settings.apiBaseUrl}/api/v1/channel-links`, {
    method: "POST",
    headers: authHeaders(settings),
    body: JSON.stringify({ channel, externalUserId }),
  });
  return parseResponse(res);
}

export async function deleteChannelLink(
  settings: AppSettings,
  id: string,
): Promise<void> {
  const res = await apiFetch(settings,`${settings.apiBaseUrl}/api/v1/channel-links/${id}`, {
    method: "DELETE",
    headers: authHeaders(settings),
  });
  await parseResponse(res);
}

export type { TreeNode, FileContent, SearchMatch } from "./file-types.js";

export async function getProjectTree(
  settings: AppSettings,
  projectId: string,
): Promise<import("./file-types.js").TreeNode> {
  const res = await apiFetch(settings,
    `${settings.apiBaseUrl}/api/v1/projects/${projectId}/tree`,
    { headers: authHeaders(settings) },
  );
  const data = await parseResponse<{ tree: import("./file-types.js").TreeNode }>(
    res,
  );
  return data.tree;
}

export async function getProjectFile(
  settings: AppSettings,
  projectId: string,
  filePath: string,
): Promise<import("./file-types.js").FileContent> {
  const url = new URL(
    `${settings.apiBaseUrl}/api/v1/projects/${projectId}/file`,
  );
  url.searchParams.set("path", filePath);
  const res = await apiFetch(settings,url, { headers: authHeaders(settings) });
  return parseResponse(res);
}

export async function searchProject(
  settings: AppSettings,
  projectId: string,
  query: string,
): Promise<import("./file-types.js").SearchMatch[]> {
  const url = new URL(
    `${settings.apiBaseUrl}/api/v1/projects/${projectId}/search`,
  );
  url.searchParams.set("q", query);
  const res = await apiFetch(settings,url, { headers: authHeaders(settings) });
  const data = await parseResponse<{
    matches: import("./file-types.js").SearchMatch[];
  }>(res);
  return data.matches;
}

export interface ApiKeyRecord {
  id: string;
  scopes: string;
  expiresAt: string | null;
  createdAt: string;
}

export async function listApiKeys(
  settings: AppSettings,
): Promise<ApiKeyRecord[]> {
  const res = await apiFetch(settings, `${settings.apiBaseUrl}/api/v1/api-keys`, {
    headers: authHeaders(settings),
  });
  const data = await parseResponse<{ keys: ApiKeyRecord[] }>(res);
  return data.keys;
}

export async function createApiKey(
  settings: AppSettings,
  opts?: { expiresInDays?: number },
): Promise<{ id: string; apiKey: string; scopes: string[] }> {
  const res = await apiFetch(settings, `${settings.apiBaseUrl}/api/v1/api-keys`, {
    method: "POST",
    headers: authHeaders(settings),
    body: JSON.stringify(opts ?? {}),
  });
  return parseResponse(res);
}

export async function deleteApiKey(
  settings: AppSettings,
  id: string,
): Promise<void> {
  const res = await apiFetch(settings, `${settings.apiBaseUrl}/api/v1/api-keys/${id}`, {
    method: "DELETE",
    headers: authHeaders(settings),
  });
  await parseResponse(res);
}

export { type EventEnvelope };
