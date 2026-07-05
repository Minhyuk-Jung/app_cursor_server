import { RunStatus as RunStatusEnum } from "@app/shared";

export interface RunJob {
  runId: string;
  sessionId: string;
  projectId: string;
  userId?: string;
  priority: number;
  notBefore?: number;
  retryAttempt?: number;
  execute: () => Promise<void>;
}

export interface EnqueueResult {
  accepted: boolean;
  queued: boolean;
  reason?: string;
}

export interface RequeueOptions {
  attempt: number;
  maxAttempts: number;
  baseDelayMs: number;
}

export type BeforeApproveHook = (job: RunJob) => Promise<boolean>;

export interface SchedulerMetrics {
  running: number;
  queued: number;
  maxConcurrent: number;
}

export class Scheduler {
  private queue: RunJob[] = [];
  private running = new Map<string, RunJob>();
  private maxConcurrent: number;
  private perProjectMax: number;
  private perUserMax: number;
  private queueLimit: number;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private beforeApprove?: BeforeApproveHook;

  constructor(
    maxConcurrent = 3,
    queueLimit = 100,
    perProjectMax = 1,
    perUserMax = 999,
  ) {
    this.maxConcurrent = maxConcurrent;
    this.perProjectMax = perProjectMax;
    this.perUserMax = perUserMax;
    this.queueLimit = queueLimit;
  }

  enqueue(job: RunJob): EnqueueResult {
    if (this.running.size + this.queue.length >= this.queueLimit) {
      return { accepted: false, queued: false, reason: "queue_full" };
    }

    this.queue.push(job);
    this.sortQueue();
    const wasRunning = this.running.has(job.runId);
    this.tryApproveNext();

    return {
      accepted: true,
      queued: !wasRunning && !this.running.has(job.runId),
    };
  }

  /** 08 §6.4: 재시도 가능 실패 시 backoff 후 재큐잉 */
  requeueWithBackoff(job: RunJob, options: RequeueOptions): EnqueueResult {
    if (options.attempt >= options.maxAttempts) {
      return {
        accepted: false,
        queued: false,
        reason: "max_retries_exceeded",
      };
    }

    const delayMs = options.baseDelayMs * 2 ** options.attempt;
    job.notBefore = Date.now() + delayMs;
    job.retryAttempt = options.attempt + 1;
    return this.enqueue(job);
  }

  getRunningCount(): number {
    return this.running.size;
  }

  getRunningCountForProject(projectId: string): number {
    let count = 0;
    for (const job of this.running.values()) {
      if (job.projectId === projectId) count++;
    }
    return count;
  }

  getRunningCountForUser(userId: string): number {
    let count = 0;
    for (const job of this.running.values()) {
      if (job.userId === userId) count++;
    }
    return count;
  }

  getQueueLength(): number {
    return this.queue.length;
  }

  getMetrics(): SchedulerMetrics {
    return {
      running: this.running.size,
      queued: this.queue.length,
      maxConcurrent: this.maxConcurrent,
    };
  }

  setBeforeApprove(hook: BeforeApproveHook): void {
    this.beforeApprove = hook;
  }

  /** 08 §9: DB에 없는 runId 슬롯 해제 */
  reconcileOrphans(expectedRunningRunIds: Set<string>): number {
    let fixed = 0;
    for (const runId of this.running.keys()) {
      if (!expectedRunningRunIds.has(runId)) {
        this.running.delete(runId);
        fixed++;
      }
    }
    if (fixed > 0) this.tryApproveNext();
    return fixed;
  }

  isRunning(runId: string): boolean {
    return this.running.has(runId);
  }

  releaseSlot(runId: string): void {
    if (!this.running.has(runId)) return;
    this.running.delete(runId);
    this.tryApproveNext();
  }

  private sortQueue(): void {
    this.queue.sort((a, b) => {
      const aReady = this.isNotBeforeReady(a) ? 0 : 1;
      const bReady = this.isNotBeforeReady(b) ? 0 : 1;
      if (aReady !== bReady) return aReady - bReady;
      return a.priority - b.priority;
    });
  }

  private isNotBeforeReady(job: RunJob): boolean {
    return !job.notBefore || Date.now() >= job.notBefore;
  }

  private isEligible(job: RunJob): boolean {
    if (!this.isNotBeforeReady(job)) return false;
    if (this.getRunningCountForProject(job.projectId) >= this.perProjectMax) {
      return false;
    }
    if (job.userId && this.getRunningCountForUser(job.userId) >= this.perUserMax) {
      return false;
    }
    return true;
  }

  private scheduleRetryWake(): void {
    const nextAt = this.queue
      .filter((job) => job.notBefore && job.notBefore > Date.now())
      .map((job) => job.notBefore!)
      .sort((a, b) => a - b)[0];

    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
    }
    if (nextAt === undefined) return;

    const delay = Math.max(0, nextAt - Date.now()) + 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      this.tryApproveNext();
      this.scheduleRetryWake();
    }, delay);
  }

  private tryApproveNext(): void {
    void this.tryApproveNextAsync();
  }

  private async tryApproveNextAsync(): Promise<void> {
    while (this.running.size < this.maxConcurrent && this.queue.length > 0) {
      const idx = this.queue.findIndex((job) => this.isEligible(job));
      if (idx < 0) break;

      const next = this.queue.splice(idx, 1)[0];
      if (!next) break;

      if (this.beforeApprove) {
        const allowed = await this.beforeApprove(next);
        if (!allowed) continue;
      }

      this.running.set(next.runId, next);
      void next.execute();
    }
    this.scheduleRetryWake();
  }
}

export function mapRunStatusToQueued(status: string): boolean {
  return status === RunStatusEnum.QUEUED;
}
