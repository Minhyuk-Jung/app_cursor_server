import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createHmac, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createServer, type Server } from "node:http";
import WebSocket, { WebSocketServer } from "ws";
import { createApp, shutdownApp, type AppContext } from "../app.js";
import { prisma, disconnectDb } from "../db/client.js";
import { InMemoryRunEventLog } from "../core/eventlog/in-memory-run-event-log.js";
import { NotificationEngine } from "../core/notification/notification-engine.js";
import { InboxHub } from "../core/notification/inbox-hub.js";

import { TERMINAL_WS_CLOSE } from "@app/shared";

const AUTH = { authorization: "Bearer dev-local-key" };

async function waitForSchedulerIdle(ctx: AppContext, maxMs = 5000): Promise<void> {
  const start = Date.now();
  while (
    ctx.scheduler.getRunningCount() > 0 ||
    ctx.scheduler.getQueueLength() > 0
  ) {
    if (Date.now() - start > maxMs) break;
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe("API integration", () => {
  let ctx: AppContext;

  beforeAll(async () => {
    process.env.DATABASE_URL = "file:./test-integration.db";
    process.env.WORKSPACE_ROOT = "./test-workspaces";
    process.env.JWT_SECRET = "test-integration-jwt-secret";
    ctx = await createApp({ port: 0 });
  });

  beforeEach(async () => {
    await waitForSchedulerIdle(ctx);
    await prisma.message.deleteMany();
    await prisma.runEvent.deleteMany();
    await prisma.run.deleteMany();
    await prisma.session.deleteMany();
    await prisma.project.deleteMany();
    await prisma.idempotencyRecord.deleteMany();
    await prisma.notification.deleteMany();
    await prisma.usageEvent.deleteMany();
    await prisma.webhookSubscription.deleteMany();
    await prisma.pushSubscription.deleteMany();
    await prisma.channelLink.deleteMany();
  });

  afterEach(async () => {
    await waitForSchedulerIdle(ctx);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it("creates project (owner assigned)", async () => {
    const projectRes = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/projects",
      headers: AUTH,
      payload: { name: "test-proj" },
    });
    expect(projectRes.statusCode).toBe(200);
    const body = projectRes.json() as { projectId: string };
    const row = await prisma.project.findUnique({
      where: { id: body.projectId },
    });
    expect(row?.userId).toBe("dev-user");
  });

  it("denies access to other user's project (SEC-02)", async () => {
    const project = await prisma.project.create({
      data: {
        userId: "other-user",
        name: "secret",
        rootPath: "/tmp/x",
        status: "active",
      },
    });

    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/v1/projects/${project.id}`,
      headers: AUTH,
    });
    expect(res.statusCode).toBe(403);
  });

  it("blocks write to archived project", async () => {
    const project = await prisma.project.create({
      data: {
        userId: "dev-user",
        name: "archived-proj",
        rootPath: path.join(process.cwd(), "test-workspaces", "archived-proj"),
        status: "archived",
      },
    });
    await mkdir(project.rootPath, { recursive: true });
    const session = await prisma.session.create({
      data: { projectId: project.id, model: "composer-2.5", status: "idle" },
    });

    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/v1/sessions/${session.id}/messages`,
      headers: AUTH,
      payload: { text: "should fail" },
    });
    expect(res.statusCode).toBe(409);
    const body = res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe("conflict");
    expect(body.error.message).toMatch(/archived/i);
  });

  it("deduplicates same requestId (CH-04)", async () => {
    const requestId = "550e8400-e29b-41d4-a716-446655440099";
    const payload = {
      kind: "create_project",
      source: "web",
      requestId,
      name: "idem-test",
    };

    const first = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/commands",
      headers: AUTH,
      payload,
    });
    const second = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/commands",
      headers: AUTH,
      payload,
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(first.json()).toEqual(second.json());

    const count = await prisma.project.count({
      where: { name: "idem-test" },
    });
    expect(count).toBe(1);
  });

  it("records run_queued via event log (ADR-008)", async () => {
    const project = await prisma.project.create({
      data: {
        userId: "dev-user",
        name: "p",
        rootPath: "/tmp/p",
        status: "active",
      },
    });
    const session = await prisma.session.create({
      data: {
        projectId: project.id,
        model: "composer-2.5",
        status: "idle",
      },
    });

    const log = new InMemoryRunEventLog();
    const events: string[] = [];
    log.onAppend((e) => events.push(e.event.type));

    await log.append({
      runId: "run-1",
      sessionId: session.id,
      projectId: project.id,
      event: { type: "run_queued", runId: "run-1", sessionId: session.id },
    });

    expect(events).toEqual(["run_queued"]);
  });

  it("issues one-time ws token", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/ws-token",
      headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { token: string; expiresAt: string };
    expect(body.token).toBeTruthy();
    expect(body.expiresAt).toBeTruthy();
  });

  it("resolves approval when run is waiting (UR-17)", async () => {
    const project = await prisma.project.create({
      data: {
        userId: "dev-user",
        name: "appr",
        rootPath: "/tmp/appr",
        status: "active",
      },
    });
    const session = await prisma.session.create({
      data: {
        projectId: project.id,
        model: "composer-2.5",
        status: "idle",
      },
    });
    const run = await prisma.run.create({
      data: { sessionId: session.id, status: "queued" },
    });

    await ctx.eventLog.append({
      runId: run.id,
      sessionId: session.id,
      projectId: project.id,
      event: { type: "run_queued", runId: run.id, sessionId: session.id },
    });
    await ctx.eventLog.append({
      runId: run.id,
      sessionId: session.id,
      projectId: project.id,
      event: { type: "run_started", runId: run.id, sessionId: session.id },
    });
    await ctx.eventLog.append({
      runId: run.id,
      sessionId: session.id,
      projectId: project.id,
      event: {
        type: "approval_required",
        runId: run.id,
        approvalId: `${run.id}-approval`,
        detail: "Allow tool?",
      },
    });

    const approveRes = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/approvals/resolve",
      headers: AUTH,
      payload: { approvalId: `${run.id}-approval`, decision: "approve" },
    });
    expect(approveRes.statusCode).toBe(200);

    const updated = await prisma.run.findUnique({ where: { id: run.id } });
    expect(updated?.status).toBe("streaming");
  });

  it("blocks path traversal on file read (SEC-01)", async () => {
    const project = await prisma.project.create({
      data: {
        userId: "dev-user",
        name: "files",
        rootPath: path.join(process.cwd(), "test-workspaces", "sec-file-proj"),
        status: "active",
      },
    });
    await mkdir(project.rootPath, { recursive: true });
    await writeFile(path.join(project.rootPath, "ok.txt"), "safe");

    const ok = await ctx.app.inject({
      method: "GET",
      url: `/api/v1/projects/${project.id}/file?path=ok.txt`,
      headers: AUTH,
    });
    expect(ok.statusCode).toBe(200);

    const bad = await ctx.app.inject({
      method: "GET",
      url: `/api/v1/projects/${project.id}/file?path=${encodeURIComponent("../../../etc/passwd")}`,
      headers: AUTH,
    });
    expect(bad.statusCode).toBe(403);
  });

  it("lists inbox after run_done notification (P4 UR-06)", async () => {
    const project = await prisma.project.create({
      data: {
        userId: "dev-user",
        name: "inbox-proj",
        rootPath: "/tmp/inbox",
        status: "active",
      },
    });
    const session = await prisma.session.create({
      data: { projectId: project.id, model: "composer-2.5", status: "idle" },
    });
    const run = await prisma.run.create({
      data: { sessionId: session.id, status: "running" },
    });

    await ctx.eventLog.append({
      runId: run.id,
      sessionId: session.id,
      projectId: project.id,
      event: { type: "run_done", runId: run.id, status: "finished" },
    });

    await new Promise((r) => setTimeout(r, 50));

    const inboxRes = await ctx.app.inject({
      method: "GET",
      url: "/api/v1/inbox",
      headers: AUTH,
    });
    expect(inboxRes.statusCode).toBe(200);
    const body = inboxRes.json() as {
      items: Array<{ kind: string; read: boolean }>;
    };
    expect(body.items.some((i) => i.kind === "run_done")).toBe(true);
  });

  it("groups run_done notifications in inbox (S10)", async () => {
    const project = await prisma.project.create({
      data: {
        userId: "dev-user",
        name: "inbox-group",
        rootPath: "/tmp/inbox-group",
        status: "active",
      },
    });
    const session = await prisma.session.create({
      data: { projectId: project.id, model: "composer-2.5", status: "idle" },
    });
    const runA = await prisma.run.create({
      data: { sessionId: session.id, status: "running" },
    });
    const runB = await prisma.run.create({
      data: { sessionId: session.id, status: "running" },
    });

    const engine = new NotificationEngine(new InboxHub());
    await engine.handleEnvelope({
      runId: runA.id,
      sessionId: session.id,
      projectId: project.id,
      seq: 1,
      globalOffset: 1,
      event: { type: "run_done", runId: runA.id, status: "finished" },
    });
    await engine.handleEnvelope({
      runId: runB.id,
      sessionId: session.id,
      projectId: project.id,
      seq: 2,
      globalOffset: 2,
      event: { type: "run_done", runId: runB.id, status: "finished" },
    });

    const rows = await prisma.notification.findMany({
      where: { userId: "dev-user", kind: "run_done", projectId: project.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.groupCount).toBe(2);
    expect(rows[0]!.summary).toMatch(/×2/);
  });

  it("emits review_ready when run finishes with git changes (P5 UR-09)", async () => {
    const projectRes = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/projects",
      headers: AUTH,
      payload: { name: "review-ready" },
    });
    const { projectId } = projectRes.json() as { projectId: string };
    const project = await prisma.project.findUnique({
      where: { id: projectId },
    });
    expect(project?.rootPath).toBeTruthy();

    const session = await prisma.session.create({
      data: { projectId, model: "composer-2.5", status: "idle" },
    });
    const run = await prisma.run.create({
      data: { sessionId: session.id, status: "running" },
    });

    await writeFile(
      path.join(project!.rootPath, "review.txt"),
      "needs review",
    );

    await ctx.eventLog.append({
      runId: run.id,
      sessionId: session.id,
      projectId,
      event: { type: "run_done", runId: run.id, status: "finished" },
    });

    await new Promise((r) => setTimeout(r, 100));

    const inboxRes = await ctx.app.inject({
      method: "GET",
      url: "/api/v1/inbox",
      headers: AUTH,
    });
    const body = inboxRes.json() as {
      items: Array<{ kind: string; deeplink: string }>;
    };
    const review = body.items.find((i) => i.kind === "review_ready");
    expect(review).toBeTruthy();
    expect(review?.deeplink).toContain(`/project/${projectId}/diff`);
  });

  it("marks inbox item read", async () => {
    const note = await prisma.notification.create({
      data: {
        userId: "dev-user",
        kind: "info",
        priority: 10,
        title: "Test",
        summary: "hello",
        deeplink: "/",
      },
    });

    const res = await ctx.app.inject({
      method: "PATCH",
      url: `/api/v1/inbox/${note.id}`,
      headers: AUTH,
      payload: { read: true },
    });
    expect(res.statusCode).toBe(200);

    const updated = await prisma.notification.findUnique({
      where: { id: note.id },
    });
    expect(updated?.read).toBe(true);
  });

  it("accepts custom webhook send_prompt (P4 UR-11)", async () => {
    const project = await prisma.project.create({
      data: {
        userId: "dev-user",
        name: "hook-proj",
        rootPath: path.join(process.cwd(), "test-workspaces", "hook-proj"),
        status: "active",
      },
    });
    await mkdir(project.rootPath, { recursive: true });
    const session = await prisma.session.create({
      data: { projectId: project.id, model: "composer-2.5", status: "idle" },
    });

    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/webhooks/custom",
      headers: {
        ...AUTH,
        "x-request-id": "550e8400-e29b-41d4-a716-446655440088",
      },
      payload: {
        sessionId: session.id,
        text: "via webhook",
      },
    });
    expect([200, 202]).toContain(res.statusCode);
    await waitForSchedulerIdle(ctx);
  });

  it("returns usage with warning fields (UR-14)", async () => {
    await prisma.usageEvent.create({
      data: { userId: "dev-user", kind: "send_prompt" },
    });

    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/v1/usage?range=day",
      headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      total: number;
      limit?: number;
      remaining?: number;
    };
    expect(body.limit).toBeDefined();
    expect(body.remaining).toBeDefined();
  });

  it("manages webhook subscriptions", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/subscriptions",
      headers: AUTH,
      payload: {
        channel: "custom",
        targetUrl: "https://example.com/hook",
      },
    });
    expect(createRes.statusCode).toBe(201);

    const listRes = await ctx.app.inject({
      method: "GET",
      url: "/api/v1/subscriptions",
      headers: AUTH,
    });
    const list = listRes.json() as { subscriptions: Array<{ id: string }> };
    expect(list.subscriptions.length).toBeGreaterThanOrEqual(1);
  });

  it("manages channel links and telegram webhook (P4 S29)", async () => {
    const linkRes = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/channel-links",
      headers: AUTH,
      payload: { channel: "telegram", externalUserId: "999001" },
    });
    expect(linkRes.statusCode).toBe(201);

    const rootPath = path.join(process.cwd(), "test-workspaces", "tg-proj");
    await mkdir(rootPath, { recursive: true });
    const project = await prisma.project.create({
      data: {
        userId: "dev-user",
        name: "tg-proj",
        rootPath,
        status: "active",
      },
    });
    const session = await prisma.session.create({
      data: {
        projectId: project.id,
        model: "composer-2.5",
        status: "idle",
      },
    });

    const hookRes = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/webhooks/telegram",
      headers: { "x-telegram-secret": process.env.TELEGRAM_WEBHOOK_SECRET ?? "" },
      payload: {
        message: {
          text: `/dev prompt ${session.id} hello from telegram`,
          chat: { id: 999001 },
        },
      },
    });
    expect([200, 202]).toContain(hookRes.statusCode);
    await waitForSchedulerIdle(ctx);
  });

  it("returns git diff and commits changes (P5 UR-07/08)", async () => {
    const projectRes = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/projects",
      headers: AUTH,
      payload: { name: "git-test" },
    });
    const { projectId } = projectRes.json() as { projectId: string };
    const project = await prisma.project.findUnique({
      where: { id: projectId },
    });
    expect(project?.rootPath).toBeTruthy();

    await writeFile(
      path.join(project!.rootPath, "feature.txt"),
      "git integration",
    );

    const gitRes = await ctx.app.inject({
      method: "GET",
      url: `/api/v1/projects/${projectId}/git`,
      headers: AUTH,
    });
    expect(gitRes.statusCode).toBe(200);
    const gitStatus = gitRes.json() as {
      branch: string;
      dirty: boolean;
      changedCount: number;
      stagedCount: number;
      unstagedCount: number;
      lastCommitMessage: string | null;
      ahead: number | null;
      behind: number | null;
    };
    expect(gitStatus.branch).toBeTruthy();
    expect(gitStatus.dirty).toBe(true);
    expect(gitStatus.changedCount).toBeGreaterThan(0);
    expect(gitStatus.stagedCount).toBe(0);
    expect(gitStatus.unstagedCount).toBeGreaterThan(0);
    expect(gitStatus.lastCommitMessage).toBeTruthy();
    expect(gitStatus.ahead).toBeNull();
    expect(gitStatus.behind).toBeNull();

    const diffRes = await ctx.app.inject({
      method: "GET",
      url: `/api/v1/projects/${projectId}/diff`,
      headers: AUTH,
    });
    expect(diffRes.statusCode).toBe(200);
    const diff = diffRes.json() as {
      changes: Array<{ path: string }>;
    };
    expect(diff.changes.some((c) => c.path === "feature.txt")).toBe(true);

    const commitRes = await ctx.app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/commit`,
      headers: AUTH,
      payload: { message: "feat: add feature", paths: ["feature.txt"] },
    });
    expect(commitRes.statusCode).toBe(200);
  });

  it("returns ahead/behind when upstream is configured (24차 UR-07)", async () => {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const exec = promisify(execFile);

    const projectRes = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/projects",
      headers: AUTH,
      payload: { name: "git-upstream-it" },
    });
    expect(projectRes.statusCode).toBe(200);
    const { projectId } = projectRes.json() as { projectId: string };
    const project = await prisma.project.findUnique({
      where: { id: projectId },
    });
    expect(project?.rootPath).toBeTruthy();
    const root = project!.rootPath;
    const remoteDir = path.join(path.dirname(root), "upstream-remote.git");
    await mkdir(remoteDir, { recursive: true });
    await exec("git", ["init", "--bare", remoteDir]);

    const branchOut = await exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: root,
    });
    const branch = branchOut.stdout.trim();
    await exec("git", ["remote", "add", "origin", remoteDir], { cwd: root });
    await exec("git", ["push", "-u", "origin", branch], { cwd: root });

    const gitRes = await ctx.app.inject({
      method: "GET",
      url: `/api/v1/projects/${projectId}/git`,
      headers: AUTH,
    });
    expect(gitRes.statusCode).toBe(200);
    const gitStatus = gitRes.json() as {
      ahead: number | null;
      behind: number | null;
    };
    expect(gitStatus.ahead).toBe(0);
    expect(gitStatus.behind).toBe(0);
  });

  describe("JWT auth (SR-09, 03 §6.1)", () => {
    it("exchanges api key for JWT and accesses API", async () => {
      const tokenRes = await ctx.app.inject({
        method: "POST",
        url: "/api/v1/auth/token",
        payload: { apiKey: "dev-local-key" },
      });
      expect(tokenRes.statusCode).toBe(200);
      const body = tokenRes.json() as {
        accessToken: string;
        refreshToken: string;
      };
      expect(body.refreshToken).toBeTruthy();

      const projectsRes = await ctx.app.inject({
        method: "GET",
        url: "/api/v1/projects",
        headers: { authorization: `Bearer ${body.accessToken}` },
      });
      expect(projectsRes.statusCode).toBe(200);

      const refreshRes = await ctx.app.inject({
        method: "POST",
        url: "/api/v1/auth/refresh",
        payload: { refreshToken: body.refreshToken },
      });
      expect(refreshRes.statusCode).toBe(200);
      const refreshed = refreshRes.json() as { accessToken: string };
      expect(refreshed.accessToken).toBeTruthy();
    });

    it("rejects invalid JWT", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/v1/projects",
        headers: { authorization: "Bearer invalid.jwt.token" },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("rate limit (02 §11)", () => {
    let rlCtx: AppContext;

    beforeAll(async () => {
      rlCtx = await createApp({
        port: 0,
        jwtSecret: "rl-test-secret",
        authRateLimitMax: 2,
        authRateLimitWindowMs: 60_000,
      });
    });

    afterAll(async () => {
      if (rlCtx) await rlCtx.app.close();
    });

    it("returns 429 when auth token rate limit exceeded", async () => {
      for (let i = 0; i < 2; i++) {
        const res = await rlCtx.app.inject({
          method: "POST",
          url: "/api/v1/auth/token",
          payload: { apiKey: "wrong-key" },
        });
        expect(res.statusCode).toBe(401);
      }

      const blocked = await rlCtx.app.inject({
        method: "POST",
        url: "/api/v1/auth/token",
        payload: { apiKey: "wrong-key" },
      });
      expect(blocked.statusCode).toBe(429);
      const body = blocked.json() as { error: { code: string } };
      expect(body.error.code).toBe("rate_limit_exceeded");
    });
  });

  describe("git push whitelist (P5, 12 §10)", () => {
    let gitCtx: AppContext;

    beforeAll(async () => {
      gitCtx = await createApp({
        port: 0,
        gitRemoteWhitelist: ["github.com/safe-org"],
      });
    });

    afterAll(async () => {
      if (gitCtx) await gitCtx.app.close();
    });

    it("blocks push to non-whitelisted remote", async () => {
      const projectRes = await gitCtx.app.inject({
        method: "POST",
        url: "/api/v1/projects",
        headers: AUTH,
        payload: { name: "push-whitelist-test" },
      });
      const { projectId } = projectRes.json() as { projectId: string };
      const project = await prisma.project.findUnique({
        where: { id: projectId },
      });
      expect(project?.rootPath).toBeTruthy();

      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const exec = promisify(execFile);
      await exec(
        "git",
        ["remote", "add", "origin", "https://evil.com/repo.git"],
        { cwd: project!.rootPath },
      );

      const pushRes = await gitCtx.app.inject({
        method: "POST",
        url: `/api/v1/projects/${projectId}/push`,
        headers: AUTH,
        payload: {},
      });
      expect(pushRes.statusCode).toBe(403);
    });
  });

  describe("git push success (P5)", () => {
    let pushCtx: AppContext;

    beforeAll(async () => {
      pushCtx = await createApp({ port: 0, gitRemoteWhitelist: [] });
    });

    afterAll(async () => {
      if (pushCtx) await pushCtx.app.close();
    });

    it("pushes to allowed bare remote successfully", async () => {
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const { mkdtemp, rm } = await import("node:fs/promises");
      const os = await import("node:os");
      const exec = promisify(execFile);

      const bareDir = await mkdtemp(path.join(os.tmpdir(), "bare-remote-"));
      await exec("git", ["init", "--bare"], { cwd: bareDir });

      const projectRes = await pushCtx.app.inject({
        method: "POST",
        url: "/api/v1/projects",
        headers: AUTH,
        payload: { name: "push-success-test" },
      });
      const { projectId } = projectRes.json() as { projectId: string };
      const project = await prisma.project.findUnique({
        where: { id: projectId },
      });
      expect(project?.rootPath).toBeTruthy();

      await exec(
        "git",
        ["remote", "add", "origin", bareDir.replace(/\\/g, "/")],
        { cwd: project!.rootPath },
      );
      await writeFile(path.join(project!.rootPath, "push-me.txt"), "content");
      await exec("git", ["add", "push-me.txt"], { cwd: project!.rootPath });
      await exec(
        "git",
        ["-c", "user.email=t@local", "-c", "user.name=T", "commit", "-m", "init push"],
        { cwd: project!.rootPath },
      );

      const pushRes = await pushCtx.app.inject({
        method: "POST",
        url: `/api/v1/projects/${projectId}/push`,
        headers: AUTH,
        payload: {},
      });
      expect(pushRes.statusCode).toBe(200);
      const body = pushRes.json() as { remote: string; branch: string };
      expect(body.remote).toBe("origin");
      expect(body.branch).toBeTruthy();

      await rm(bareDir, { recursive: true, force: true });
    });
  });

  describe("SEC-03 webhook signature", () => {
  let securedCtx: AppContext;
  const WEBHOOK_SECRET = "integration-test-webhook-secret";
  const TG_SECRET = "integration-test-tg-secret";

  beforeAll(async () => {
    securedCtx = await createApp({
      webhookSecret: WEBHOOK_SECRET,
      telegramWebhookSecret: TG_SECRET,
    });
  });

  afterAll(async () => {
    if (securedCtx) await securedCtx.app.close();
  });

  it("rejects custom webhook with forged signature", async () => {
    const res = await securedCtx.app.inject({
      method: "POST",
      url: "/api/v1/webhooks/custom",
      headers: {
        ...AUTH,
        "x-signature": "deadbeef",
      },
      payload: { sessionId: "sess-x", text: "hello" },
    });
    expect(res.statusCode).toBe(403);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe("forbidden");
  });

  it("accepts custom webhook with valid HMAC signature", async () => {
    const project = await prisma.project.create({
      data: {
        userId: "dev-user",
        name: "sig-proj",
        rootPath: path.join(process.cwd(), "test-workspaces", "sig-proj"),
        status: "active",
      },
    });
    await mkdir(project.rootPath, { recursive: true });
    const session = await prisma.session.create({
      data: { projectId: project.id, model: "composer-2.5", status: "idle" },
    });

    const payload = { sessionId: session.id, text: "signed" };
    const raw = JSON.stringify(payload);
    const sig = createHmac("sha256", WEBHOOK_SECRET).update(raw).digest("hex");
    const ts = String(Math.floor(Date.now() / 1000));

    const res = await securedCtx.app.inject({
      method: "POST",
      url: "/api/v1/webhooks/custom",
      headers: {
        ...AUTH,
        "x-signature": sig,
        "x-webhook-timestamp": ts,
        "x-request-id": "550e8400-e29b-41d4-a716-446655440077",
      },
      payload,
    });
    expect([200, 202]).toContain(res.statusCode);
    await waitForSchedulerIdle(securedCtx);
  });

  it("rejects custom webhook with missing timestamp when secret set", async () => {
    const res = await securedCtx.app.inject({
      method: "POST",
      url: "/api/v1/webhooks/custom",
      headers: {
        ...AUTH,
        "x-signature": "deadbeef",
      },
      payload: { sessionId: "x", text: "y" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects telegram webhook with invalid secret", async () => {
    const res = await securedCtx.app.inject({
      method: "POST",
      url: "/api/v1/webhooks/telegram",
      headers: { "x-telegram-secret": "wrong-secret" },
      payload: {
        message: { text: "/dev status", chat: { id: 12345 } },
      },
    });
    expect(res.statusCode).toBe(403);
  });
  });

  describe("usage limit gate (UR-14)", () => {
    let limitCtx: AppContext;

    beforeAll(async () => {
      limitCtx = await createApp({ usageDailyLimit: 2 });
    });

    afterAll(async () => {
      if (limitCtx) await limitCtx.app.close();
    });

    beforeEach(async () => {
      await waitForSchedulerIdle(limitCtx);
      await prisma.usageEvent.deleteMany();
      await prisma.run.deleteMany();
      await prisma.session.deleteMany();
      await prisma.project.deleteMany();
    });

    it("returns 429 when daily usage limit exceeded", async () => {
    await prisma.usageEvent.createMany({
      data: [
        { userId: "dev-user", kind: "send_prompt" },
        { userId: "dev-user", kind: "send_prompt" },
      ],
    });

    const project = await prisma.project.create({
      data: {
        userId: "dev-user",
        name: "limit-proj",
        rootPath: path.join(process.cwd(), "test-workspaces", "limit-proj"),
        status: "active",
      },
    });
    await mkdir(project.rootPath, { recursive: true });
    const session = await prisma.session.create({
      data: { projectId: project.id, model: "composer-2.5", status: "idle" },
    });

    const res = await limitCtx.app.inject({
      method: "POST",
      url: `/api/v1/sessions/${session.id}/messages`,
      headers: AUTH,
      payload: { text: "should be blocked" },
    });
    expect(res.statusCode).toBe(429);
    const body = res.json() as { error: { code: string } };
      expect(body.error.code).toBe("quota_exceeded");
    });

    it("creates only one quota_exceeded notification on repeated sends", async () => {
      await prisma.notification.deleteMany();
      await prisma.usageEvent.createMany({
        data: [
          { userId: "dev-user", kind: "send_prompt" },
          { userId: "dev-user", kind: "send_prompt" },
        ],
      });

      const project = await prisma.project.create({
        data: {
          userId: "dev-user",
          name: "quota-dedup",
          rootPath: path.join(process.cwd(), "test-workspaces", "quota-dedup"),
          status: "active",
        },
      });
      await mkdir(project.rootPath, { recursive: true });
      const session = await prisma.session.create({
        data: { projectId: project.id, model: "composer-2.5", status: "idle" },
      });

      await limitCtx.app.inject({
        method: "POST",
        url: `/api/v1/sessions/${session.id}/messages`,
        headers: AUTH,
        payload: { text: "blocked 1" },
      });
      await limitCtx.app.inject({
        method: "POST",
        url: `/api/v1/sessions/${session.id}/messages`,
        headers: AUTH,
        payload: { text: "blocked 2" },
      });

      await new Promise((r) => setTimeout(r, 50));
      const rows = await prisma.notification.findMany({
        where: { userId: "dev-user", kind: "quota_exceeded" },
      });
      expect(rows.length).toBe(1);
    });
  });

  describe("quiet hours inbox vs external push (09 §6.3)", () => {
    let quietCtx: AppContext;
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeAll(async () => {
      fetchMock = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal("fetch", fetchMock);
      quietCtx = await createApp({
        quietHoursStart: 0,
        quietHoursEnd: 24,
      });
    });

    afterAll(async () => {
      vi.unstubAllGlobals();
      if (quietCtx) await quietCtx.app.close();
    });

    beforeEach(async () => {
      fetchMock.mockClear();
      await prisma.notification.deleteMany();
      await prisma.webhookSubscription.deleteMany();
      await prisma.run.deleteMany();
      await prisma.session.deleteMany();
      await prisma.project.deleteMany();
    });

    it("stores run_done in inbox but skips webhook during quiet hours", async () => {
    await prisma.webhookSubscription.create({
      data: {
        userId: "dev-user",
        channel: "custom",
        targetUrl: "https://example.com/hook",
        active: true,
      },
    });

    const project = await prisma.project.create({
      data: {
        userId: "dev-user",
        name: "quiet-proj",
        rootPath: "/tmp/quiet",
        status: "active",
      },
    });
    const session = await prisma.session.create({
      data: { projectId: project.id, model: "composer-2.5", status: "idle" },
    });
    const run = await prisma.run.create({
      data: { sessionId: session.id, status: "running" },
    });

    await quietCtx.eventLog.append({
      runId: run.id,
      sessionId: session.id,
      projectId: project.id,
      event: { type: "run_done", runId: run.id, status: "finished" },
    });

    await new Promise((r) => setTimeout(r, 100));

    const notes = await prisma.notification.findMany({
      where: { userId: "dev-user" },
    });
    expect(notes.length).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("dispatches error webhook during quiet hours (bypass)", async () => {
    await prisma.webhookSubscription.create({
      data: {
        userId: "dev-user",
        channel: "custom",
        targetUrl: "https://example.com/hook",
        active: true,
      },
    });

    const project = await prisma.project.create({
      data: {
        userId: "dev-user",
        name: "quiet-err",
        rootPath: "/tmp/quiet-err",
        status: "active",
      },
    });
    const session = await prisma.session.create({
      data: { projectId: project.id, model: "composer-2.5", status: "idle" },
    });
    const run = await prisma.run.create({
      data: { sessionId: session.id, status: "running" },
    });

    await quietCtx.eventLog.append({
      runId: run.id,
      sessionId: session.id,
      projectId: project.id,
      event: { type: "run_done", runId: run.id, status: "error" },
    });

    await new Promise((r) => setTimeout(r, 100));

    expect(fetchMock).toHaveBeenCalled();
  });

  it("defers run_done push and flushes after quiet hours end", async () => {
    await prisma.webhookSubscription.create({
      data: {
        userId: "dev-user",
        channel: "custom",
        targetUrl: "https://example.com/hook",
        active: true,
      },
    });

    const engine = new NotificationEngine(new InboxHub(), {
      quietHoursStart: 0,
      quietHoursEnd: 24,
    });

    const deferProject = await prisma.project.create({
      data: {
        userId: "dev-user",
        name: "defer-proj",
        rootPath: "/tmp/defer",
        status: "active",
      },
    });

    await engine.handleEnvelope({
      runId: "r-defer",
      sessionId: "s1",
      projectId: deferProject.id,
      seq: 1,
      globalOffset: 1,
      event: { type: "run_done", runId: "r-defer", status: "finished" },
    });

    expect(engine.getDeferredCount()).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();

    // 방해금지 종료 시뮬레이션 후 flush
    (
      engine as unknown as { quietHoursStart?: number; quietHoursEnd?: number }
    ).quietHoursStart = undefined;
    (
      engine as unknown as { quietHoursStart?: number; quietHoursEnd?: number }
    ).quietHoursEnd = undefined;
    await engine.flushDeferred();
    expect(engine.getDeferredCount()).toBe(0);
    expect(fetchMock).toHaveBeenCalled();
  });
});
});

describe("Event log replay (CH-01 pattern)", () => {
  it("replays without gaps then continues live", async () => {
    const log = new InMemoryRunEventLog();
    const received: number[] = [];

    await log.append({
      runId: "r1",
      sessionId: "s1",
      projectId: "p1",
      event: { type: "run_queued", runId: "r1", sessionId: "s1" },
    });
    await log.append({
      runId: "r1",
      sessionId: "s1",
      projectId: "p1",
      event: { type: "run_started", runId: "r1", sessionId: "s1" },
    });

    const replay = await log.replay("session", "s1", 0);
    expect(replay).toHaveLength(2);

    log.subscribe({
      subscriberId: "sub1",
      scope: "session",
      scopeId: "s1",
      deliver: (e) => received.push(e.seq),
    });

    await log.append({
      runId: "r1",
      sessionId: "s1",
      projectId: "p1",
      event: { type: "assistant", runId: "r1", text: "hi" },
    });

    expect(received).toEqual([3]);
    expect(replay.map((e) => e.seq)).toEqual([1, 2]);
  });
});

describe("health metrics", () => {
  it("returns scheduler and push status", async () => {
    const ctx = await createApp({ port: 0 });
    const res = await ctx.app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      scheduler: { running: number; queued: number; maxConcurrent: number };
      push: { webPush: boolean; expo: boolean };
      exec: { sandboxMode: string; maxConcurrent: number };
      sandbox: { validatedWorkspacePath: boolean; sdkRunsOnHost: boolean };
    };
    expect(body.scheduler.maxConcurrent).toBe(3);
    expect(body.push.expo).toBe(true);
    expect(body.exec.sandboxMode).toBe("subprocess");
    expect(body.exec.maxConcurrent).toBe(3);
    expect(body.sandbox.validatedWorkspacePath).toBe(true);
    expect(body.sandbox.sdkRunsOnHost).toBe(true);
    await ctx.app.close();
  });
});

describe("API keys (UR-12)", () => {
  it("creates and lists API keys", async () => {
    const ctx = await createApp({ port: 0 });
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/api-keys",
      headers: AUTH,
      payload: { expiresInDays: 30 },
    });
    expect(createRes.statusCode).toBe(201);
    const created = createRes.json() as { id: string; apiKey: string };
    expect(created.apiKey).toMatch(/^ak_/);

    const listRes = await ctx.app.inject({
      method: "GET",
      url: "/api/v1/api-keys",
      headers: AUTH,
    });
    expect(listRes.statusCode).toBe(200);
    const list = listRes.json() as { keys: Array<{ id: string }> };
    expect(list.keys.some((k) => k.id === created.id)).toBe(true);

    const delRes = await ctx.app.inject({
      method: "DELETE",
      url: `/api/v1/api-keys/${created.id}`,
      headers: AUTH,
    });
    expect(delRes.statusCode).toBe(200);
    await ctx.app.close();
  });
});

describe("LD-01 HTTP concurrent sends", () => {
  let ldCtx: AppContext;

  beforeAll(async () => {
    ldCtx = await createApp({ port: 0 });
  });

  afterAll(async () => {
    if (ldCtx) await ldCtx.app.close();
  });

  it("accepts concurrent send_prompt across multiple sessions", async () => {
    const project = await prisma.project.create({
      data: {
        userId: "dev-user",
        name: "ld01-http",
        rootPath: path.join(process.cwd(), "test-workspaces", "ld01-http"),
        status: "active",
      },
    });
    await mkdir(project.rootPath, { recursive: true });
    const sessions = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        prisma.session.create({
          data: {
            projectId: project.id,
            model: "composer-2.5",
            status: "idle",
            title: `ld01-${i}`,
          },
        }),
      ),
    );

    const results = await Promise.all(
      sessions.map((session, i) =>
        ldCtx.app.inject({
          method: "POST",
          url: `/api/v1/sessions/${session.id}/messages`,
          headers: AUTH,
          payload: { text: `concurrent ${i}` },
        }),
      ),
    );
    for (const res of results) {
      expect([200, 202]).toContain(res.statusCode);
    }

    await waitForSchedulerIdle(ldCtx, 8000);
    const health = await ldCtx.app.inject({ method: "GET", url: "/health" });
    const body = health.json() as {
      scheduler: { maxConcurrent: number; running: number; queued: number };
    };
    expect(body.scheduler.maxConcurrent).toBe(3);
    expect(body.scheduler.running).toBe(0);
  });
});

describe("status runningSessions (S7)", () => {
  it("includes running session details in scope=all", async () => {
    const ctx = await createApp({ port: 0 });
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/v1/status?scope=all",
      headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      activeSessions: number;
      runningSessions: unknown[];
      scheduler: { running: number; queued: number };
    };
    expect(Array.isArray(body.runningSessions)).toBe(true);
    expect(body.scheduler).toBeDefined();
    await ctx.app.close();
  });
});

describe("WebSocket stream (CH-01)", () => {
  let wsCtx: AppContext;
  let wsBaseUrl: string;

  beforeAll(async () => {
    wsCtx = await createApp({ port: 0 });
    await wsCtx.app.listen({ port: 0, host: "127.0.0.1" });
    const addr = wsCtx.app.server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    wsBaseUrl = `ws://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    if (wsCtx) await wsCtx.app.close();
  });

  function waitForWsMessage(ws: WebSocket, timeoutMs = 5000): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("WS message timeout")),
        timeoutMs,
      );
      ws.once("message", (data) => {
        clearTimeout(timer);
        resolve(String(data));
      });
      ws.once("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  it(
    "replays session events over WebSocket (CH-01)",
    async () => {
    const project = await prisma.project.create({
      data: {
        userId: "dev-user",
        name: "ws-proj",
        rootPath: path.join(process.cwd(), "test-workspaces", "ws-proj"),
        status: "active",
      },
    });
    await mkdir(project.rootPath, { recursive: true });
    const session = await prisma.session.create({
      data: { projectId: project.id, model: "composer-2.5", status: "idle" },
    });
    const run = await prisma.run.create({
      data: { sessionId: session.id, status: "running" },
    });

    await wsCtx.eventLog.append({
      runId: run.id,
      sessionId: session.id,
      projectId: project.id,
      event: { type: "run_queued", runId: run.id, sessionId: session.id },
    });
    await wsCtx.eventLog.append({
      runId: run.id,
      sessionId: session.id,
      projectId: project.id,
      event: { type: "run_started", runId: run.id, sessionId: session.id },
    });

    const ws = new WebSocket(
      `${wsBaseUrl}/api/v1/stream?scope=session&id=${session.id}&cursor=0&token=${encodeURIComponent("dev-local-key")}`,
    );
    const messages: string[] = [];
    ws.on("message", (data) => messages.push(String(data)));

    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });

    const deadline = Date.now() + 5000;
    while (messages.length < 2 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(messages.length).toBeGreaterThanOrEqual(2);

    const first = JSON.parse(messages[0]!) as { seq: number };
    const second = JSON.parse(messages[1]!) as { seq: number };
    expect(first.seq).toBe(1);
    expect(second.seq).toBe(2);
    ws.close();
  },
    15_000,
  );
});

