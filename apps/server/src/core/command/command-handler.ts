import type { AppError, NormalizedCommand } from "@app/shared";
import {
  parseCommand,
  Scope as ScopeEnum,
  validationFailed,
} from "@app/shared";
import { Prisma } from "@prisma/client";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import type { AuthContext } from "../../auth/auth.js";
import {
  assertProjectAccess,
  assertReplayAccess,
  assertRunAccess,
  assertSessionAccess,
} from "../../auth/access.js";
import { forbidden } from "../../auth/auth.js";
import { prisma } from "../../db/client.js";
import {
  checkUsageLimit,
  recordUsage,
} from "../../services/usage/usage-service.js";
import type { ServerConfig } from "../../config.js";
import type { RunEventLog } from "../eventlog/types.js";
import type { Scheduler, RunJob } from "../scheduler/scheduler.js";
import type { SessionManager } from "../session/session-manager.js";
import type { StateMachine } from "../state/state-machine.js";
import type { GitService } from "../../services/git/git-service.js";
import type { NotificationEngine } from "../notification/notification-engine.js";
import { NotificationKind } from "../notification/notification-engine.js";
import type { ExecService } from "../../services/exec/exec-service.js";
import type { FileService } from "../../services/file/file-service.js";
import {
  resolvePromptWithAttachments,
  serializeAttachmentsJson,
  userMessageContent,
} from "../../services/file/prompt-attachments.js";
import { startOfUtcDay } from "../../services/usage/usage-service.js";
import type { SdkPromptInput } from "../sdk/sdk-adapter.js";

export interface CommandResult {
  ok: true;
  data: unknown;
  httpStatus?: number;
}

export interface CommandError {
  ok: false;
  error: AppError;
}

export type HandlerResult = CommandResult | CommandError;

const PENDING = "__pending__";
const PENDING_MAX_MS = 5 * 60 * 1000;

export class CommandHandler {
  private usageWarnedKeys = new Set<string>();

  constructor(
    private config: ServerConfig,
    private sessionManager: SessionManager,
    private scheduler: Scheduler,
    private eventLog: RunEventLog,
    private stateMachine: StateMachine,
    private gitService: GitService,
    private notificationEngine?: NotificationEngine,
    private execService?: ExecService,
    private fileService?: FileService,
  ) {}

  async handle(raw: unknown, auth: AuthContext): Promise<HandlerResult> {
    return this.handleWithLock(raw, auth);
  }

  async handleWithLock(
    raw: unknown,
    auth: AuthContext,
  ): Promise<HandlerResult> {
    let command: NormalizedCommand;
    try {
      command = parseCommand(raw);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Invalid command payload";
      return { ok: false, error: validationFailed(message) };
    }

    await this.expireStalePending();

    const cached = await this.lookupIdempotency(command.requestId);
    if (cached) return cached;

    const acquired = await this.beginIdempotency(command.requestId);
    if (!acquired) {
      const retry = await this.lookupIdempotency(command.requestId);
      return (
        retry ?? {
          ok: false,
          error: {
            code: "conflict",
            message: "Duplicate request in progress",
            retryable: true,
          },
        }
      );
    }

    try {
      const result = await this.dispatch(command, auth);
      await prisma.idempotencyRecord.update({
        where: { requestId: command.requestId },
        data: {
          response: result.ok
            ? JSON.stringify(result.data)
            : JSON.stringify({ error: result.error }),
        },
      });
      return result;
    } catch (err) {
      await prisma.idempotencyRecord
        .delete({ where: { requestId: command.requestId } })
        .catch(() => undefined);
      throw err;
    }
  }

  private async lookupIdempotency(
    requestId: string,
  ): Promise<HandlerResult | null> {
    const existing = await prisma.idempotencyRecord.findUnique({
      where: { requestId },
    });
    if (!existing) return null;
    if (existing.response === PENDING) {
      return {
        ok: false,
        error: {
          code: "conflict",
          message: "Request is still processing",
          retryable: true,
        },
      };
    }
    const parsed = JSON.parse(existing.response) as Record<string, unknown>;
    if ("error" in parsed) {
      return { ok: false, error: parsed.error as AppError };
    }
    return { ok: true, data: parsed };
  }

