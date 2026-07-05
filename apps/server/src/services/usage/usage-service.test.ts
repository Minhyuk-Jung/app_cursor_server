import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../db/client.js";
import {
  checkUsageLimit,
  countUsageSince,
  getUsageSummary,
  recordUsage,
  startOfUtcDay,
} from "./usage-service.js";

describe("usage-service", () => {
  beforeEach(async () => {
    await prisma.usageEvent.deleteMany();
  });

  afterEach(async () => {
    await prisma.usageEvent.deleteMany();
  });

  it("counts events since start of UTC day", async () => {
    const since = startOfUtcDay();
    await recordUsage("dev-user", "send_prompt", "p1");
    await recordUsage("dev-user", "send_prompt", "p1");

    const count = await countUsageSince("dev-user", since);
    expect(count).toBe(2);
  });

  it("enforces daily limit", async () => {
    await recordUsage("dev-user", "send_prompt");
    const result = await checkUsageLimit("dev-user", 1);
    expect(result.allowed).toBe(false);
    expect(result.count).toBe(1);
    expect(result.limit).toBe(1);
  });

  it("returns summary grouped by kind", async () => {
    await recordUsage("dev-user", "send_prompt");
    await recordUsage("dev-user", "steer");

    const summary = await getUsageSummary("dev-user", "day");
    expect(summary.total).toBe(2);
    expect(summary.byKind.send_prompt).toBe(1);
    expect(summary.byKind.steer).toBe(1);
  });
});
