import type {
  EventEnvelope,
  FileContent,
  ProjectGitStatus,
  SearchMatch,
  TreeNode,
} from "@app/shared";
import {
  ClientApiError,
  createApiFetch,
  parseJsonResponse,
  projectFilePath,
  projectGitPath,
  projectSearchPath,
  projectTreePath,
  throwClientApiError,
} from "@app/shared";
import type { MobileSettings } from "../config";

export { ClientApiError as ApiError };

export const MOBILE_CHANNEL_HEADER = { "X-Channel-Source": "mobile" };

export interface Project {
  id: string;
  name: string;
  status: string;
  sessions?: Session[];
}

export interface Session {
  id: string;
  projectId: string;
  title: string | null;
  model: string;
  status: string;
  summary?: string | null;
}

export interface Message {
  id: string;
  role: string;
  content: string;
  runId: string | null;
  createdAt: string;
  attachmentsJson?: string | null;
}

function authHeaders(settings: MobileSettings): HeadersInit {
  return {
    Authorization: `Bearer ${settings.apiKey}`,
    "Content-Type": "application/json",
    ...MOBILE_CHANNEL_HEADER,
  };
}

function authHeadersBearer(settings: MobileSettings): HeadersInit {
  return {
    Authorization: `Bearer ${settings.apiKey}`,
    ...MOBILE_CHANNEL_HEADER,
  };
}

const apiFetch = createApiFetch<MobileSettings>({
  buildHeaders: (settings, init) =>
    init?.body instanceof FormData
      ? authHeadersBearer(settings)
      : authHeaders(settings),
});

async function parseResponse<T>(res: Response): Promise<T> {
  return parseJsonResponse(res, throwClientApiError);
}

export async function checkHealth(settings: MobileSettings): Promise<boolean> {
  const res = await fetch(`${settings.apiBaseUrl}/health`);
  return res.ok;
}

/** 설정 저장 시 API Key·scope 검증 */
export async function verifyApiAccess(settings: MobileSettings): Promise<void> {
  await listProjects(settings);
}

export async function listProjects(settings: MobileSettings): Promise<Project[]> {
  const url = new URL(`${settings.apiBaseUrl}/api/v1/projects`);
  url.searchParams.set("status", "active");
  const res = await apiFetch(settings, url.toString());
  const data = await parseResponse<{ projects: Project[] }>(res);
  return data.projects;
}

export async function createProject(
  settings: MobileSettings,
  name: string,
): Promise<{ projectId: string; name: string }> {
  const res = await apiFetch(settings, `${settings.apiBaseUrl}/api/v1/projects`, {
    method: "POST",
    headers: authHeaders(settings),
    body: JSON.stringify({ name }),
  });
  return parseResponse(res);
}

export async function getProject(
  settings: MobileSettings,
  projectId: string,
): Promise<Project> {
  const res = await apiFetch(settings, `${settings.apiBaseUrl}/api/v1/projects/${projectId}`);
  return parseResponse(res);
}

export async function createSession(
  settings: MobileSettings,
  projectId: string,
  title?: string,
): Promise<{ sessionId: string }> {
  const res = await apiFetch(settings, 
    `${settings.apiBaseUrl}/api/v1/projects/${projectId}/sessions`,
    {
      method: "POST",
      headers: authHeaders(settings),
      body: JSON.stringify({ title, model: "composer-2.5" }),
    },
  );
  return parseResponse(res);
}

