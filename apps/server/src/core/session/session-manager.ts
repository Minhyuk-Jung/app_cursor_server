import type { DomainEvent } from "@app/shared";
import { RunStatus as RunStatusEnum } from "@app/shared";
import { prisma } from "../../db/client.js";
import type { RunEventLog } from "../eventlog/types.js";
import {
  classifyStartupError,
  runDoneEvent,
  runErrorEvent,
  SdkAdapter,
  type SdkAgentHandle,
  type SdkPromptInput,
} from "../sdk/sdk-adapter.js";
import { ApprovalGateRegistry } from "./approval-gate.js";
import { resolveSessionSummary } from "./session-summary.js";

import type { GitService } from "../../services/git/git-service.js";

export interface SessionManagerDeps {
  eventLog: RunEventLog;
  sdk: SdkAdapter;
  apiKey: string;
  agentCacheMax: number;
  git?: GitService;
  autoSnapshot?: boolean;
  /** ADR-007: 캐시 hit 시에도 workspace 경로 재검증 */
  assertWorkspace?: (projectRoot: string) => Promise<string>;
  /** ADR-007 shared-path: docker 모드에서 SDK·exec 공통 컨테이너 준비 */
  prepareProjectSandbox?: (projectId: string, projectRoot: string) => void;
}

interface CacheEntry {
  handle: SdkAgentHandle;
  lastUsedAt: number;
  activeRunCount: number;
}

export class SessionManager {
  private cache = new Map<string, CacheEntry>();
  private activeRuns = new Map<
    string,
    { runId: string; cancel: () => Promise<void> }
  >();
  private approvalGates = new ApprovalGateRegistry();

  constructor(private deps: SessionManagerDeps) {}

  async createSession(
    projectId: string,
    model: string,
    cwd: string,
    source: string,
    title?: string,
  ) {
    this.invokePrepareProjectSandbox(projectId, cwd);
    const agent = await this.deps.sdk.createAgent({
      cwd,
      model,
      apiKey: this.deps.apiKey,
      projectId,
    });

    const session = await prisma.session.create({
      data: {
        projectId,
        model,
        source,
        title,
        status: "idle",
        agentId: agent.agentId,
      },
    });

    this.putCache(session.id, agent);
    return session;
  }

  async prepareRun(
    sessionId: string,
    text: string,
    attachmentsJson?: string | null,
  ): Promise<{ runId: string; sessionId: string; projectId: string }> {
    const session = await prisma.session.findUniqueOrThrow({
      where: { id: sessionId },
      include: { project: true },
    });

    const run = await prisma.run.create({
      data: {
        sessionId,
        status: RunStatusEnum.QUEUED,
      },
    });

    await prisma.message.create({
      data: {
        sessionId,
        role: "user",
        content: text,
        attachmentsJson: attachmentsJson ?? null,
        runId: run.id,
      },
    });

    return {
      runId: run.id,
      sessionId,
      projectId: session.projectId,
    };
  }

  async recordQueued(input: {
    runId: string;
    sessionId: string;
    projectId: string;
  }): Promise<void> {
    await this.recordEvent({
      ...input,
      event: {
        type: "run_queued",
        runId: input.runId,
        sessionId: input.sessionId,
      },
    });
  }