describe("Terminal exec (P6 S17)", () => {
  let termCtx: AppContext;
  let termBaseUrl: string;

  async function waitTerminalReady(ws: WebSocket, messages: string[]): Promise<void> {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      if (messages.join("").includes('"type":"ready"')) return;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error("terminal ready timeout");
  }

  beforeAll(async () => {
    termCtx = await createApp({ port: 0, sandboxMode: "subprocess" });
    await termCtx.app.listen({ port: 0, host: "127.0.0.1" });
    const addr = termCtx.app.server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    termBaseUrl = `ws://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    if (termCtx) await termCtx.app.close();
  });

  it(
    "streams command output over project terminal WebSocket",
    async () => {
    const project = await prisma.project.create({
      data: {
        userId: "dev-user",
        name: "term-proj",
        rootPath: path.join(process.cwd(), "test-workspaces", "term-proj"),
        status: "active",
      },
    });
    await mkdir(project.rootPath, { recursive: true });
    await writeFile(path.join(project.rootPath, "t.txt"), "term-ok");

    const ws = new WebSocket(
      `${termBaseUrl}/api/v1/projects/${project.id}/terminal?token=${encodeURIComponent("dev-local-key")}`,
    );
    const messages: string[] = [];
    ws.on("message", (d) => messages.push(String(d)));

    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    await waitTerminalReady(ws, messages);

    ws.send(JSON.stringify({ type: "exec", command: "echo term-ok" }));

    const deadline = Date.now() + 8000;
    let joined = "";
    while (Date.now() < deadline) {
      joined = messages.join("");
      if (joined.includes("term-ok") && joined.includes('"type":"exit"')) {
        break;
      }
      await new Promise((r) => setTimeout(r, 30));
    }

    expect(joined).toContain("term-ok");
    ws.close();
  },
    15_000,
  );

  it("issues preview token for project", async () => {
    const project = await prisma.project.create({
      data: {
        userId: "dev-user",
        name: "preview-proj",
        rootPath: path.join(process.cwd(), "test-workspaces", "preview-proj"),
        status: "active",
      },
    });
    await mkdir(project.rootPath, { recursive: true });

    const res = await termCtx.app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/preview`,
      headers: AUTH,
      payload: { port: 8080 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { token: string; previewPath: string };
    expect(body.token).toBeTruthy();
    expect(body.previewPath).toContain(body.token);
  });

  it("revokes preview tokens and purges sandbox session on archive", async () => {
    const project = await prisma.project.create({
      data: {
        userId: "dev-user",
        name: "archive-preview",
        rootPath: path.join(
          process.cwd(),
          "test-workspaces",
          "archive-preview",
        ),
        status: "active",
      },
    });
    await mkdir(project.rootPath, { recursive: true });

    termCtx.sandboxSessions.getOrCreate(project.id);

    const issue = await termCtx.app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/preview`,
      headers: AUTH,
      payload: { port: 8080 },
    });
    expect(issue.statusCode).toBe(200);
    const { token, previewPath } = issue.json() as {
      token: string;
      previewPath: string;
    };

    const patch = await termCtx.app.inject({
      method: "PATCH",
      url: `/api/v1/projects/${project.id}`,
      headers: AUTH,
      payload: { status: "archived" },
    });
    expect(patch.statusCode).toBe(200);
    expect(termCtx.sandboxSessions.get(project.id)).toBeUndefined();

    const proxy = await termCtx.app.inject({
      method: "GET",
      url: previewPath,
    });
    expect(proxy.statusCode).toBe(403);
    expect(token.length).toBeGreaterThan(8);
  });

  it("closes active terminal WebSocket on archive (13 §6.4)", async () => {
    const project = await prisma.project.create({
      data: {
        userId: "dev-user",
        name: "archive-term-ws",
        rootPath: path.join(
          process.cwd(),
          "test-workspaces",
          "archive-term-ws",
        ),
        status: "active",
      },
    });
    await mkdir(project.rootPath, { recursive: true });

    const ws = new WebSocket(
      `${termBaseUrl}/api/v1/projects/${project.id}/terminal?token=${encodeURIComponent("dev-local-key")}`,
    );
    const messages: string[] = [];
    ws.on("message", (d) => messages.push(String(d)));

    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    await waitTerminalReady(ws, messages);

    const patch = await termCtx.app.inject({
      method: "PATCH",
      url: `/api/v1/projects/${project.id}`,
      headers: AUTH,
      payload: { status: "archived" },
    });
    expect(patch.statusCode).toBe(200);

    const closeCode = await new Promise<number>((resolve, reject) => {
      ws.once("close", (code) => resolve(code));
      ws.once("error", reject);
      setTimeout(() => reject(new Error("timeout waiting for close")), 5000);
    });
    expect(closeCode).toBe(TERMINAL_WS_CLOSE.PROJECT_ARCHIVED);
    expect(termCtx.terminalConnections.count(project.id)).toBe(0);
  });

  it("rejects preview port outside allowed range", async () => {
    const project = await prisma.project.create({
      data: {
        userId: "dev-user",
        name: "preview-port",
        rootPath: path.join(process.cwd(), "test-workspaces", "preview-port"),
        status: "active",
      },
    });

    const res = await termCtx.app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/preview`,
      headers: AUTH,
      payload: { port: 22 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("denies terminal WebSocket for other user's project (SEC-04)", async () => {
    const project = await prisma.project.create({
      data: {
        userId: "other-user",
        name: "secret-term",
        rootPath: path.join(process.cwd(), "test-workspaces", "secret-term"),
        status: "active",
      },
    });

    const ws = new WebSocket(
      `${termBaseUrl}/api/v1/projects/${project.id}/terminal?token=${encodeURIComponent("dev-local-key")}`,
    );

    const closeCode = await new Promise<number>((resolve, reject) => {
      ws.once("close", (code) => resolve(code));
      ws.once("error", reject);
      setTimeout(() => reject(new Error("timeout waiting for close")), 5000);
    });

    expect(closeCode).toBe(TERMINAL_WS_CLOSE.FORBIDDEN);
  });

  it("denies terminal WebSocket for archived project", async () => {
    const project = await prisma.project.create({
      data: {
        userId: "dev-user",
        name: "arch-term",
        rootPath: path.join(process.cwd(), "test-workspaces", "arch-term"),
        status: "archived",
      },
    });

    const ws = new WebSocket(
      `${termBaseUrl}/api/v1/projects/${project.id}/terminal?token=${encodeURIComponent("dev-local-key")}`,
    );
    const closeCode = await new Promise<number>((resolve, reject) => {
      ws.once("close", (code) => resolve(code));
      ws.once("error", reject);
      setTimeout(() => reject(new Error("timeout waiting for close")), 5000);
    });
    expect(closeCode).toBe(TERMINAL_WS_CLOSE.PROJECT_ARCHIVED);
  });

  it("rejects exec with cwd outside project root (SEC-04)", async () => {
    const project = await prisma.project.create({
      data: {
        userId: "dev-user",
        name: "cwd-guard",
        rootPath: path.join(process.cwd(), "test-workspaces", "cwd-guard"),
        status: "active",
      },
    });
    await mkdir(project.rootPath, { recursive: true });

    const ws = new WebSocket(
      `${termBaseUrl}/api/v1/projects/${project.id}/terminal?token=${encodeURIComponent("dev-local-key")}`,
    );
    const messages: string[] = [];
    ws.on("message", (d) => messages.push(String(d)));
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    await waitTerminalReady(ws, messages);

    ws.send(
      JSON.stringify({
        type: "exec",
        command: "echo hi",
        cwd: "../../../etc",
      }),
    );

    const deadline = Date.now() + 5000;
    let joined = "";
    while (Date.now() < deadline) {
      joined = messages.join("");
      if (joined.includes("path_escape") || joined.includes("Path escapes")) {
        break;
      }
      await new Promise((r) => setTimeout(r, 30));
    }
    expect(joined).toMatch(/path_escape|Path escapes/);
    ws.close();
  });

  it("blocks exec cwd escaping to sibling project (SEC-04)", async () => {
    const base = path.join(process.cwd(), "test-workspaces", "sec04-base");
    const projA = path.join(base, "proj-a");
    const projB = path.join(base, "proj-b");
    await mkdir(projA, { recursive: true });
    await mkdir(projB, { recursive: true });
    await writeFile(path.join(projB, "secret.txt"), "leak-me");

    const project = await prisma.project.create({
      data: {
        userId: "dev-user",
        name: "sec04-a",
        rootPath: projA,
        status: "active",
      },
    });

    const ws = new WebSocket(
      `${termBaseUrl}/api/v1/projects/${project.id}/terminal?token=${encodeURIComponent("dev-local-key")}`,
    );
    const messages: string[] = [];
    ws.on("message", (d) => messages.push(String(d)));
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    await waitTerminalReady(ws, messages);

    ws.send(
      JSON.stringify({
        type: "exec",
        command: "echo blocked",
        cwd: "../proj-b",
      }),
    );

    const deadline = Date.now() + 5000;
    let joined = "";
    while (Date.now() < deadline) {
      joined = messages.join("");
      if (joined.includes("path_escape") || joined.includes("Path escapes")) {
        break;
      }
      await new Promise((r) => setTimeout(r, 30));
    }
    expect(joined).toMatch(/path_escape|Path escapes/);
    ws.close();
  });

  it("blocks exec command with absolute path to sibling project (SEC-04)", async () => {
    const base = path.join(process.cwd(), "test-workspaces", "sec04-abs");
    const projA = path.join(base, "proj-a");
    const projB = path.join(base, "proj-b");
    await mkdir(projA, { recursive: true });
    await mkdir(projB, { recursive: true });
    await writeFile(path.join(projB, "secret.txt"), "abs-leak");

    const project = await prisma.project.create({
      data: {
        userId: "dev-user",
        name: "sec04-abs-a",
        rootPath: projA,
        status: "active",
      },
    });

    const outside = path.join(projB, "secret.txt");
    const cmd =
      process.platform === "win32" ? `type ${outside}` : `cat ${outside}`;

    const ws = new WebSocket(
      `${termBaseUrl}/api/v1/projects/${project.id}/terminal?token=${encodeURIComponent("dev-local-key")}`,
    );
    const messages: string[] = [];
    ws.on("message", (d) => messages.push(String(d)));
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    await waitTerminalReady(ws, messages);

    ws.send(JSON.stringify({ type: "exec", command: cmd }));

    const deadline = Date.now() + 5000;
    let joined = "";
    while (Date.now() < deadline) {
      joined = messages.join("");
      if (joined.includes("path_escape") || joined.includes("Path escapes")) {
        break;
      }
      await new Promise((r) => setTimeout(r, 30));
    }
    expect(joined).toMatch(/path_escape|Path escapes/);
    ws.close();
  });

  async function listenPreviewStub(
    handler: (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => void,
  ): Promise<{ server: Server; port: number }> {
    for (let port = 9876; port >= 3000; port -= 1) {
      try {
        const server = await new Promise<Server>((resolve, reject) => {
          const s = createServer(handler);
          s.once("error", reject);
          s.listen(port, "127.0.0.1", () => resolve(s));
        });
        return { server, port };
      } catch {
        continue;
      }
    }
    throw new Error("no preview stub port available");
  }

  it("proxies HTTP GET to upstream via preview token", async () => {
    const stub = await listenPreviewStub((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("preview-proxy-ok");
    });

    try {
      const project = await prisma.project.create({
        data: {
          userId: "dev-user",
          name: "preview-proxy",
          rootPath: path.join(process.cwd(), "test-workspaces", "preview-proxy"),
          status: "active",
        },
      });

      const issue = await termCtx.app.inject({
        method: "POST",
        url: `/api/v1/projects/${project.id}/preview`,
        headers: AUTH,
        payload: { port: stub.port },
      });
      expect(issue.statusCode).toBe(200);
      const { token } = issue.json() as { token: string };

      const proxy = await termCtx.app.inject({
        method: "GET",
        url: `/api/v1/preview/${token}/`,
      });
      expect(proxy.statusCode).toBe(200);
      expect(proxy.body).toContain("preview-proxy-ok");
    } finally {
      await new Promise<void>((resolve) => stub.server.close(() => resolve()));
    }
  });

  it("exec_command via Command handler returns stdout (P6/17)", async () => {
    const project = await prisma.project.create({
      data: {
        userId: "dev-user",
        name: "exec-cmd",
        rootPath: path.join(process.cwd(), "test-workspaces", "exec-cmd"),
        status: "active",
      },
    });
    await mkdir(project.rootPath, { recursive: true });

    const res = await termCtx.app.inject({
      method: "POST",
      url: "/api/v1/commands",
      headers: AUTH,
      payload: {
        kind: "exec_command",
        source: "web",
        requestId: randomUUID(),
        projectId: project.id,
        command: process.platform === "win32" ? "echo cmd-ok" : "echo cmd-ok",
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      stdout: string;
      exitCode: number;
    };
    expect(body.stdout).toContain("cmd-ok");
    expect(body.exitCode).toBe(0);
    expect(termCtx.sandboxSessions.get(project.id)?.sandboxId).toBeTruthy();
  });

  it(
    "creates exec_timeout notification per project with dedup (13 §9)",
    async () => {
      const shortCtx = await createApp({
        port: 0,
        sandboxMode: "subprocess",
        execTimeoutMs: 800,
      });
      await shortCtx.app.listen({ port: 0, host: "127.0.0.1" });
      try {
        const project = await prisma.project.create({
          data: {
            userId: "dev-user",
            name: "exec-timeout-notif",
            rootPath: path.join(
              process.cwd(),
              "test-workspaces",
              "exec-timeout-notif",
            ),
            status: "active",
          },
        });
        await mkdir(project.rootPath, { recursive: true });

        const slowCmd =
          process.platform === "win32"
            ? "powershell -Command Start-Sleep -Seconds 5"
            : "sleep 5";

        const res = await shortCtx.app.inject({
          method: "POST",
          url: "/api/v1/commands",
          headers: AUTH,
          payload: {
            kind: "exec_command",
            source: "web",
            requestId: randomUUID(),
            projectId: project.id,
            command: slowCmd,
          },
        });
        expect(res.statusCode).toBe(200);
        const body = res.json() as { exitCode: number; errorCode?: string };
        expect(body.exitCode).toBe(124);
        expect(body.errorCode).toBe("exec_timeout");

        const deadline = Date.now() + 5000;
        let notes: Awaited<ReturnType<typeof prisma.notification.findMany>> = [];
        while (Date.now() < deadline) {
          notes = await prisma.notification.findMany({
            where: {
              userId: "dev-user",
              kind: "exec_timeout",
              projectId: project.id,
            },
          });
          if (notes.length >= 1) break;
          await new Promise((r) => setTimeout(r, 100));
        }
        expect(notes).toHaveLength(1);
        expect(notes[0].deeplink).toBe(`/project/${project.id}/terminal`);

        await shortCtx.app.inject({
          method: "POST",
          url: "/api/v1/commands",
          headers: AUTH,
          payload: {
            kind: "exec_command",
            source: "web",
            requestId: randomUUID(),
            projectId: project.id,
            command: slowCmd,
          },
        });
        await new Promise((r) => setTimeout(r, 1500));
        const afterDedup = await prisma.notification.findMany({
          where: {
            userId: "dev-user",
            kind: "exec_timeout",
            projectId: project.id,
          },
        });
        expect(afterDedup).toHaveLength(1);
      } finally {
        await shortCtx.app.close();
      }
    },
    45_000,
  );

  it("proxies WebSocket upgrade for preview token (UR-10 HMR)", async () => {
    const upstream = await new Promise<{ server: WebSocketServer; port: number }>(
      (resolve, reject) => {
        let bound = false;
        const tryPort = (port: number) => {
          const wss = new WebSocketServer({ port, host: "127.0.0.1" });
          wss.on("listening", () => {
            bound = true;
            resolve({ server: wss, port });
          });
          wss.on("error", (err) => {
            if (!bound && port > 3000) tryPort(port - 1);
            else reject(err);
          });
          wss.on("connection", (ws) => {
            ws.send("preview-ws-ok");
          });
        };
        tryPort(9876);
      },
    );

    try {
      const project = await prisma.project.create({
        data: {
          userId: "dev-user",
          name: "preview-ws",
          rootPath: path.join(process.cwd(), "test-workspaces", "preview-ws"),
          status: "active",
        },
      });

      const issue = await termCtx.app.inject({
        method: "POST",
        url: `/api/v1/projects/${project.id}/preview`,
        headers: AUTH,
        payload: { port: upstream.port },
      });
      const { token } = issue.json() as { token: string };

      const addr = termCtx.app.server.address();
      const appPort =
        typeof addr === "object" && addr ? addr.port : 0;
      const ws = new WebSocket(
        `ws://127.0.0.1:${appPort}/api/v1/preview/${token}/`,
      );
      const msg = await new Promise<string>((resolve, reject) => {
        ws.once("message", (d) => resolve(String(d)));
        ws.once("error", reject);
        setTimeout(() => reject(new Error("ws timeout")), 5000);
      });
      expect(msg).toBe("preview-ws-ok");
      ws.close();
    } finally {
      await new Promise<void>((resolve) => upstream.server.close(() => resolve()));
    }
  });

  it("does not append terminal stdout to RunEventLog (13 §8.1)", async () => {
    const before = await prisma.runEvent.count();
    const project = await prisma.project.create({
      data: {
        userId: "dev-user",
        name: "term-no-log",
        rootPath: path.join(process.cwd(), "test-workspaces", "term-no-log"),
        status: "active",
      },
    });
    await mkdir(project.rootPath, { recursive: true });

    const ws = new WebSocket(
      `${termBaseUrl}/api/v1/projects/${project.id}/terminal?token=${encodeURIComponent("dev-local-key")}`,
    );
    const messages: string[] = [];
    ws.on("message", (d) => messages.push(String(d)));
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    await waitTerminalReady(ws, messages);
    ws.send(JSON.stringify({ type: "exec", command: "echo no-run-log" }));

    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      if (messages.join("").includes('"type":"exit"')) break;
      await new Promise((r) => setTimeout(r, 30));
    }
    ws.close();

    const after = await prisma.runEvent.count();
    expect(after).toBe(before);
    expect(messages.join("")).toContain("no-run-log");
  });

  it("enforces per-project exec limit on terminal WebSocket", async () => {
    const limitCtx = await createApp({
      port: 0,
      sandboxMode: "subprocess",
      perProjectMaxExec: 1,
      maxConcurrentExec: 5,
    });
    await limitCtx.app.listen({ port: 0, host: "127.0.0.1" });
    const addr = limitCtx.app.server.address();
    const limitPort = typeof addr === "object" && addr ? addr.port : 0;
    const limitWsBase = `ws://127.0.0.1:${limitPort}`;

    try {
      const project = await prisma.project.create({
        data: {
          userId: "dev-user",
          name: "exec-limit",
          rootPath: path.join(process.cwd(), "test-workspaces", "exec-limit"),
          status: "active",
        },
      });
      await mkdir(project.rootPath, { recursive: true });

      const holdCmd =
        process.platform === "win32"
          ? "ping -n 30 127.0.0.1 > nul"
          : "sleep 30";

      const ws = new WebSocket(
        `${limitWsBase}/api/v1/projects/${project.id}/terminal?token=${encodeURIComponent("dev-local-key")}`,
      );
      const messages: string[] = [];
      ws.on("message", (d) => messages.push(String(d)));
      await new Promise<void>((resolve, reject) => {
        ws.once("open", () => resolve());
        ws.once("error", reject);
      });
      await waitTerminalReady(ws, messages);

      ws.send(JSON.stringify({ type: "exec", command: holdCmd }));
      await new Promise((r) => setTimeout(r, 400));

      ws.send(JSON.stringify({ type: "exec", command: "echo second" }));

      const deadline = Date.now() + 8000;
      let joined = "";
      while (Date.now() < deadline) {
        joined = messages.join("");
        if (joined.includes("project_exec_limit")) break;
        await new Promise((r) => setTimeout(r, 30));
      }
      expect(joined).toContain("project_exec_limit");
      ws.close();
    } finally {
      await limitCtx.app.close();
    }
  }, 20_000);

  it("rejects expired preview token on proxy", async () => {
    const shortCtx = await createApp({
      port: 0,
      previewTokenTtlSec: 1,
    });
    const project = await prisma.project.create({
      data: {
        userId: "dev-user",
        name: "preview-exp",
        rootPath: path.join(process.cwd(), "test-workspaces", "preview-exp"),
        status: "active",
      },
    });

    const issue = await shortCtx.app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/preview`,
      headers: AUTH,
      payload: { port: 5173 },
    });
    expect(issue.statusCode).toBe(200);
    const { token } = issue.json() as { token: string };

    await new Promise((r) => setTimeout(r, 1100));

    const proxy = await shortCtx.app.inject({
      method: "GET",
      url: `/api/v1/preview/${token}/`,
    });
    expect(proxy.statusCode).toBe(403);
    await shortCtx.app.close();
  });

  it("shutdownApp closes active terminal WebSocket (13 §6.4)", async () => {
    const shutdownCtx = await createApp({ port: 0, sandboxMode: "subprocess" });
    await shutdownCtx.app.listen({ port: 0, host: "127.0.0.1" });
    const addr = shutdownCtx.app.server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const wsBase = `ws://127.0.0.1:${port}`;

    const project = await prisma.project.create({
      data: {
        userId: "dev-user",
        name: "shutdown-term-ws",
        rootPath: path.join(
          process.cwd(),
          "test-workspaces",
          "shutdown-term-ws",
        ),
        status: "active",
      },
    });
    await mkdir(project.rootPath, { recursive: true });

    const ws = new WebSocket(
      `${wsBase}/api/v1/projects/${project.id}/terminal?token=${encodeURIComponent("dev-local-key")}`,
    );
    const messages: string[] = [];
    ws.on("message", (d) => messages.push(String(d)));

    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    await waitTerminalReady(ws, messages);

    await shutdownApp(shutdownCtx);

    const closeCode = await new Promise<number>((resolve, reject) => {
      ws.once("close", (code) => resolve(code));
      ws.once("error", reject);
      setTimeout(() => reject(new Error("timeout waiting for close")), 5000);
    });
    expect(closeCode).toBe(TERMINAL_WS_CLOSE.SERVER_SHUTDOWN);
    expect(shutdownCtx.terminalConnections.count()).toBe(0);
    await shutdownCtx.app.close();
  });
});

afterAll(async () => {
  await disconnectDb();
});
