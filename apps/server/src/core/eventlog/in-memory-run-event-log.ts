import type {
  EventEnvelope,
  SubscriptionScope,
} from "@app/shared";
import type {
  AppendInput,
  AppendListener,
  EventSubscriber,
  RunEventLog,
} from "./types.js";

export class InMemoryRunEventLog implements RunEventLog {
  private envelopes: EventEnvelope[] = [];
  private runSeq = new Map<string, number>();
  private globalOffset = 0;
  private subscribers = new Map<string, EventSubscriber>();
  private appendListeners = new Set<AppendListener>();

  onAppend(listener: AppendListener): () => void {
    this.appendListeners.add(listener);
    return () => this.appendListeners.delete(listener);
  }

  async append(input: AppendInput): Promise<EventEnvelope> {
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

    this.envelopes.push(envelope);
    await this.notifyAppendListeners(envelope);
    await this.fanOut(envelope);
    return envelope;
  }

  async replay(
    scope: SubscriptionScope,
    scopeId: string | undefined,
    cursor: number,
  ): Promise<EventEnvelope[]> {
    const filtered = this.envelopes.filter((e) =>
      this.matchesScope(e, scope, scopeId),
    );

    if (scope === "session") {
      return filtered
        .filter((e) => e.seq > cursor)
        .sort((a, b) => a.seq - b.seq);
    }
    return filtered
      .filter((e) => e.globalOffset > cursor)
      .sort((a, b) => a.globalOffset - b.globalOffset);
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

  private async fanOut(envelope: EventEnvelope): Promise<void> {
    for (const sub of this.subscribers.values()) {
      if (this.matchesScope(envelope, sub.scope, sub.scopeId)) {
        await sub.deliver(envelope);
      }
    }
  }
}

export type { AppendInput, EventSubscriber, RunEventLog } from "./types.js";