  async executeRun(
    runId: string,
    sessionId: string,
    projectId: string,
    prompt: SdkPromptInput,
    options?: { isLastAttempt?: boolean },
  ): Promise<boolean> {
    const isLastAttempt = options?.isLastAttempt ?? true;
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      include: { project: true },
    });
    if (!session) {
      return false;
    }

    let agent: SdkAgentHandle;
    try {
      agent = await this.acquireAgent(sessionId, session);
    } catch (err) {
      const errorEvent = this.startupErrorFrom(err);
      await this.recordEvent({
        runId,
        sessionId,
        projectId,
        event: { ...errorEvent, runId },
      });
      if (this.shouldRetry(errorEvent, isLastAttempt)) {
        return true;
      }
      await this.recordEvent({
        runId,
        sessionId,
        projectId,
        event: runDoneEvent(runId, "error"),
      });
      await this.updateSessionSummary(sessionId);
      return false;
    }

    const entry = this.cache.get(sessionId)!;
    entry.activeRunCount += 1;

    if (this.deps.git && this.deps.autoSnapshot !== false) {
      try {
        const snapshotRef = await this.deps.git.createSnapshot(
          session.project.rootPath,
          runId,
        );
        await prisma.run.update({
          where: { id: runId },
          data: { snapshotRef },
        });
      } catch {
        await this.recordEvent({
          runId,
          sessionId,
          projectId,
          event: {
            type: "error",
            runId,
            message: "Git snapshot failed (execution continues)",
            retryable: false,
          },
        });
      }
    }

    try {
      const handle = await agent.send(prompt);

      this.activeRuns.set(runId, {
        runId,
        cancel: () => handle.cancel(),
      });

      await this.recordEvent({
        runId,
        sessionId,
        projectId,
        event: { type: "run_started", runId, sessionId },
      });

      let assistantMessageId: string | null = null;

      for await (const event of handle.streamEvents()) {
        await this.recordEvent({ runId, sessionId, projectId, event });
        if (event.type === "assistant") {
          assistantMessageId = await this.appendAssistantMessage(
            sessionId,
            runId,
            event.text,
            assistantMessageId,
          );
        }

        if (event.type === "approval_required") {
          const decision = await this.approvalGates.wait(runId);
          if (decision === "reject") {
            await handle.cancel();
            break;
          }
        }
      }

      const result = await handle.wait();
      await this.recordEvent({
        runId,
        sessionId,
        projectId,
        event: runDoneEvent(runId, result.status),
      });
      await this.updateSessionSummary(sessionId);
      return false;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const errorEvent =
        typeof err === "object" &&
        err !== null &&
        "type" in err &&
        (err as DomainEvent).type === "error"
          ? (err as DomainEvent)
          : runErrorEvent(runId, message);

      await this.recordEvent({ runId, sessionId, projectId, event: errorEvent });
      if (this.shouldRetry(errorEvent, isLastAttempt)) {
        return true;
      }
      await this.recordEvent({
        runId,
        sessionId,
        projectId,
        event: runDoneEvent(runId, "error"),
      });
      await this.updateSessionSummary(sessionId);
      return false;
    } finally {
      entry.activeRunCount = Math.max(0, entry.activeRunCount - 1);
      entry.lastUsedAt = Date.now();
      this.activeRuns.delete(runId);
      this.evictIfNeeded();
    }
  }

  async failRunQuota(input: {
    runId: string;
    sessionId: string;
    projectId: string;
    message: string;
  }): Promise<void> {
    await this.recordEvent({
      runId: input.runId,
      sessionId: input.sessionId,
      projectId: input.projectId,
      event: runErrorEvent(input.runId, input.message, false),
    });
    await this.recordEvent({
      runId: input.runId,
      sessionId: input.sessionId,
      projectId: input.projectId,
      event: runDoneEvent(input.runId, "error"),
    });
    await this.updateSessionSummary(input.sessionId);
  }

  async resetRunForRetry(input: {
    runId: string;
    sessionId: string;
    projectId: string;
  }): Promise<void> {
    await prisma.run.update({
      where: { id: input.runId },
      data: { status: RunStatusEnum.QUEUED },
    });
    await prisma.session.update({
      where: { id: input.sessionId },
      data: { status: "idle" },
    });
    await this.recordQueued(input);
  }

  private shouldRetry(errorEvent: DomainEvent, isLastAttempt: boolean): boolean {
    if (isLastAttempt) return false;
    return (
      errorEvent.type === "error" &&
      "retryable" in errorEvent &&
      errorEvent.retryable === true
    );
  }

  /** 05 §6.5: 규칙/LLM 세션 요약 (UR-16) */
  private async updateSessionSummary(sessionId: string): Promise<void> {
    try {
      const session = await prisma.session.findUnique({
        where: { id: sessionId },
        include: { project: true },
      });
      if (!session) return;

      const messages = await prisma.message.findMany({
        where: { sessionId },
        orderBy: { createdAt: "desc" },
        take: 8,
      });

      const summary = await resolveSessionSummary(messages, {
        llm: {
          sdk: this.deps.sdk,
          apiKey: this.deps.apiKey,
          session: {
            model: session.model,
            project: {
              id: session.project.id,
              rootPath: session.project.rootPath,
            },
          },
        },
      });

      await prisma.session.update({
        where: { id: sessionId },
        data: { summary },
      });
    } catch {
      // best-effort
    }
  }

  async resolveApproval(
    userId: string,
    approvalId: string,
    decision: "approve" | "reject",
  ): Promise<{ runId: string; decision: string }> {
    const runId = approvalId.endsWith("-approval")
      ? approvalId.slice(0, -"-approval".length)
      : approvalId;

    const run = await prisma.run.findUnique({
      where: { id: runId },
      include: { session: { include: { project: true } } },
    });
    if (!run) {
      throw Object.assign(new Error("Run not found"), {
        code: "not_found",
        retryable: false,
      });
    }

    if (run.session.project.userId !== userId) {
      throw Object.assign(new Error("Access denied"), {
        code: "forbidden",
        retryable: false,
      });
    }

    if (run.status !== RunStatusEnum.WAITING_APPROVAL) {
      throw Object.assign(new Error("Run is not waiting for approval"), {
        code: "conflict",
        retryable: false,
      });
    }

    await this.recordEvent({
      runId,
      sessionId: run.sessionId,
      projectId: run.session.projectId,
      event: {
        type: "approval_resolved",
        runId,
        approvalId,
        decision,
      },
    });

    this.approvalGates.complete(runId, decision);

    if (decision === "reject") {
      await this.recordEvent({
        runId,
        sessionId: run.sessionId,
        projectId: run.session.projectId,
        event: runDoneEvent(runId, "cancelled"),
      });
    }

    return { runId, decision };
  }

  /** UR-18: 활성 run 중 같은 세션에 추가 지시 (스케줄러 큐잉) */
  async steerRun(
    runId: string,
    text: string,
  ): Promise<{ sessionId: string; projectId: string; text: string }> {
    const run = await prisma.run.findUnique({
      where: { id: runId },
      include: { session: true },
    });
    if (!run) {
      throw Object.assign(new Error("Run not found"), {
        code: "not_found",
        retryable: false,
      });
    }

    const active = ["queued", "running", "streaming", "waiting_approval"];
    if (!active.includes(run.status)) {
      throw Object.assign(new Error("Run is not active"), {
        code: "conflict",
        retryable: false,
      });
    }

    await prisma.message.create({
      data: {
        sessionId: run.sessionId,
        role: "user",
        content: `[steer] ${text}`,
        runId,
      },
    });

    return {
      sessionId: run.sessionId,
      projectId: run.session.projectId,
      text,
    };
  }

  isRunActive(runId: string): boolean {
    return this.activeRuns.has(runId);
  }

  async cancelRun(runId: string): Promise<void> {
    const run = await prisma.run.findUnique({
      where: { id: runId },
      include: { session: { select: { projectId: true } } },
    });
    if (!run) return;

    const active = this.activeRuns.get(runId);
    if (active) {
      await active.cancel();
    }

    const terminal = ["finished", "error", "cancelled"];
    if (!terminal.includes(run.status)) {
      await this.recordEvent({
        runId,
        sessionId: run.sessionId,
        projectId: run.session.projectId,
        event: runDoneEvent(runId, "cancelled"),
      });
    }
  }

  async disposeAll(): Promise<void> {
    for (const entry of this.cache.values()) {
      await entry.handle.dispose();
    }
    this.cache.clear();
  }

  /** 프로젝트 아카이브 시 SDK agent 캐시 해제 (05 dispose, 13 §6.4) */
  async disposeProjectAgents(projectId: string): Promise<void> {
    const sessions = await prisma.session.findMany({
      where: { projectId },
      select: { id: true },
    });
    for (const { id } of sessions) {
      const entry = this.cache.get(id);
      if (!entry) continue;
      await entry.handle.dispose();
      this.cache.delete(id);
    }
  }

  private invokePrepareProjectSandbox(projectId: string, cwd: string): void {
    if (!this.deps.prepareProjectSandbox) return;
    try {
      this.deps.prepareProjectSandbox(projectId, cwd);
    } catch (err) {
      const event = classifyStartupError(err);
      throw Object.assign(new Error(event.message), { domainError: event });
    }
  }

  private startupErrorFrom(err: unknown): DomainEvent {
    if (
      err &&
      typeof err === "object" &&
      "domainError" in err &&
      (err as { domainError?: DomainEvent }).domainError?.type === "error"
    ) {
      return (err as { domainError: DomainEvent }).domainError;
    }
    return classifyStartupError(err);
  }

  private async acquireAgent(
    sessionId: string,
    session: {
      agentId: string | null;
      model: string;
      project: { id: string; rootPath: string };
    },
  ): Promise<SdkAgentHandle> {
    const cached = this.cache.get(sessionId);
    if (cached) {
      if (this.deps.assertWorkspace) {
        await this.deps.assertWorkspace(session.project.rootPath);
      }
      this.invokePrepareProjectSandbox(
        session.project.id,
        session.project.rootPath,
      );
      cached.lastUsedAt = Date.now();
      return cached.handle;
    }

    this.invokePrepareProjectSandbox(
      session.project.id,
      session.project.rootPath,
    );

    let agent: SdkAgentHandle;
    if (session.agentId) {
      agent = await this.deps.sdk.resumeAgent(
        session.agentId,
        this.deps.apiKey,
        session.project.rootPath,
        session.project.id,
      );
    } else {
      agent = await this.deps.sdk.createAgent({
        cwd: session.project.rootPath,
        model: session.model,
        apiKey: this.deps.apiKey,
        projectId: session.project.id,
      });
      await prisma.session.update({
        where: { id: sessionId },
        data: { agentId: agent.agentId },
      });
    }

    this.putCache(sessionId, agent);
    this.evictIfNeeded();
    return agent;
  }

  private putCache(sessionId: string, handle: SdkAgentHandle): void {
    this.cache.set(sessionId, {
      handle,
      lastUsedAt: Date.now(),
      activeRunCount: 0,
    });
  }

  private evictIfNeeded(): void {
    if (this.cache.size <= this.deps.agentCacheMax) return;

    const candidates = [...this.cache.entries()]
      .filter(([, e]) => e.activeRunCount === 0)
      .sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt);

    for (const [sessionId, entry] of candidates) {
      if (this.cache.size <= this.deps.agentCacheMax) break;
      void entry.handle.dispose();
      this.cache.delete(sessionId);
    }
  }

  private async appendAssistantMessage(
    sessionId: string,
    runId: string,
    chunk: string,
    existingId: string | null,
  ): Promise<string> {
    if (existingId) {
      const prev = await prisma.message.findUnique({ where: { id: existingId } });
      if (prev) {
        await prisma.message.update({
          where: { id: existingId },
          data: { content: prev.content + chunk },
        });
        return existingId;
      }
    }
    const created = await prisma.message.create({
      data: { sessionId, role: "assistant", content: chunk, runId },
    });
    return created.id;
  }

  private async recordEvent(input: {
    runId: string;
    sessionId: string;
    projectId: string;
    event: DomainEvent;
  }): Promise<void> {
    await this.deps.eventLog.append({
      runId: input.runId,
      sessionId: input.sessionId,
      projectId: input.projectId,
      event: input.event,
    });
  }
}
