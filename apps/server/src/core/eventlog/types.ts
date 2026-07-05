import type {
  DomainEvent,
  EventEnvelope,
  SubscriptionScope,
} from "@app/shared";

export interface EventSubscriber {
  subscriberId: string;
  scope: SubscriptionScope;
  scopeId?: string;
  deliver: (envelope: EventEnvelope) => void | Promise<void>;
}

export type AppendListener = (envelope: EventEnvelope) => void | Promise<void>;

export interface AppendInput {
  runId: string;
  projectId: string;
  sessionId: string;
  event: DomainEvent;
}

export interface RunEventLog {
  append(input: AppendInput): Promise<EventEnvelope>;
  replay(
    scope: SubscriptionScope,
    scopeId: string | undefined,
    cursor: number,
  ): Promise<EventEnvelope[]>;
  subscribe(subscriber: EventSubscriber): void;
  unsubscribe(subscriberId: string): void;
  onAppend(listener: AppendListener): () => void;
}
