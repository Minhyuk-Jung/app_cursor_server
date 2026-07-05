import type {
  DomainEvent,
  EventEnvelope,
  SubscriptionScope,
} from "@app/shared";
import { prisma } from "../../db/client.js";
import type {
  AppendInput,
  AppendListener,
  EventSubscriber,
  RunEventLog,
} from "./types.js";

export class PrismaRunEventLog implements RunEventLog {
  private subscribers = new Map<string, EventSubscriber>();
  private appendListeners = new Set<AppendListener>();
  private globalOffset = 0;
  private runSeq = new Map<string, number>();
  private initialized = false;

  onAppend(listener: AppendListener): () => void {
    this.appendListeners.add(listener);
    return () => this.appendListeners.delete(listener);
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    const maxGlobal = await prisma.runEvent.aggregate({
      _max: { globalOffset: true },
    });
    this.globalOffset = maxGlobal._max.globalOffset ?? 0;

    const runs = await prisma.runEvent.groupBy({
      by: ["runId"],
      _max: { seq: true },
    });
    for (const row of runs) {
      if (row._max.seq != null) {
        this.runSeq.set(row.runId, row._max.seq);
      }
    }
    this.initialized = true;
  }

  async append(input: AppendInput): Promise<EventEnvelope> {
    await this.init();

    const nextSeq = (this.runSeq.get(input.runId) ?? 0) + 1;
    this.runSeq.set(input.runId, nextSeq);
    this.globalOffset += 1;

    const envelope: EventEnvelope = {
      globalOffset: this.globalOffset,
      runId: input.runId,
      seq: nextSeq,
      at: new Date().toISOString(),
      event: input.event,
      projectId: input.projectId,
      sessionId: input.sessionId,
    };

    await prisma.runEvent.create({
      data: {
        globalOffset: envelope.globalOffset,
        runId: envelope.runId,
        seq: envelope.seq,
        type: envelope.event.type,
        payload: JSON.stringify(envelope.event),
        projectId: envelope.projectId,
        sessionId: envelope.sessionId,
      },
    });

    await this.notifyAppendListeners(envelope);
    await this.fanOut(envelope);
    return envelope;
  }

  async replay(
    scope: SubscriptionScope,
    scopeId: string | undefined,
    cursor: number,
  ): Promise<EventEnvelope[]> {
    await this.init();

    if (scope === "session" && scopeId) {
      const rows = await prisma.runEvent.findMany({
        where: { sessionId: scopeId, seq: { gt: cursor } },
        orderBy: { seq: "asc" },
      });
      return rows.map(rowToEnvelope);
    }

    if (scope === "project" && scopeId) {
      const rows = await prisma.runEvent.findMany({
        where: { projectId: scopeId, globalOffset: { gt: cursor } },
        orderBy: { globalOffset: "asc" },
      });
      return rows.map(rowToEnvelope);
    }

    const rows = await prisma.runEvent.findMany({
      where: { globalOffset: { gt: cursor } },
      orderBy: { globalOffset: "asc" },
    });
    return rows.map(rowToEnvelope);
  }

  subscribe(subscriber: EventSubscriber): void {
    this.subscribers.set(subscriber.subscriberId, subscriber);
  }

  unsubscribe(subscriberId: string): void {
    this.subscribers.delete(subscriberId);
  }

  private async notifyAppendListeners(envelope: EventEnvelope): Promise<void> {
    for (const listener of this.appendListeners) {
      await listener(envelope);
    }
  }

  private async fanOut(envelope: EventEnvelope): Promise<void> {
    for (const sub of this.subscribers.values()) {
      if (this.matchesScope(envelope, sub.scope, sub.scopeId)) {
        await sub.deliver(envelope);
      }
    }
  }

  private matchesScope(
    envelope: EventEnvelope,
    scope: SubscriptionScope,
    scopeId?: string,
  ): boolean {
    if (scope === "global") return true;
    if (scope === "project") return envelope.projectId === scopeId;
    if (scope === "session") return envelope.sessionId === scopeId;
    return false;
  }
}

function rowToEnvelope(row: {
  globalOffset: number;
  runId: string;
  seq: number;
  createdAt: Date;
  payload: string;
  projectId: string;
  sessionId: string;
}): EventEnvelope {
  return {
    globalOffset: row.globalOffset,
    runId: row.runId,
    seq: row.seq,
    at: row.createdAt.toISOString(),
    event: JSON.parse(row.payload) as DomainEvent,
    projectId: row.projectId,
    sessionId: row.sessionId,
  };
}