export async function listMessages(
  settings: MobileSettings,
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

export async function sendPrompt(
  settings: MobileSettings,
  sessionId: string,
  text: string,
  attachments?: PromptAttachment[],
): Promise<{ runId: string; queued: boolean }> {
  const res = await apiFetch(settings, 
    `${settings.apiBaseUrl}/api/v1/sessions/${sessionId}/messages`,
    {
      method: "POST",
      headers: authHeaders(settings),
      body: JSON.stringify({
        text,
        attachments: attachments?.length ? attachments : undefined,
      }),
    },
  );
  return parseResponse(res);
}

export async function cancelRun(
  settings: MobileSettings,
  runId: string,
): Promise<void> {
  const res = await apiFetch(settings, `${settings.apiBaseUrl}/api/v1/runs/${runId}/cancel`, {
    method: "POST",
    headers: authHeaders(settings),
    body: "{}",
  });
  await parseResponse(res);
}

export async function resolveApproval(
  settings: MobileSettings,
  approvalId: string,
  decision: "approve" | "reject",
): Promise<void> {
  const res = await apiFetch(settings, `${settings.apiBaseUrl}/api/v1/approvals/resolve`, {
    method: "POST",
    headers: authHeaders(settings),
    body: JSON.stringify({ approvalId, decision }),
  });
  await parseResponse(res);
}

export async function fetchWsToken(
  settings: MobileSettings,
): Promise<{ token: string; expiresAt: string }> {
  const res = await apiFetch(settings, `${settings.apiBaseUrl}/api/v1/ws-token`, {
    method: "POST",
    headers: authHeaders(settings),
  });
  return parseResponse(res);
}

export async function replayEvents(
  settings: MobileSettings,
  sessionId: string,
  cursor: number,
): Promise<EventEnvelope[]> {
  const url = new URL(`${settings.apiBaseUrl}/api/v1/events/replay`);
  url.searchParams.set("scope", "session");
  url.searchParams.set("scopeId", sessionId);
  url.searchParams.set("cursor", String(cursor));
  const res = await apiFetch(settings, url.toString());
  const data = await parseResponse<{ events: EventEnvelope[] }>(res);
  return data.events;
}

/** Expo Push 토큰을 서버에 등록 (UR-06 mobile 3차) */
export async function subscribeExpoPush(
  settings: MobileSettings,
  token: string,
): Promise<void> {
  const res = await apiFetch(settings, `${settings.apiBaseUrl}/api/v1/push/expo-subscribe`, {
    method: "POST",
    headers: authHeaders(settings),
    body: JSON.stringify({ token }),
  });
  await parseResponse(res);
}

export async function unsubscribeExpoPush(
  settings: MobileSettings,
  token: string,
): Promise<void> {
  const res = await apiFetch(settings, `${settings.apiBaseUrl}/api/v1/push/expo-unsubscribe`, {
    method: "POST",
    headers: authHeaders(settings),
    body: JSON.stringify({ token }),
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
  settings: MobileSettings,
  unreadOnly = false,
): Promise<InboxItem[]> {
  const url = new URL(`${settings.apiBaseUrl}/api/v1/inbox`);
  if (unreadOnly) url.searchParams.set("unreadOnly", "true");
  const res = await apiFetch(settings, url.toString());
  const data = await parseResponse<{ items: InboxItem[] }>(res);
  return data.items;
}

export async function markInboxRead(
  settings: MobileSettings,
  id: string,
): Promise<void> {
  const res = await apiFetch(settings, `${settings.apiBaseUrl}/api/v1/inbox/${id}`, {
    method: "PATCH",
    headers: authHeaders(settings),
    body: JSON.stringify({ read: true }),
  });
  await parseResponse(res);
}

export async function getSession(
  settings: MobileSettings,
  sessionId: string,
): Promise<Session & { project?: { id: string; name: string } }> {
  const res = await apiFetch(settings, `${settings.apiBaseUrl}/api/v1/sessions/${sessionId}`);
  return parseResponse(res);
}

export async function steerRun(
  settings: MobileSettings,
  runId: string,
  text: string,
): Promise<{ runId: string; sessionId: string; queued?: boolean }> {
  const res = await apiFetch(settings, `${settings.apiBaseUrl}/api/v1/runs/${runId}/steer`, {
    method: "POST",
    headers: authHeaders(settings),
    body: JSON.stringify({ text }),
  });
  return parseResponse(res);
}

export interface UsageSummary {
  total: number;
  since: string;
  byKind: Record<string, number>;
  limit?: number;
  warning?: boolean;
  remaining?: number;
}

export async function getUsage(
  settings: MobileSettings,
  range: "day" | "month" = "day",
  projectId?: string,
): Promise<UsageSummary> {
  const url = new URL(`${settings.apiBaseUrl}/api/v1/usage`);
  url.searchParams.set("range", range);
  if (projectId) url.searchParams.set("projectId", projectId);
  const res = await apiFetch(settings, url.toString());
  return parseResponse(res);
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
  settings: MobileSettings,
  projectId: string,
): Promise<ProjectGitStatus> {
  const res = await apiFetch(settings, projectGitPath(settings.apiBaseUrl, projectId), {
    headers: authHeaders(settings),
  });
  return parseResponse(res);
}

export async function getProjectDiff(
  settings: MobileSettings,
  projectId: string,
): Promise<ProjectDiff> {
  const res = await apiFetch(settings, 
    `${settings.apiBaseUrl}/api/v1/projects/${projectId}/diff`,
    { headers: authHeaders(settings) },
  );
  return parseResponse(res);
}

export async function commitProjectChanges(
  settings: MobileSettings,
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
  settings: MobileSettings,
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
  settings: MobileSettings,
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
  settings: MobileSettings,
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

export interface PromptAttachment {
  kind: "image" | "file" | "file_ref";
  ref: string;
  mime?: string;
}

export async function uploadAttachmentBase64(
  settings: MobileSettings,
  projectId: string,
  dataBase64: string,
  mime?: string,
): Promise<{ ref: string; mime?: string; size: number }> {
  const res = await apiFetch(settings, 
    `${settings.apiBaseUrl}/api/v1/projects/${projectId}/attachments`,
    {
      method: "POST",
      headers: authHeaders(settings),
      body: JSON.stringify({ dataBase64, mime }),
    },
  );
  return parseResponse(res);
}

export async function transcribeAudio(
  settings: MobileSettings,
  fileUri: string,
  mime = "audio/m4a",
): Promise<{ transcript: string }> {
  const form = new FormData();
  form.append(
    "file",
    { uri: fileUri, type: mime, name: "audio.m4a" } as unknown as Blob,
  );
  const res = await apiFetch(settings, `${settings.apiBaseUrl}/api/v1/stt/transcribe`, {
    method: "POST",
    headers: authHeadersBearer(settings),
    body: form,
  });
  return parseResponse(res);
}

export async function issuePreview(
  settings: MobileSettings,
  projectId: string,
  port: number,
): Promise<{ token: string; previewPath: string }> {
  const res = await apiFetch(settings, 
    `${settings.apiBaseUrl}/api/v1/projects/${projectId}/preview`,
    {
      method: "POST",
      headers: authHeaders(settings),
      body: JSON.stringify({ port }),
    },
  );
  return parseResponse(res);
}

/** 첨부 파일 로컬 캐시 URI (Image source용, UR-15 8차) */
export async function fetchAttachmentFileUri(
  settings: MobileSettings,
  projectId: string,
  ref: string,
): Promise<string> {
  const { downloadAsync, cacheDirectory } = await import("expo-file-system");
  const url = `${settings.apiBaseUrl}/api/v1/projects/${projectId}/attachments/${encodeURIComponent(ref)}`;
  const dest = `${cacheDirectory}att-${ref.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 32)}`;
  const result = await downloadAsync(url, dest, {
    headers: {
      Authorization: `Bearer ${settings.apiKey}`,
      ...MOBILE_CHANNEL_HEADER,
    },
  });
  if (result.status !== 200) {
    throw ClientApiError.adhoc(
      `Attachment fetch failed (${result.status})`,
      result.status,
      "attachment_fetch_failed",
    );
  }
  return result.uri;
}

export type { TreeNode, FileContent, SearchMatch };

export async function getProjectTree(
  settings: MobileSettings,
  projectId: string,
): Promise<TreeNode> {
  const res = await apiFetch(settings, projectTreePath(settings.apiBaseUrl, projectId), {
    headers: authHeaders(settings),
  });
  const data = await parseResponse<{ tree: TreeNode }>(res);
  return data.tree;
}

export async function getProjectFile(
  settings: MobileSettings,
  projectId: string,
  filePath: string,
): Promise<FileContent> {
  const url = new URL(projectFilePath(settings.apiBaseUrl, projectId));
  url.searchParams.set("path", filePath);
  const res = await apiFetch(settings, url.toString());
  return parseResponse(res);
}

export async function saveProjectFile(
  settings: MobileSettings,
  projectId: string,
  filePath: string,
  content: string,
): Promise<{ path: string; bytes: number }> {
  const res = await apiFetch(settings, projectFilePath(settings.apiBaseUrl, projectId), {
    method: "PUT",
    headers: authHeaders(settings),
    body: JSON.stringify({ path: filePath, content }),
  });
  return parseResponse(res);
}

export async function searchProject(
  settings: MobileSettings,
  projectId: string,
  query: string,
): Promise<SearchMatch[]> {
  const res = await apiFetch(settings, 
    projectSearchPath(settings.apiBaseUrl, projectId, query),
    { headers: authHeaders(settings) },
  );
  const data = await parseResponse<{ matches: SearchMatch[] }>(res);
  return data.matches;
}

export async function createProjectFile(
  settings: MobileSettings,
  projectId: string,
  filePath: string,
  content = "",
): Promise<{ path: string; bytes: number }> {
  const res = await apiFetch(settings, projectFilePath(settings.apiBaseUrl, projectId), {
    method: "POST",
    headers: authHeaders(settings),
    body: JSON.stringify({ path: filePath, kind: "file", content }),
  });
  return parseResponse(res);
}

export async function createProjectDir(
  settings: MobileSettings,
  projectId: string,
  dirPath: string,
): Promise<{ path: string }> {
  const res = await apiFetch(settings, projectFilePath(settings.apiBaseUrl, projectId), {
    method: "POST",
    headers: authHeaders(settings),
    body: JSON.stringify({ path: dirPath, kind: "dir" }),
  });
  return parseResponse(res);
}

export async function deleteProjectFile(
  settings: MobileSettings,
  projectId: string,
  filePath: string,
): Promise<{ path: string }> {
  const url = new URL(projectFilePath(settings.apiBaseUrl, projectId));
  url.searchParams.set("path", filePath);
  const res = await apiFetch(settings, url.toString(), {
    method: "DELETE",
    headers: authHeaders(settings),
  });
  return parseResponse(res);
}

export async function renameProjectFile(
  settings: MobileSettings,
  projectId: string,
  from: string,
  to: string,
): Promise<{ from: string; to: string }> {
  const res = await apiFetch(settings, projectFilePath(settings.apiBaseUrl, projectId), {
    method: "PATCH",
    headers: authHeaders(settings),
    body: JSON.stringify({ from, to }),
  });
  return parseResponse(res);
}
