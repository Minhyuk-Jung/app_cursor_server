import { describe, expect, it, vi } from "vitest";
import { Scheduler } from "./scheduler.js";

describe("Scheduler (P4 perProjectMax)", () => {
  it("respects global maxConcurrent", async () => {
    const scheduler = new Scheduler(2, 100, 2);
    const started: string[] = [];

    for (let i = 0; i < 4; i++) {
      scheduler.enqueue({
        runId: `run-${i}`,
        sessionId: "s1",
        projectId: "p1",
        priority: 0,
        execute: async () => {
          started.push(`run-${i}`);
          await new Promise((r) => setTimeout(r, 50));
        },
      });
    }

    expect(scheduler.getRunningCount()).toBeLessThanOrEqual(2);
    expect(started.length).toBeLessThanOrEqual(2);
  });

  it("respects perProjectMax across projects", () => {
    const scheduler = new Scheduler(4, 100, 1);
    const started: string[] = [];

    scheduler.enqueue({
      runId: "a1",
      sessionId: "s1",
      projectId: "p1",
      priority: 0,
      execute: () => {
        started.push("a1");
        return new Promise(() => {});
      },
    });
    scheduler.enqueue({
      runId: "a2",
      sessionId: "s2",
      projectId: "p1",
      priority: 0,
      execute: () => {
        started.push("a2");
        return new Promise(() => {});
      },
    });
    scheduler.enqueue({
      runId: "b1",
      sessionId: "s3",
      projectId: "p2",
      priority: 0,
      execute: () => {
        started.push("b1");
        return new Promise(() => {});
      },
    });

    expect(started).toContain("a1");
    expect(started).toContain("b1");
    expect(started).not.toContain("a2");
    expect(scheduler.getRunningCountForProject("p1")).toBe(1);
    expect(scheduler.getQueueLength()).toBe(1);
  });

  it("releases slot and starts queued job", () => {
    const scheduler = new Scheduler(1, 100, 1);
    const started: string[] = [];

    scheduler.enqueue({
      runId: "first",
      sessionId: "s1",
      projectId: "p1",
      priority: 0,
      execute: () => {
        started.push("first");
        return new Promise(() => {});
      },
    });
    scheduler.enqueue({
      runId: "second",
      sessionId: "s1",
      projectId: "p1",
      priority: 0,
      execute: () => {
        started.push("second");
        return new Promise(() => {});
      },
    });

    expect(started).toEqual(["first"]);
    scheduler.releaseSlot("first");
    expect(started).toEqual(["first", "second"]);
  });
});

describe("Scheduler (LD-01 load)", () => {
  it("queues excess jobs when N exceeds maxConcurrent", () => {
    const max = 2;
    const scheduler = new Scheduler(max, 100, max);
    const started: string[] = [];

    for (let i = 0; i < max + 5; i++) {
      scheduler.enqueue({
        runId: `ld-${i}`,
        sessionId: "s1",
        projectId: "p1",
        priority: 0,
        execute: () => {
          started.push(`ld-${i}`);
          return new Promise(() => {});
        },
      });
    }

    expect(scheduler.getRunningCount()).toBeLessThanOrEqual(max);
    expect(scheduler.getRunningCount() + scheduler.getQueueLength()).toBe(max + 5);
    expect(started.length).toBeLessThanOrEqual(max);
  });
});

describe("Scheduler (P4 notBefore/backoff)", () => {
  it("defers jobs until notBefore elapses", async () => {
    vi.useFakeTimers();
    const scheduler = new Scheduler(2, 100, 2);
    const started: string[] = [];

    scheduler.enqueue({
      runId: "blocking",
      sessionId: "s1",
      projectId: "p1",
      priority: 0,
      execute: () => {
        started.push("blocking");
        return new Promise(() => {});
      },
    });

    scheduler.requeueWithBackoff(
      {
        runId: "delayed",
        sessionId: "s1",
        projectId: "p1",
        priority: 0,
        execute: () => {
          started.push("delayed");
          return Promise.resolve();
        },
      },
      { attempt: 0, maxAttempts: 3, baseDelayMs: 1000 },
    );

    expect(started).toEqual(["blocking"]);
    expect(scheduler.getQueueLength()).toBe(1);

    await vi.advanceTimersByTimeAsync(1001);
    expect(started).toContain("delayed");

    vi.useRealTimers();
  });

  it("respects perUserMax across same user", () => {
    const scheduler = new Scheduler(10, 100, 10, 1);
    const started: string[] = [];

    scheduler.enqueue({
      runId: "u1a",
      sessionId: "s1",
      projectId: "p1",
      userId: "user-a",
      priority: 0,
      execute: () => {
        started.push("u1a");
        return new Promise(() => {});
      },
    });
    scheduler.enqueue({
      runId: "u1b",
      sessionId: "s2",
      projectId: "p2",
      userId: "user-a",
      priority: 0,
      execute: () => {
        started.push("u1b");
        return new Promise(() => {});
      },
    });
    scheduler.enqueue({
      runId: "u2a",
      sessionId: "s3",
      projectId: "p3",
      userId: "user-b",
      priority: 0,
      execute: () => {
        started.push("u2a");
        return new Promise(() => {});
      },
    });

    expect(started).toContain("u1a");
    expect(started).toContain("u2a");
    expect(started).not.toContain("u1b");
    expect(scheduler.getRunningCountForUser("user-a")).toBe(1);
  });
});

describe("Scheduler (LD-02 multi-project)", () => {
  it("runs one job per project under perProjectMax=1", () => {
    const scheduler = new Scheduler(10, 100, 1);
    const started: string[] = [];

    for (let p = 0; p < 10; p++) {
      scheduler.enqueue({
        runId: `run-p${p}`,
        sessionId: `s${p}`,
        projectId: `project-${p}`,
        priority: 0,
        execute: () => {
          started.push(`project-${p}`);
          return new Promise(() => {});
        },
      });
    }

    expect(started).toHaveLength(10);
    expect(scheduler.getRunningCount()).toBe(10);
    expect(scheduler.getQueueLength()).toBe(0);
  });
});

describe("Scheduler beforeApprove (08 §6.1.1)", () => {
  it("skips job when beforeApprove returns false", async () => {
    const scheduler = new Scheduler(3);
    let executed = false;
    scheduler.setBeforeApprove(async () => false);
    scheduler.enqueue({
      runId: "blocked",
      sessionId: "s1",
      projectId: "p1",
      priority: 0,
      execute: async () => {
        executed = true;
      },
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(executed).toBe(false);
    expect(scheduler.getRunningCount()).toBe(0);
  });

  it("respects priority (lower runs first)", async () => {
    const scheduler = new Scheduler(1);
    const order: number[] = [];
    let releaseHold!: () => void;
    const hold = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });

    scheduler.enqueue({
      runId: "hold",
      sessionId: "s0",
      projectId: "p0",
      priority: 0,
      execute: async () => {
        await hold;
        scheduler.releaseSlot("hold");
      },
    });

    scheduler.enqueue({
      runId: "low",
      sessionId: "s1",
      projectId: "p1",
      priority: 5,
      execute: async () => {
        order.push(5);
      },
    });
    scheduler.enqueue({
      runId: "high",
      sessionId: "s2",
      projectId: "p2",
      priority: -5,
      execute: async () => {
        order.push(-5);
        scheduler.releaseSlot("high");
      },
    });

    expect(scheduler.getQueueLength()).toBe(2);
    releaseHold();
    await new Promise((r) => setTimeout(r, 30));
    expect(order[0]).toBe(-5);
  });
});
