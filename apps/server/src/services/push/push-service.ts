import webpush from "web-push";
import { prisma } from "../../db/client.js";
import {
  getExpoPushReceipts,
  isValidExpoPushToken,
  sendExpoPushMessages,
} from "./expo-push.js";
import {
  EXPO_RECEIPT_DELAYS_MS,
  EXPO_RECEIPT_MAX_ATTEMPTS,
  partitionExpoReceipts,
  type ExpoReceiptPair,
} from "./expo-receipt-scheduler.js";

export interface PushServiceConfig {
  vapidPublicKey: string;
  vapidPrivateKey: string;
  vapidSubject: string;
}

export class PushService {
  private webPushEnabled: boolean;
  private processingReceiptTickets = new Set<string>();

  constructor(private config: PushServiceConfig) {
    this.webPushEnabled = Boolean(config.vapidPublicKey && config.vapidPrivateKey);
    if (this.webPushEnabled) {
      webpush.setVapidDetails(
        config.vapidSubject,
        config.vapidPublicKey,
        config.vapidPrivateKey,
      );
    }
    void this.resumePendingReceipts();
  }

  isEnabled(): boolean {
    return this.webPushEnabled;
  }

  isExpoEnabled(): boolean {
    return true;
  }

  getPublicKey(): string | null {
    return this.webPushEnabled ? this.config.vapidPublicKey : null;
  }

  async subscribe(
    userId: string,
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  ): Promise<void> {
    await prisma.pushSubscription.upsert({
      where: { endpoint: subscription.endpoint },
      create: {
        userId,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
      },
      update: {
        userId,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
      },
    });
  }

  async unsubscribe(userId: string, endpoint: string): Promise<void> {
    await prisma.pushSubscription.deleteMany({
      where: { userId, endpoint },
    });
  }

  async subscribeExpo(userId: string, token: string): Promise<void> {
    const trimmed = token.trim();
    if (!isValidExpoPushToken(trimmed)) {
      throw new Error("Invalid Expo push token format");
    }
    await prisma.expoPushToken.upsert({
      where: { token: trimmed },
      create: { userId, token: trimmed },
      update: { userId },
    });
  }

  async unsubscribeExpo(userId: string, token: string): Promise<void> {
    await prisma.expoPushToken.deleteMany({
      where: { userId, token: token.trim() },
    });
  }

  async sendToUser(
    userId: string,
    payload: {
      title: string;
      body: string;
      deeplink?: string;
      kind?: string;
    },
  ): Promise<void> {
    await Promise.all([
      this.sendWebPushToUser(userId, payload),
      this.sendExpoToUser(userId, payload),
    ]);
  }

