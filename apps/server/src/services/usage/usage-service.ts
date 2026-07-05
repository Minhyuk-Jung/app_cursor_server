import { prisma } from "../../db/client.js";

export function startOfUtcDay(date = new Date()): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

export async function recordUsage(
  userId: string,
  kind: string,
  projectId?: string,
): Promise<void> {
  await prisma.usageEvent.create({
    data: { userId, kind, projectId },
  });
}

export async function countUsageSince(
  userId: string,
  since: Date,
  projectId?: string,
): Promise<number> {
  return prisma.usageEvent.count({
    where: {
      userId,
      createdAt: { gte: since },
      ...(projectId ? { projectId } : {}),
    },
  });
}

export async function getUsageSummary(
  userId: string,
  range: "day" | "month" = "day",
  projectId?: string,
  options?: { limit?: number; warningRatio?: number },
): Promise<{
  total: number;
  since: string;
  byKind: Record<string, number>;
  limit?: number;
  warning?: boolean;
  remaining?: number;
}> {
  const since =
    range === "month"
      ? new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1))
      : startOfUtcDay();

  const events = await prisma.usageEvent.findMany({
    where: {
      userId,
      createdAt: { gte: since },
      ...(projectId ? { projectId } : {}),
    },
    select: { kind: true },
  });

  const byKind: Record<string, number> = {};
  for (const e of events) {
    byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
  }

  const result = {
    total: events.length,
    since: since.toISOString(),
    byKind,
  };

  if (range === "day" && options?.limit !== undefined) {
    const warningThreshold = Math.floor(options.limit * (options.warningRatio ?? 0.8));
    return {
      ...result,
      limit: options.limit,
      warning: events.length >= warningThreshold,
      remaining: Math.max(0, options.limit - events.length),
    };
  }

  return result;
}

export async function checkUsageLimit(
  userId: string,
  limit: number,
): Promise<{ allowed: boolean; count: number; limit: number }> {
  const since = startOfUtcDay();
  const count = await countUsageSince(userId, since);
  return { allowed: count < limit, count, limit };
}
