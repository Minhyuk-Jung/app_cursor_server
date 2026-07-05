import { describe, expect, it } from "vitest";
import { Scheduler } from "../core/scheduler/scheduler.js";
import { reconcileSchedulerSlots } from "./maintenance.js";

describe("maintenance jobs", () => {
  it("reconcileOrphans releases stale scheduler slots", () => {
    const scheduler = new Scheduler(3);
    const job = {
      runId: "orphan-run",
      sessionId: "s1",
      projectId: "p1",
      priority: 0,
      execute: async () => undefined,
    };
    scheduler.enqueue(job);
    expect(scheduler.getRunningCount()).toBe(1);

    const fixed = scheduler.reconcileOrphans(new Set());
    expect(fixed).toBe(1);
    expect(scheduler.getRunningCount()).toBe(0);
  });

  it("reconcileSchedulerSlots exports callable", () => {
    expect(typeof reconcileSchedulerSlots).toBe("function");
  });
});