  private async sendWebPushToUser(
    userId: string,
    payload: { title: string; body: string; deeplink?: string },
  ): Promise<void> {
    if (!this.webPushEnabled) return;

    const subs = await prisma.pushSubscription.findMany({
      where: { userId },
    });

    const body = JSON.stringify({
      title: payload.title,
      body: payload.body,
      summary: payload.body,
      deeplink: payload.deeplink,
    });

    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          body,
        );
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await prisma.pushSubscription.delete({ where: { id: sub.id } });
        }
      }
    }
  }

  private async sendExpoToUser(
    userId: string,
    payload: {
      title: string;
      body: string;
      deeplink?: string;
      kind?: string;
    },
  ): Promise<void> {
    const tokens = await prisma.expoPushToken.findMany({
      where: { userId },
    });
    if (tokens.length === 0) return;

    const data: Record<string, string> = {};
    if (payload.deeplink) data.deeplink = payload.deeplink;
    if (payload.kind) data.kind = payload.kind;
    const sessionMatch = payload.deeplink?.match(
      /^\/project\/([^/]+)\/session\/([^/]+)/,
    );
    if (sessionMatch?.[1]) data.projectId = sessionMatch[1];
    if (sessionMatch?.[2]) data.sessionId = sessionMatch[2];

    const messages = tokens.map((row) => ({
      to: row.token,
      title: payload.title,
      body: payload.body,
      data: Object.keys(data).length > 0 ? data : undefined,
    }));

    try {
      const tickets = await sendExpoPushMessages(messages);
      const receiptPairs: ExpoReceiptPair[] = [];
      for (let i = 0; i < tickets.length; i++) {
        const ticket = tickets[i];
        const row = tokens[i];
        if (!ticket || !row) continue;
        if (
          ticket.status === "error" &&
          ticket.details?.error === "DeviceNotRegistered"
        ) {
          await prisma.expoPushToken.delete({ where: { id: row.id } });
        } else if (ticket.status === "ok" && ticket.id) {
          receiptPairs.push({ tokenRowId: row.id, ticketId: ticket.id });
        }
      }
      if (receiptPairs.length > 0) {
        this.scheduleExpoReceiptCheck(receiptPairs);
      }
    } catch {
      // Expo 전송 실패는 인박스에 영향 없음 (09 §9)
    }
  }

  private scheduleExpoReceiptCheck(
    pairs: ExpoReceiptPair[],
    attempt = 0,
  ): void {
    const delay =
      EXPO_RECEIPT_DELAYS_MS[attempt] ??
      EXPO_RECEIPT_DELAYS_MS[EXPO_RECEIPT_DELAYS_MS.length - 1]!;
    void this.persistReceiptSchedule(pairs, attempt, delay);
    setTimeout(() => {
      void this.processExpoReceipts(pairs, attempt);
    }, delay);
  }

  private async persistReceiptSchedule(
    pairs: ExpoReceiptPair[],
    attempt: number,
    delayMs: number,
  ): Promise<void> {
    try {
      const scheduledAt = new Date(Date.now() + delayMs);
      if (attempt === 0) {
        for (const pair of pairs) {
          await prisma.expoReceiptPending.create({
            data: {
              tokenRowId: pair.tokenRowId,
              ticketId: pair.ticketId,
              attempt,
              scheduledAt,
            },
          }).catch((err: { code?: string }) => {
            if (err.code !== "P2002") throw err;
          });
        }
        return;
      }
      for (const pair of pairs) {
        await prisma.expoReceiptPending.updateMany({
          where: {
            tokenRowId: pair.tokenRowId,
            ticketId: pair.ticketId,
          },
          data: { attempt, scheduledAt },
        });
      }
    } catch (err) {
      console.warn("[PushService] expo receipt persist failed:", err);
    }
  }

  private async clearReceiptSchedule(pairs: ExpoReceiptPair[]): Promise<void> {
    if (pairs.length === 0) return;
    try {
      await prisma.expoReceiptPending.deleteMany({
        where: {
          OR: pairs.map((pair) => ({
            tokenRowId: pair.tokenRowId,
            ticketId: pair.ticketId,
          })),
        },
      });
    } catch (err) {
      console.warn("[PushService] expo receipt clear failed:", err);
    }
  }

  private claimReceiptPairs(pairs: ExpoReceiptPair[]): ExpoReceiptPair[] {
    const claimed: ExpoReceiptPair[] = [];
    for (const pair of pairs) {
      if (this.processingReceiptTickets.has(pair.ticketId)) continue;
      this.processingReceiptTickets.add(pair.ticketId);
      claimed.push(pair);
    }
    return claimed;
  }

  private releaseReceiptTickets(ticketIds: string[]): void {
    for (const id of ticketIds) {
      this.processingReceiptTickets.delete(id);
    }
  }

  private async pruneOrphanReceiptPending(): Promise<void> {
    const pending = await prisma.expoReceiptPending.findMany({
      select: { id: true, tokenRowId: true },
    });
    if (pending.length === 0) return;
    const tokens = await prisma.expoPushToken.findMany({ select: { id: true } });
    const valid = new Set(tokens.map((row) => row.id));
    const orphanIds = pending
      .filter((row) => !valid.has(row.tokenRowId))
      .map((row) => row.id);
    if (orphanIds.length > 0) {
      console.warn(
        `[push] pruning ${orphanIds.length} orphan ExpoReceiptPending row(s)`,
      );
      await prisma.expoReceiptPending.deleteMany({
        where: { id: { in: orphanIds } },
      });
    }
  }

  private async resumePendingReceipts(): Promise<void> {
    try {
      await this.pruneOrphanReceiptPending();
      const now = new Date();
      const due = await prisma.expoReceiptPending.findMany({
        where: { scheduledAt: { lte: now } },
      });
      const dueByAttempt = new Map<number, ExpoReceiptPair[]>();
      for (const row of due) {
        const list = dueByAttempt.get(row.attempt) ?? [];
        list.push({ tokenRowId: row.tokenRowId, ticketId: row.ticketId });
        dueByAttempt.set(row.attempt, list);
      }
      for (const [attempt, pairs] of dueByAttempt) {
        void this.processExpoReceipts(pairs, attempt);
      }

      const future = await prisma.expoReceiptPending.findMany({
        where: { scheduledAt: { gt: now } },
      });
      for (const row of future) {
        const delay = row.scheduledAt.getTime() - Date.now();
        setTimeout(() => {
          void this.processExpoReceipts(
            [{ tokenRowId: row.tokenRowId, ticketId: row.ticketId }],
            row.attempt,
          );
        }, Math.max(0, delay));
      }
    } catch (err) {
      console.warn("[PushService] resume pending receipts skipped:", err);
    }
  }

  private async processExpoReceipts(
    pairs: ExpoReceiptPair[],
    attempt: number,
  ): Promise<void> {
    const claimed = this.claimReceiptPairs(pairs);
    if (claimed.length === 0) return;
    const ticketIds = claimed.map((p) => p.ticketId);
    try {
      const ids = claimed.map((p) => p.ticketId);
      const receipts = await getExpoPushReceipts(ids);
      const { pruneIds, pending } = partitionExpoReceipts(claimed, receipts);
      for (const id of pruneIds) {
        await prisma.expoPushToken.delete({ where: { id } });
      }
      const finished = claimed.filter(
        (pair) =>
          !pending.some(
            (p) =>
              p.tokenRowId === pair.tokenRowId &&
              p.ticketId === pair.ticketId,
          ),
      );
      await this.clearReceiptSchedule(finished);
      if (pending.length > 0 && attempt + 1 < EXPO_RECEIPT_MAX_ATTEMPTS) {
        this.scheduleExpoReceiptCheck(pending, attempt + 1);
      } else if (pending.length > 0) {
        await this.clearReceiptSchedule(pending);
      }
    } catch {
      if (attempt + 1 < EXPO_RECEIPT_MAX_ATTEMPTS) {
        this.scheduleExpoReceiptCheck(claimed, attempt + 1);
      } else {
        await this.clearReceiptSchedule(claimed);
      }
    } finally {
      this.releaseReceiptTickets(ticketIds);
    }
  }
}