  private async beginIdempotency(requestId: string): Promise<boolean> {
    try {
      await prisma.idempotencyRecord.create({
        data: { requestId, response: PENDING },
      });
      return true;
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        return false;
      }
      throw err;
    }
  }

  private async expireStalePending(): Promise<void> {
    const cutoff = new Date(Date.now() - PENDING_MAX_MS);
    await prisma.idempotencyRecord.deleteMany({
      where: { response: PENDING, createdAt: { lt: cutoff } },
    });
  }

  private async dispatch(
    command: NormalizedCommand,
    auth: AuthContext,
  ): Promise<HandlerResult> {
    switch (command.kind) {
      case "create_project":
        if (!auth.scopes.includes(ScopeEnum.PROJECT_WRITE)) {
          return { ok: false, error: forbidden() };
        }
        return this.createProject(command.name, auth.userId, command.gitUrl);

      case "create_session":
        if (!auth.scopes.includes(ScopeEnum.PROMPT_SEND)) {
          return { ok: false, error: forbidden() };
        }
        return this.createSession(
          auth.userId,
          command.projectId,
          command.model,
          command.title,
          command.source,
        );

      case "send_prompt":
        if (!auth.scopes.includes(ScopeEnum.PROMPT_SEND)) {
          return { ok: false, error: forbidden() };
        }
        return this.sendPrompt(
          auth.userId,
          command.sessionId,
          command.text,
          command.attachments,
        );

      case "cancel":
        if (!auth.scopes.includes(ScopeEnum.RUN_CANCEL)) {
          return { ok: false, error: forbidden() };
        }
        return this.cancelRun(auth.userId, command.runId);

      case "status":
        if (!auth.scopes.includes(ScopeEnum.PROJECT_READ)) {
          return { ok: false, error: forbidden() };
        }
        return this.status(auth.userId, command.scope, command.id);

      case "approve":
        if (!auth.scopes.includes(ScopeEnum.APPROVAL_RESOLVE)) {
          return { ok: false, error: forbidden() };
        }
        return this.approve(auth.userId, command.approvalId, command.decision);

      case "steer":
        if (!auth.scopes.includes(ScopeEnum.PROMPT_SEND)) {
          return { ok: false, error: forbidden() };
        }
        return this.steer(auth.userId, command.runId, command.text);

      case "exec_command":
        if (!auth.scopes.includes(ScopeEnum.TERMINAL_EXEC)) {
          return { ok: false, error: forbidden() };
        }
        return this.execCommand(
          auth.userId,
          command.projectId,
          command.command,
          command.cwd,
        );
    }
  }

  private async createProject(
    name: string,
    userId: string,
    gitUrl?: string,
  ): Promise<HandlerResult> {
    const projectId = uuidv4();
    const rootPath = path.join(this.config.workspaceRoot, projectId);

    try {
      if (gitUrl?.trim()) {
        this.gitService.assertRemoteAllowed(
          gitUrl.trim(),
          this.config.gitRemoteWhitelist,
        );
        await mkdir(this.config.workspaceRoot, { recursive: true });
        await this.gitService.cloneRepo(gitUrl.trim(), rootPath);
      } else {
        await this.gitService.initRepo(rootPath);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        error: {
          code: "validation_failed",
          message: `Repository setup failed: ${message}`,
          retryable: false,
        },
      };
    }

    const project = await prisma.project.create({
      data: {
        id: projectId,
        userId,
        name,
        rootPath,
        status: "active",
      },
    });

    return {
      ok: true,
      data: {
        projectId: project.id,
        name: project.name,
        rootPath: project.rootPath,
      },
    };
  }

  private async createSession(
    userId: string,
    projectId: string,
    model: string | undefined,
    title: string | undefined,
    source: string,
  ): Promise<HandlerResult> {
    const access = await assertProjectAccess(userId, projectId);
    if (!access.ok) return { ok: false, error: access.error };

    const project = await prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project) {
      return {
        ok: false,
        error: {
          code: "not_found",
          message: `Project ${projectId} not found`,
          retryable: false,
        },
      };
    }

    const session = await this.sessionManager.createSession(
      projectId,
      model ?? this.config.defaultModel,
      project.rootPath,
      source,
      title,
    );

    const branchName = this.gitService.sessionBranchName(session.id);
    let branchWarning: string | undefined;
    try {
      await this.gitService.createBranch(project.rootPath, branchName, true);
      await prisma.session.update({
        where: { id: session.id },
        data: { branch: branchName },
      });
    } catch (err) {
      branchWarning =
        err instanceof Error ? err.message : "Session branch creation failed";
    }

    return {
      ok: true,
      data: {
        sessionId: session.id,
        projectId: session.projectId,
        agentId: session.agentId,
        model: session.model,
        branch: branchWarning ? null : branchName,
        ...(branchWarning ? { branchWarning } : {}),
      },
    };
  }

  private async sendPrompt(
    userId: string,
    sessionId: string,
    text: string,
    attachments?: Array<{ kind: string; ref: string; mime?: string }>,
  ): Promise<HandlerResult> {
    const access = await assertSessionAccess(userId, sessionId);
    if (!access.ok) return { ok: false, error: access.error };

    const usage = await checkUsageLimit(userId, this.config.usageDailyLimit);
    if (!usage.allowed) {
      await this.notificationEngine?.notifyUsageAlert(
        userId,
        NotificationKind.QUOTA_EXCEEDED,
        usage.count,
        usage.limit,
      );
      return {
        ok: false,
        error: {
          code: "quota_exceeded",
          message: `Daily usage limit reached (${usage.count}/${usage.limit})`,
          retryable: false,
        },
      };
    }

    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      include: { project: true },
    });
    if (!session) {
      return {
        ok: false,
        error: {
          code: "not_found",
          message: "Session not found",
          retryable: false,
        },
      };
    }

    let displayText = text;
    let sdkInput: SdkPromptInput = text;
    if (attachments?.length && this.fileService) {
      try {
        const resolved = await resolvePromptWithAttachments(
          this.fileService,
          session.project.rootPath,
          text,
          attachments,
        );
        displayText = resolved.displayText;
        sdkInput = resolved.sdkInput;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Attachment resolve failed";
        return { ok: false, error: validationFailed(message) };
      }
    } else if (attachments?.length) {
      displayText = `${text}\n\n[attachments: ${attachments.map((a) => `${a.kind}:${a.ref}`).join(", ")}]`;
      sdkInput = displayText;
    }

    const messageContent = userMessageContent(text, attachments);

    const prepared = await this.sessionManager.prepareRun(
      sessionId,
      messageContent,
      serializeAttachmentsJson(attachments),
    );
    await this.sessionManager.recordQueued(prepared);

    await prisma.project.update({
      where: { id: prepared.projectId },
      data: { lastActiveAt: new Date() },
    });

    const priority = await this.computeJobPriority(prepared.projectId);

    const job: RunJob = {
      runId: prepared.runId,
      sessionId: prepared.sessionId,
      projectId: prepared.projectId,
      userId,
      priority,
      retryAttempt: 0,
      execute: () =>
        this.executeRunAttempt(userId, prepared, sdkInput, job),
    };

    const enqueueResult = this.scheduler.enqueue(job);

    if (!enqueueResult.accepted) {
      return {
        ok: false,
        error: {
          code: "queue_full",
          message: "Execution queue is full",
          retryable: true,
        },
      };
    }

    await recordUsage(userId, "send_prompt", prepared.projectId);
    void this.maybeNotifyUsageWarning(userId);

    return {
      ok: true,
      httpStatus: enqueueResult.queued ? 202 : 200,
      data: {
        runId: prepared.runId,
        sessionId: prepared.sessionId,
        queued: enqueueResult.queued,
      },
    };
  }

  private async steer(
    userId: string,
    runId: string,
    text: string,
  ): Promise<HandlerResult> {
    const access = await assertRunAccess(userId, runId);
    if (!access.ok) return { ok: false, error: access.error };

    const run = await prisma.run.findUnique({ where: { id: runId } });
    const active = ["queued", "running", "streaming", "waiting_approval"];
    if (!run || !active.includes(run.status)) {
      return {
        ok: false,
        error: {
          code: "conflict",
          message: "Run is not active",
          retryable: false,
        },
      };
    }

    return this.sendPrompt(userId, run.sessionId, `[steer] ${text}`);
  }

  /** 13 §8 + 17 — 헤드리스(어댑터) 명령 실행, WS 없이 결과 반환 */
  private async execCommand(
    userId: string,
    projectId: string,
    command: string,
    cwd?: string,
  ): Promise<HandlerResult> {
    if (!this.execService) {
      return {
        ok: false,
        error: {
          code: "internal_error",
          message: "Exec service not configured",
          retryable: false,
        },
      };
    }

    const access = await assertProjectAccess(userId, projectId);
    if (!access.ok) return { ok: false, error: access.error };

    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project || project.status !== "active") {
      return {
        ok: false,
        error: {
          code: "forbidden",
          message: "Project not available",
          retryable: false,
        },
      };
    }

    try {
      const result = await this.execService.runToCompletion({
        projectId,
        projectRoot: project.rootPath,
        command,
        cwd,
      });
      return {
        ok: true,
        data: {
          projectId,
          command,
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          ...(result.errorCode ? { errorCode: result.errorCode } : {}),
        },
      };
    } catch (err) {
      const code =
        err && typeof err === "object" && "code" in err
          ? String((err as { code: string }).code)
          : "internal_error";
      const retryable =
        err && typeof err === "object" && "retryable" in err
          ? Boolean((err as { retryable: boolean }).retryable)
          : false;
      return {
        ok: false,
        error: {
          code,
          message: err instanceof Error ? err.message : String(err),
          retryable,
        },
      };
    }
  }

  /** 08 §6.4: 단일 시도 후 scheduler.requeueWithBackoff로 backoff 재큐잉 */
  private async executeRunAttempt(
    userId: string,
    prepared: { runId: string; sessionId: string; projectId: string },
    sdkInput: SdkPromptInput,
    job: RunJob,
  ): Promise<void> {
    const attempt = job.retryAttempt ?? 0;
    const maxAttempts = this.config.maxRetryAttempts;
    const isLastAttempt = attempt >= maxAttempts - 1;

    const shouldRetry = await this.sessionManager.executeRun(
      prepared.runId,
      prepared.sessionId,
      prepared.projectId,
      sdkInput,
      { isLastAttempt },
    );
    if (!shouldRetry) return;

    if (isLastAttempt) return;

    await this.sessionManager.resetRunForRetry(prepared);
    this.scheduler.requeueWithBackoff(job, {
      attempt,
      maxAttempts,
      baseDelayMs: this.config.retryBackoffMs,
    });
  }

  private async approve(
    userId: string,
    approvalId: string,
    decision: "approve" | "reject",
  ): Promise<HandlerResult> {
    try {
      const result = await this.sessionManager.resolveApproval(
        userId,
        approvalId,
        decision,
      );
      return { ok: true, data: result };
    } catch (err) {
      const e = err as { code?: string; message?: string; retryable?: boolean };
      return {
        ok: false,
        error: {
          code: e.code ?? "internal_error",
          message: e.message ?? "Approval failed",
          retryable: e.retryable ?? false,
        },
      };
    }
  }

  private async cancelRun(
    userId: string,
    runId: string,
  ): Promise<HandlerResult> {
    const access = await assertRunAccess(userId, runId);
    if (!access.ok) return { ok: false, error: access.error };

    await this.sessionManager.cancelRun(runId);
    return { ok: true, data: { runId, cancelled: true } };
  }

  private async status(
    userId: string,
    scope: "all" | "project" | "session",
    id?: string,
  ): Promise<HandlerResult> {
    if (scope === "session" && id) {
      const access = await assertSessionAccess(userId, id);
      if (!access.ok) return { ok: false, error: access.error };
      const session = this.stateMachine.getSession(id);
      const dbSession = await prisma.session.findUnique({ where: { id } });
      return {
        ok: true,
        data: { session: dbSession, state: session },
      };
    }

    if (scope === "project" && id) {
      const access = await assertProjectAccess(userId, id);
      if (!access.ok) return { ok: false, error: access.error };
      const project = await prisma.project.findUnique({
        where: { id },
        include: { sessions: true },
      });
      return { ok: true, data: { project } };
    }

    const projects = await prisma.project.findMany({
      where: { status: "active", userId },
      include: { sessions: true },
      orderBy: { lastActiveAt: "desc" },
    });

    const runningSessions = projects.flatMap((p) =>
      p.sessions
        .filter((s) =>
          ["running", "waiting_approval", "streaming"].includes(s.status),
        )
        .map((s) => ({
          id: s.id,
          projectId: p.id,
          projectName: p.name,
          title: s.title,
          status: s.status,
        })),
    );

    return {
      ok: true,
      data: {
        projects,
        scheduler: {
          running: this.scheduler.getRunningCount(),
          queued: this.scheduler.getQueueLength(),
        },
        activeSessions: runningSessions.length,
        runningSessions,
      },
    };
  }

  private async computeJobPriority(projectId: string): Promise<number> {
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) return 0;
    let priority = 0;
    if (project.pinned) priority -= 10;
    if (project.lastActiveAt) {
      const ageMs = Date.now() - project.lastActiveAt.getTime();
      if (ageMs < 3_600_000) priority -= 5;
    }
    return priority;
  }

  private async maybeNotifyUsageWarning(userId: string): Promise<void> {
    if (!this.notificationEngine) return;
    this.pruneUsageWarnedKeys();
    const usage = await checkUsageLimit(userId, this.config.usageDailyLimit);
    const threshold = Math.floor(
      this.config.usageDailyLimit * this.config.usageWarningRatio,
    );
    if (usage.count < threshold || !usage.allowed) return;

    const dayKey = `${userId}:${startOfUtcDay().toISOString()}`;
    if (this.usageWarnedKeys.has(dayKey)) return;
    this.usageWarnedKeys.add(dayKey);

    await this.notificationEngine.notifyUsageAlert(
      userId,
      NotificationKind.QUOTA_WARNING,
      usage.count,
      usage.limit,
      24,
    );
  }

  private pruneUsageWarnedKeys(): void {
    const today = startOfUtcDay().toISOString();
    for (const key of this.usageWarnedKeys) {
      if (!key.endsWith(today)) this.usageWarnedKeys.delete(key);
    }
  }

  async replayEvents(
    userId: string,
    scope: "session" | "project" | "global",
    scopeId: string | undefined,
    cursor: number,
  ) {
    const access = await assertReplayAccess(userId, scope, scopeId);
    if (!access.ok) {
      throw access.error;
    }
    return this.eventLog.replay(scope, scopeId, cursor);
  }
}
