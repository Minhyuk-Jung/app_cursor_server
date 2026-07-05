import type { DomainEvent, EventEnvelope } from "@app/shared";
import { prisma } from "../../db/client.js";
import { deliverCustomWebhook } from "../../adapters/custom/custom-adapter.js";
import type { GitService } from "../../services/git/git-service.js";
import type { PushService } from "../../services/push/push-service.js";
import type { InboxHub, InboxPushItem } from "./inbox-hub.js";
import { msUntilQuietHoursEnd } from "./quiet-hours.js";
import { enrichRunDoneWithGit } from "./notification-git-enrich.js";

export type PushPayload = {
  kind: string;
  title: string;
  summary: string;
  deeplink: string;
};

interface DeferredPush {
  userId: string;
  payload: PushPayload;
}

export const NotificationKind = {
  ERROR: "error",
  APPROVAL_REQUIRED: "approval_required",
  REVIEW_READY: "review_ready",
  /** 16차 — run 완료 후 Git 탭 상태 알림 */
  GIT_STATUS: "git_status",
  RUN_DONE: "run_done",
  QUOTA_WARNING: "quota_warning",
  QUOTA_EXCEEDED: "quota_exceeded",
  /** 13 §9 — exec 시간 상한 초과 알림 */
  EXEC_TIMEOUT: "exec_timeout",
  /** 13 §9 — exec 메모리 상한 초과 (docker) */
  EXEC_MEMORY_LIMIT: "exec_memory_limit",
  INFO: "info",
} as const;

const PRIORITY: Record<string, number> = {
  error: 100,
  approval_required: 90,
  review_ready: 85,
  git_status: 82,
  quota_exceeded: 80,
  exec_timeout: 65,
  exec_memory_limit: 68,
  quota_warning: 70,
  run_done: 50,
  info: 10,
};

const QUIET_HOURS_PUSH_BYPASS = new Set<string>([NotificationKind.ERROR]);

export interface NotificationEngineOptions {
  groupWindowMs?: number;
  quietHoursStart?: number;
  quietHoursEnd?: number;
  git?: GitService;
  push?: PushService;
  onWebhook?: (payload: {
    kind: string;
    title: string;
    summary: string;
    deeplink: string;
  }) => Promise<void>;
  onTelegram?: (
    userId: string,
    payload: { kind: string; title: string; summary: string; deeplink: string },
  ) => Promise<void>;
  /** S31 — run_done 등 → 사내 메신저 notify URL */
  onIntranet?: (
    userId: string,
    payload: { kind: string; title: string; summary: string; deeplink: string },
  ) => Promise<void>;
}

