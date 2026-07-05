export interface InboxPushItem {
  id: string;
  kind: string;
  title: string;
  summary: string;
  deeplink: string;
  priority: number;
  read: boolean;
  groupCount: number;
  projectId?: string | null;
  sessionId?: string | null;
  createdAt: string;
}

type InboxListener = (item: InboxPushItem) => void;

export class InboxHub {
  private listeners = new Set<InboxListener>();

  subscribe(listener: InboxListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish(item: InboxPushItem): void {
    for (const listener of this.listeners) {
      listener(item);
    }
  }
}
