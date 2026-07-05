import { describe, expect, it, vi } from "vitest";
import {
  listProjects,
  sendPrompt,
  MOBILE_CHANNEL_HEADER,
  verifyApiAccess,
  ApiError,
} from "./client";
import type { MobileSettings } from "../config";

const settings: MobileSettings = {
  apiBaseUrl: "http://test.local",
  apiKey: "test-key",
};

describe("mobile api client (P7 2차)", () => {
  it("listProjects sends Bearer auth and X-Channel-Source mobile", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ projects: [{ id: "p1", name: "demo", status: "active" }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const projects = await listProjects(settings);
    expect(projects).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://test.local/api/v1/projects?status=active",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer test-key",
          ...MOBILE_CHANNEL_HEADER,
        }),
      }),
    );

    vi.unstubAllGlobals();
  });

  it("verifyApiAccess calls listProjects", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ projects: [] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await verifyApiAccess(settings);
    expect(fetchMock).toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("sendPrompt posts text to session messages", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ runId: "run-1", queued: true }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendPrompt(settings, "sess-1", "hello mobile");
    expect(result.runId).toBe("run-1");

    vi.unstubAllGlobals();
  });

  it("listInbox fetches inbox items", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        items: [
          {
            id: "n1",
            kind: "run_done",
            title: "done",
            summary: "ok",
            deeplink: "/project/p1/session/s1",
            priority: 50,
            read: false,
            groupCount: 1,
            createdAt: "2026-01-01T00:00:00Z",
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { listInbox } = await import("./client");
    const items = await listInbox(settings);
    expect(items).toHaveLength(1);
    expect(items[0]!.deeplink).toContain("/session/s1");

    vi.unstubAllGlobals();
  });

  it("steerRun posts to runs steer endpoint", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ runId: "r1", sessionId: "s1", queued: true }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { steerRun } = await import("./client");
    await steerRun(settings, "run-1", "adjust plan");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://test.local/api/v1/runs/run-1/steer",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ text: "adjust plan" }),
      }),
    );

    vi.unstubAllGlobals();
  });

  it("getUsage fetches usage summary", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ total: 5, since: "2026-01-01", byKind: { prompt: 5 } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { getUsage } = await import("./client");
    const u = await getUsage(settings, "day");
    expect(u.total).toBe(5);

    vi.unstubAllGlobals();
  });

  it("getUsage passes projectId query", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ total: 2, since: "2026-01-01", byKind: {} }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { getUsage } = await import("./client");
    await getUsage(settings, "month", "proj-1");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://test.local/api/v1/usage?range=month&projectId=proj-1",
      expect.any(Object),
    );

    vi.unstubAllGlobals();
  });

  it("getProjectDiff fetches project diff", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ changes: [], files: [] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { getProjectDiff } = await import("./client");
    await getProjectDiff(settings, "p1");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://test.local/api/v1/projects/p1/diff",
      expect.any(Object),
    );

    vi.unstubAllGlobals();
  });

  it("commitProjectChanges posts paths", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ commitHash: "abc" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { commitProjectChanges } = await import("./client");
    await commitProjectChanges(settings, "p1", "msg", ["a.ts"]);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://test.local/api/v1/projects/p1/commit",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ message: "msg", paths: ["a.ts"] }),
      }),
    );

    vi.unstubAllGlobals();
  });

  it("pushProject posts to push endpoint", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ remote: "origin", branch: "main" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { pushProject } = await import("./client");
    const r = await pushProject(settings, "p1");
    expect(r.branch).toBe("main");

    vi.unstubAllGlobals();
  });

  it("createProjectPullRequest posts pr", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ url: "https://gh/pr/1", number: 1 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { createProjectPullRequest } = await import("./client");
    const pr = await createProjectPullRequest(settings, "p1", "title");
    expect(pr.number).toBe(1);

    vi.unstubAllGlobals();
  });

  it("rollbackProject posts runId", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ snapshotRef: "snap-1", restored: true }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { rollbackProject } = await import("./client");
    await rollbackProject(settings, "p1", { runId: "run-1" });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://test.local/api/v1/projects/p1/rollback",
      expect.objectContaining({
        body: JSON.stringify({ runId: "run-1" }),
      }),
    );

    vi.unstubAllGlobals();
  });

  it("uploadAttachmentBase64 posts base64 payload", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ ref: "ref-1", size: 10, mime: "image/png" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { uploadAttachmentBase64 } = await import("./client");
    await uploadAttachmentBase64(settings, "p1", "abc123", "image/png");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://test.local/api/v1/projects/p1/attachments",
      expect.objectContaining({
        body: JSON.stringify({ dataBase64: "abc123", mime: "image/png" }),
      }),
    );

    vi.unstubAllGlobals();
  });

  it("issuePreview posts port", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ token: "t1", previewPath: "/api/v1/preview/t1/" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { issuePreview } = await import("./client");
    const r = await issuePreview(settings, "p1", 5173);
    expect(r.previewPath).toContain("t1");

    vi.unstubAllGlobals();
  });

  it("sendPrompt includes attachments when provided", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ runId: "run-1", queued: true }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { sendPrompt } = await import("./client");
    await sendPrompt(settings, "sess-1", "hi", [
      { kind: "image", ref: "ref-1", mime: "image/png" },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({
          text: "hi",
          attachments: [{ kind: "image", ref: "ref-1", mime: "image/png" }],
        }),
      }),
    );

    vi.unstubAllGlobals();
  });

  it("transcribeAudio posts multipart to stt endpoint", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ transcript: "hello voice" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { transcribeAudio } = await import("./client");
    const r = await transcribeAudio(settings, "file:///tmp/audio.m4a");
    expect(r.transcript).toBe("hello voice");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://test.local/api/v1/stt/transcribe",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-key",
          ...MOBILE_CHANNEL_HEADER,
        }),
      }),
    );

    vi.unstubAllGlobals();
  });

  it("fetchAttachmentFileUri downloads with auth header", async () => {
    const downloadAsync = vi.fn(async () => ({
      status: 200,
      uri: "file:///cache/att-ref-1",
    }));
    vi.doMock("expo-file-system", () => ({
      downloadAsync,
      cacheDirectory: "file:///cache/",
    }));

    const { fetchAttachmentFileUri } = await import("./client");
    const uri = await fetchAttachmentFileUri(settings, "p1", "ref-1");
    expect(uri).toBe("file:///cache/att-ref-1");
    expect(downloadAsync).toHaveBeenCalledWith(
      "http://test.local/api/v1/projects/p1/attachments/ref-1",
      expect.stringContaining("file:///cache/att-ref-1"),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer test-key",
          ...MOBILE_CHANNEL_HEADER,
        }),
      }),
    );

    vi.doUnmock("expo-file-system");
    vi.unstubAllGlobals();
  });

  it("getProjectTree fetches project file tree", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        tree: {
          name: "",
          path: "",
          type: "dir",
          children: [{ name: "README.md", path: "README.md", type: "file" }],
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { getProjectTree } = await import("./client");
    const tree = await getProjectTree(settings, "p1");
    expect(tree.children).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://test.local/api/v1/projects/p1/tree",
      expect.any(Object),
    );

    vi.unstubAllGlobals();
  });

  it("getProjectFile fetches file by path", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        path: "a.ts",
        language: "typescript",
        encoding: "utf-8",
        content: "export {}",
        truncated: false,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { getProjectFile } = await import("./client");
    const f = await getProjectFile(settings, "p1", "a.ts");
    expect(f.content).toBe("export {}");
    expect(fetchMock.mock.calls[0]![0]).toContain("/file?path=");

    vi.unstubAllGlobals();
  });

  it("saveProjectFile puts content", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ path: "a.ts", bytes: 10 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { saveProjectFile } = await import("./client");
    await saveProjectFile(settings, "p1", "a.ts", "hello");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/file"),
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ path: "a.ts", content: "hello" }),
      }),
    );

    vi.unstubAllGlobals();
  });

  it("searchProject queries search endpoint", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        matches: [{ path: "src/a.ts", line: 1, snippet: "foo" }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { searchProject } = await import("./client");
    const hits = await searchProject(settings, "p1", "foo");
    expect(hits).toHaveLength(1);
    expect(fetchMock.mock.calls[0]![0]).toContain("/search?q=foo");

    vi.unstubAllGlobals();
  });

  it("createProjectFile posts new file", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ path: "new.txt", bytes: 0 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { createProjectFile } = await import("./client");
    await createProjectFile(settings, "p1", "new.txt", "hi");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/file"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ path: "new.txt", kind: "file", content: "hi" }),
      }),
    );

    vi.unstubAllGlobals();
  });

  it("deleteProjectFile deletes by path", async () => {
    const fetchMock = vi.fn(async () => Response.json({ path: "a.ts" }));
    vi.stubGlobal("fetch", fetchMock);

    const { deleteProjectFile } = await import("./client");
    await deleteProjectFile(settings, "p1", "a.ts");
    expect(fetchMock.mock.calls[0]![0]).toContain("path=a.ts");
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: "DELETE" });

    vi.unstubAllGlobals();
  });

  it("renameProjectFile patches from/to", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ from: "a.ts", to: "b.ts" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { renameProjectFile } = await import("./client");
    await renameProjectFile(settings, "p1", "a.ts", "b.ts");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/file"),
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ from: "a.ts", to: "b.ts" }),
      }),
    );

    vi.unstubAllGlobals();
  });

  it("getProjectGit fetches git status", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        branch: "main",
        dirty: true,
        changedCount: 2,
        stagedCount: 0,
        unstagedCount: 2,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { getProjectGit } = await import("./client");
    const status = await getProjectGit(settings, "p1");
    expect(status.branch).toBe("main");
    expect(status.dirty).toBe(true);
    expect(fetchMock.mock.calls[0]![0]).toContain("/git");

    vi.unstubAllGlobals();
  });

  it("listProjects throws ApiError (ClientApiError alias) on 403", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          error: {
            code: "quota_exceeded",
            message: "limit reached",
            retryable: false,
          },
        }),
        { status: 403 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(listProjects(settings)).rejects.toSatisfy((e: unknown) => {
      expect(e).toBeInstanceOf(ApiError);
      const err = e as ApiError;
      expect(err.code).toBe("quota_exceeded");
      expect(err.retryable).toBe(false);
      return true;
    });

    vi.unstubAllGlobals();
  });
});
