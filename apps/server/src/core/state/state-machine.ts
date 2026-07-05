import { Prisma } from "@prisma/client";
import type { DomainEvent, EventEnvelope, RunStatus, SessionStatus } from "@app/shared";
import {
  RunStatus as RunStatusEnum,
  SessionStatus as SessionStatusEnum,
} from "@app/shared";
import { prisma } from "../../db/client.js";

export interface RunState {
  runId: string;
  sessionId: string;
  status: RunStatus;
}

export interface SessionStateView {
  sessionId: string;
  status: SessionStatus;
  activeRunId?: string;
}

type SlotReleaseListener = (runId: string) => void;

const STREAMING_EVENTS = new Set([
  "assistant",
  "tool",
  "plan",
  "file_change",
]);

export class StateMachine {
  private runs = new Map<string, RunState>();
  private sessions = new Map<string, SessionStateView>();
  private slotReleaseListener?: SlotReleaseListener;

  onSlotRelease(listener: SlotReleaseListener): void {
    this.slotReleaseListener = listener;
  }

  getRun(runId: string): RunState | undefined {
    return this.runs.get(runId);
  }

  getSession(sessionId: string): SessionStateView | undefined {
    return this.sessions.get(sessionId);
  }

  registerQueuedRun(runId: string, sessionId: string): void {
    this.runs.set(runId, { runId, sessionId, status: RunStatusEnum.QUEUED });
  }

  async hydrate(): Promise<void> {
    const activeRuns = await prisma.run.findMany({
      where: {
        status: {
          in: [
            RunStatusEnum.QUEUED,
            RunStatusEnum.RUNNING,
            RunStatusEnum.STREAMING,
            RunStatusEnum.WAITING_APPROVAL,
          ],
        },
      },
    });
    for (const run of activeRuns) {
      this.runs.set(run.id, {
        runId: run.id,
        sessionId: run.sessionId,
        status: run.status as RunStatus,
      });
    }

    const sessions = await prisma.session.findMany();
    for (const session of sessions) {
      this.sessions.set(session.id, {
        sessionId: session.id,
        status: session.status as SessionStatus,
      });
    }
  }

  apply(envelope: EventEnvelope): boolean {
    return this.applyTransition(envelope.event);
  }