export class NotificationEngine {
  private groupWindowMs: number;
  private quietHoursStart?: number;
  private quietHoursEnd?: number;
  private git?: GitService;
  private push?: PushService;
  private onWebhook?: NotificationEngineOptions["onWebhook"];
  private onTelegram?: NotificationEngineOptions["onTelegram"];
  private onIntranet?: NotificationEngineOptions["onIntranet"];
  private deferred: DeferredPush[] = [];
  private flushTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private inboxHub: InboxHub,
    options: NotificationEngineOptions = {},
  ) {
    this.groupWindowMs = options.groupWindowMs ?? 60_000;
    this.quietHoursStart = options.quietHoursStart;
    this.quietHoursEnd = options.quietHoursEnd;
    this.git = options.git;
    this.push = options.push;
    this.onWebhook = options.onWebhook;
    this.onTelegram = options.onTelegram;
    this.onIntranet = options.onIntranet;
  }

  async handleEnvelope(envelope: EventEnvelope): Promise<void> {
    let candidate = this.toCandidate(envelope.event, envelope);
    if (!candidate) return;

    candidate = await this.enrichCandidate(candidate, envelope);

    const userId = await this.resolveUserId(envelope.projectId);
    const suppressPush = this.shouldSuppressPush(candidate.kind);

    const groupKey = `${userId}:${candidate.kind}:${envelope.projectId}:${envelope.sessionId}`;
    const since = new Date(Date.now() - this.groupWindowMs);

    let saved: InboxPushItem;

    const existing = await prisma.notification.findFirst({
      where: {
        userId,
        groupKey,
        read: false,
        createdAt: { gte: since },
      },
      orderBy: { createdAt: "desc" },
    });

    if (existing && candidate.groupable) {
      const nextCount = existing.groupCount + 1;
      try {
        const updated = await prisma.notification.update({
          where: { id: existing.id },
          data: {
            groupCount: nextCount,
            summary: `${candidate.summary} (×${nextCount})`,
            createdAt: new Date(),
          },
        });
        saved = this.toPushItem(updated);
      } catch {
        const created = await prisma.notification.create({
          data: {
            userId,
            projectId: envelope.projectId,
            sessionId: envelope.sessionId,
            runId: envelope.runId,
            kind: candidate.kind,
            priority: candidate.priority,
            title: candidate.title,
            summary: candidate.summary,
            deeplink: candidate.deeplink,
            groupKey: candidate.groupable ? groupKey : null,
          },
        });
        saved = this.toPushItem(created);
      }
    } else {
      const created = await prisma.notification.create({
        data: {
          userId,
          projectId: envelope.projectId,
          sessionId: envelope.sessionId,
          runId: envelope.runId,
          kind: candidate.kind,
          priority: candidate.priority,
          title: candidate.title,
          summary: candidate.summary,
          deeplink: candidate.deeplink,
          groupKey: candidate.groupable ? groupKey : null,
        },
      });
      saved = this.toPushItem(created);
    }

    this.inboxHub.publish(saved);

    const payload = {
      kind: candidate.kind,
      title: candidate.title,
      summary: candidate.summary,
      deeplink: candidate.deeplink,
    };

    if (!suppressPush) {
      await this.dispatchExternal(userId, payload);
    } else {
      this.deferPush(userId, payload);
    }
  }

  /** 09 §6.3: 방해금지 중 보류 → 종료 후 flush */
  private deferPush(userId: string, payload: PushPayload): void {
    this.deferred.push({ userId, payload });
    this.scheduleDeferredFlush();
  }

  private scheduleDeferredFlush(): void {
    if (this.quietHoursStart === undefined || this.quietHoursEnd === undefined) {
      return;
    }
    const delay = msUntilQuietHoursEnd(
      this.quietHoursStart,
      this.quietHoursEnd,
    );
    if (delay <= 0) {
      void this.flushDeferred();
      return;
    }
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      void this.flushDeferred();
    }, delay);
  }

  async flushDeferred(): Promise<void> {
    if (
      this.quietHoursStart !== undefined &&
      this.quietHoursEnd !== undefined &&
      msUntilQuietHoursEnd(this.quietHoursStart, this.quietHoursEnd) > 0
    ) {
      this.scheduleDeferredFlush();
      return;
    }
    const pending = this.deferred.splice(0);
    for (const item of pending) {
      await this.dispatchExternal(item.userId, item.payload);
    }
  }

  /** 테스트용 */
  getDeferredCount(): number {
    return this.deferred.length;
  }

  private async dispatchExternal(
    userId: string,
    payload: PushPayload,
  ): Promise<void> {
    await this.dispatchWebhooks(userId, payload);

    if (this.onTelegram) {
      void this.onTelegram(userId, payload).catch(() => undefined);
    }

    if (this.onIntranet) {
      void this.onIntranet(userId, payload).catch(() => undefined);
    }

    if (this.push) {
      void this.push
        .sendToUser(userId, {
          title: payload.title,
          body: payload.summary,
          deeplink: payload.deeplink,
          kind: payload.kind,
        })
        .catch(() => undefined);
    }
  }

  /** 09 §5.2: run 완료 후 git 변경 있으면 review_ready */
  private async enrichCandidate(
    candidate: {
      kind: string;
      priority: number;
      title: string;
      summary: string;
      deeplink: string;
      groupable: boolean;
    },
    envelope: EventEnvelope,
  ) {
    if (
      candidate.kind !== NotificationKind.RUN_DONE ||
      envelope.event.type !== "run_done" ||
      envelope.event.status !== "finished" ||
      !this.git
    ) {
      return candidate;
    }

    const project = await prisma.project.findUnique({
      where: { id: envelope.projectId },
      select: { rootPath: true },
    });
    if (!project) return candidate;

    try {
      const changes = await this.git.listChanges(project.rootPath);
      const status = await this.git.getRepoStatus(project.rootPath);

      return enrichRunDoneWithGit(candidate, envelope.projectId, {
        listChanges: changes,
        stagedCount: status.stagedCount,
        unstagedCount: status.unstagedCount,
      });
    } catch {
      return candidate;
    }
  }

  /** 09 §6.3: 방해금지 중 외부 채널(푸시·웹훅·메신저)만 보류. error는 예외 */
  shouldSuppressPush(kind: string): boolean {
    if (this.quietHoursStart === undefined || this.quietHoursEnd === undefined) {
      return false;
    }
    if (QUIET_HOURS_PUSH_BYPASS.has(kind)) return false;

    const hour = new Date().getHours();
    const start = this.quietHoursStart;
    const end = this.quietHoursEnd;

    if (start <= end) {
      return hour >= start && hour < end;
    }
    return hour >= start || hour < end;
  }

  /** @deprecated use shouldSuppressPush — 테스트 호환 */
  isQuietHours(kind: string): boolean {
    return this.shouldSuppressPush(kind);
  }

  private async dispatchWebhooks(
    userId: string,
    payload: { kind: string; title: string; summary: string; deeplink: string },
  ): Promise<void> {
    const subs = await prisma.webhookSubscription.findMany({
      where: { userId, active: true },
    });

    const deliveries = subs.map((sub) =>
      deliverCustomWebhook(sub.targetUrl, payload).catch(() => undefined),
    );

    if (this.onWebhook) {
      deliveries.push(this.onWebhook(payload).catch(() => undefined));
    }

    await Promise.all(deliveries);
  }

  private toCandidate(
    event: DomainEvent,
    envelope: EventEnvelope,
  ):
    | {
        kind: string;
        priority: number;
        title: string;
        summary: string;
        deeplink: string;
        groupable: boolean;
      }
    | null {
    const deeplink = `/project/${envelope.projectId}/session/${envelope.sessionId}`;

    switch (event.type) {
      case "approval_required":
        return {
          kind: NotificationKind.APPROVAL_REQUIRED,
          priority: PRIORITY.approval_required!,
          title: "승인 필요 (실행 중)",
          summary: event.detail.slice(0, 200),
          deeplink,
          groupable: false,
        };
      case "run_done":
        if (event.status === "finished") {
          return {
            kind: NotificationKind.RUN_DONE,
            priority: PRIORITY.run_done!,
            title: "실행 완료",
            summary: `run ${envelope.runId.slice(0, 8)} finished`,
            deeplink,
            groupable: true,
          };
        }
        if (event.status === "error") {
          return {
            kind: NotificationKind.ERROR,
            priority: PRIORITY.error!,
            title: "실행 오류",
            summary: `run ${envelope.runId.slice(0, 8)} failed`,
            deeplink,
            groupable: true,
          };
        }
        return null;
      case "error":
        return {
          kind: NotificationKind.ERROR,
          priority: PRIORITY.error!,
          title: "오류",
          summary: event.message.slice(0, 200),
          deeplink,
          groupable: true,
        };
      default:
        return null;
    }
  }

  private async resolveUserId(projectId: string): Promise<string> {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { userId: true },
    });
    return project?.userId ?? "dev-user";
  }

  private toPushItem(row: {
    id: string;
    kind: string;
    title: string;
    summary: string;
    deeplink: string;
    priority: number;
    read: boolean;
    groupCount: number;
    projectId: string | null;
    sessionId: string | null;
    createdAt: Date;
  }): InboxPushItem {
    return {
      id: row.id,
      kind: row.kind,
      title: row.title,
      summary: row.summary,
      deeplink: row.deeplink,
      priority: row.priority,
      read: row.read,
      groupCount: row.groupCount,
      projectId: row.projectId,
      sessionId: row.sessionId,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** S24: 사용량 경고·초과 알림 (인박스 + 외부 채널). dedupHours 내 동일 kind는 1회만 */
  async notifyUsageAlert(
    userId: string,
    kind: typeof NotificationKind.QUOTA_WARNING | typeof NotificationKind.QUOTA_EXCEEDED,
    count: number,
    limit: number,
    dedupHours = 1,
  ): Promise<boolean> {
    const since = new Date(Date.now() - dedupHours * 3_600_000);
    const existing = await prisma.notification.findFirst({
      where: { userId, kind, createdAt: { gte: since } },
    });
    if (existing) return false;

    const isExceeded = kind === NotificationKind.QUOTA_EXCEEDED;
    const title = isExceeded ? "일일 사용량 초과" : "일일 사용량 경고";
    const summary = isExceeded
      ? `한도 ${limit}회 중 ${count}회 사용 — 추가 실행이 차단됩니다`
      : `한도 ${limit}회 중 ${count}회 사용 (${Math.round((count / limit) * 100)}%)`;
    const deeplink = "/usage";
    const priority = PRIORITY[kind] ?? 10;

    const created = await prisma.notification.create({
      data: {
        userId,
        kind,
        priority,
        title,
        summary,
        deeplink,
        read: false,
      },
    });
    const saved = this.toPushItem(created);
    this.inboxHub.publish(saved);

    const payload = { kind, title, summary, deeplink };
    if (!this.shouldSuppressPush(kind)) {
      await this.dispatchExternal(userId, payload);
    } else {
      this.deferPush(userId, payload);
    }
    return true;
  }

  /** 13 §9 — exec 자원(시간·메모리) 상한 초과 알림 */
  async notifyExecResourceLimit(
    userId: string,
    projectId: string,
    projectName: string,
    command: string,
    kind: typeof NotificationKind.EXEC_TIMEOUT | typeof NotificationKind.EXEC_MEMORY_LIMIT,
    dedupMinutes = 5,
  ): Promise<boolean> {
    const since = new Date(Date.now() - dedupMinutes * 60_000);
    const existing = await prisma.notification.findFirst({
      where: { userId, kind, projectId, createdAt: { gte: since } },
    });
    if (existing) return false;

    const title =
      kind === NotificationKind.EXEC_MEMORY_LIMIT
        ? "터미널 명령 메모리 상한 초과"
        : "터미널 명령 시간 초과";
    const summary =
      kind === NotificationKind.EXEC_MEMORY_LIMIT
        ? `프로젝트 "${projectName}" — 명령이 메모리 상한을 초과해 종료되었습니다: ${command.slice(0, 120)}`
        : `프로젝트 "${projectName}" — 명령이 시간 상한을 초과해 종료되었습니다: ${command.slice(0, 120)}`;
    const deeplink = `/project/${projectId}/terminal`;
    const priority = PRIORITY[kind] ?? 10;

    const created = await prisma.notification.create({
      data: {
        userId,
        projectId,
        kind,
        priority,
        title,
        summary,
        deeplink,
        read: false,
      },
    });
    const saved = this.toPushItem(created);
    this.inboxHub.publish(saved);

    const payload = { kind, title, summary, deeplink };
    if (!this.shouldSuppressPush(kind)) {
      await this.dispatchExternal(userId, payload);
    } else {
      this.deferPush(userId, payload);
    }
    return true;
  }

  /** @deprecated use notifyExecResourceLimit */
  async notifyExecTimeout(
    userId: string,
    projectId: string,
    projectName: string,
    command: string,
    dedupMinutes = 5,
  ): Promise<boolean> {
    return this.notifyExecResourceLimit(
      userId,
      projectId,
      projectName,
      command,
      NotificationKind.EXEC_TIMEOUT,
      dedupMinutes,
    );
  }
}