  async consume(envelope: EventEnvelope): Promise<boolean> {
    const accepted = this.applyTransition(envelope.event);
    if (accepted) {
      try {
        await this.persist(envelope.event);
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2025"
        ) {
          return accepted;
        }
        throw err;
      }
    }
    return accepted;
  }

  private applyTransition(event: DomainEvent): boolean {
    switch (event.type) {
      case "run_queued": {
        this.runs.set(event.runId, {
          runId: event.runId,
          sessionId: event.sessionId,
          status: RunStatusEnum.QUEUED,
        });
        return true;
      }

      case "run_started": {
        const run = this.runs.get(event.runId);
        if (run && run.status !== RunStatusEnum.QUEUED) return false;
        this.runs.set(event.runId, {
          runId: event.runId,
          sessionId: event.sessionId,
          status: RunStatusEnum.RUNNING,
        });
        const session = this.ensureSession(event.sessionId);
        session.status = SessionStatusEnum.RUNNING;
        session.activeRunId = event.runId;
        return true;
      }

      case "assistant":
      case "tool":
      case "plan":
      case "file_change": {
        const run = this.runs.get(event.runId);
        if (!run) return false;
        if (
          run.status !== RunStatusEnum.RUNNING &&
          run.status !== RunStatusEnum.STREAMING
        ) {
          return false;
        }
        run.status = RunStatusEnum.STREAMING;
        return true;
      }

      case "approval_required": {
        const run = this.runs.get(event.runId);
        if (!run) return false;
        if (
          run.status !== RunStatusEnum.RUNNING &&
          run.status !== RunStatusEnum.STREAMING
        ) {
          return false;
        }
        run.status = RunStatusEnum.WAITING_APPROVAL;
        const session = this.ensureSession(run.sessionId);
        session.status = SessionStatusEnum.WAITING_APPROVAL;
        return true;
      }

      case "approval_resolved": {
        const run = this.runs.get(event.runId);
        if (!run || run.status !== RunStatusEnum.WAITING_APPROVAL) return false;
        if (event.decision === "reject") {
          return true;
        }
        run.status = RunStatusEnum.STREAMING;
        const session = this.ensureSession(run.sessionId);
        session.status = SessionStatusEnum.RUNNING;
        return true;
      }

      case "run_done": {
        const run = this.runs.get(event.runId);
        if (!run) return false;
        const terminal =
          event.status === "finished"
            ? RunStatusEnum.FINISHED
            : event.status === "cancelled"
              ? RunStatusEnum.CANCELLED
              : RunStatusEnum.ERROR;
        if (
          run.status === RunStatusEnum.FINISHED ||
          run.status === RunStatusEnum.CANCELLED
        ) {
          return false;
        }
        run.status = terminal;
        const session = this.ensureSession(run.sessionId);
        session.status =
          event.status === "finished" || event.status === "cancelled"
            ? SessionStatusEnum.IDLE
            : SessionStatusEnum.ERROR;
        session.activeRunId = undefined;
        this.slotReleaseListener?.(event.runId);
        return true;
      }

      case "error": {
        if (!event.runId) return false;
        const run = this.runs.get(event.runId);
        if (!run) return false;
        run.status = RunStatusEnum.ERROR;
        const session = this.ensureSession(run.sessionId);
        session.status = SessionStatusEnum.ERROR;
        session.activeRunId = undefined;
        return true;
      }

      default:
        return false;
    }
  }

  private ensureSession(sessionId: string): SessionStateView {
    let s = this.sessions.get(sessionId);
    if (!s) {
      s = { sessionId, status: SessionStatusEnum.IDLE };
      this.sessions.set(sessionId, s);
    }
    return s;
  }

  private async persist(event: DomainEvent): Promise<void> {
    if (event.type === "run_queued") {
      await prisma.run.update({
        where: { id: event.runId },
        data: { status: RunStatusEnum.QUEUED },
      });
      return;
    }

    if (event.type === "run_started") {
      await prisma.run.update({
        where: { id: event.runId },
        data: { status: RunStatusEnum.RUNNING },
      });
      await prisma.session.update({
        where: { id: event.sessionId },
        data: { status: SessionStatusEnum.RUNNING },
      });
      return;
    }

    if (STREAMING_EVENTS.has(event.type)) {
      await prisma.run.update({
        where: { id: event.runId },
        data: { status: RunStatusEnum.STREAMING },
      });
      return;
    }

    if (event.type === "approval_required") {
      await prisma.run.update({
        where: { id: event.runId },
        data: { status: RunStatusEnum.WAITING_APPROVAL },
      });
      const run = this.runs.get(event.runId);
      if (run) {
        await prisma.session.update({
          where: { id: run.sessionId },
          data: { status: SessionStatusEnum.WAITING_APPROVAL },
        });
      }
      return;
    }

    if (event.type === "approval_resolved") {
      if (event.decision === "approve") {
        await prisma.run.update({
          where: { id: event.runId },
          data: { status: RunStatusEnum.STREAMING },
        });
        const run = this.runs.get(event.runId);
        if (run) {
          await prisma.session.update({
            where: { id: run.sessionId },
            data: { status: SessionStatusEnum.RUNNING },
          });
        }
      }
      return;
    }

    if (event.type === "run_done") {
      await prisma.run.update({
        where: { id: event.runId },
        data: { status: event.status },
      });
      const run = this.runs.get(event.runId);
      if (run) {
        await prisma.session.update({
          where: { id: run.sessionId },
          data: {
            status:
              event.status === "finished" || event.status === "cancelled"
                ? SessionStatusEnum.IDLE
                : SessionStatusEnum.ERROR,
          },
        });
      }
      return;
    }

    if (event.type === "error" && event.runId) {
      await prisma.run.update({
        where: { id: event.runId },
        data: { status: RunStatusEnum.ERROR },
      });
      const run = this.runs.get(event.runId);
      if (run) {
        await prisma.session.update({
          where: { id: run.sessionId },
          data: { status: SessionStatusEnum.ERROR },
        });
      }
    }
  }
}
