import { describe, expect, it, vi } from "vitest";
import { InMemoryRunEventLog } from "./in-memory-run-event-log.js";
import { StateMachine } from "../state/state-machine.js";
import { Scheduler } from "../scheduler/scheduler.js";
import { SessionStatus, RunStatus } from "@app/shared";

describe("InMemoryRunEventLog", () => {
  it("assigns monotonic seq and globalOffset", async () => {
    const log = new InMemoryRunEventLog();
    const e1 = await log.append({
      runId: "r1",
      sessionId: "s1",
      projectId: "p1",
      event: { type: "run_started", runId: "r1", sessionId: "s1" },
    });
    const e2 = await log.append({
      runId: "r1",
      sessionId: "s1",
      projectId: "p1",
      event: { type: "assistant", runId: "r1", text: "x" },
    });
    expect(e1.seq).toBe(1);
    expect(e2.seq).toBe(2);
    expect(e1.globalOffset).toBe(1);
    expect(e2.globalOffset).toBe(2);
  });

    it("notifies append listeners (ADR-008)", async () => {
    const log = new InMemoryRunEventLog();
    const sm = new StateMachine();
    log.onAppend((env) => sm.apply(env));

    await log.append({
      runId: "r1",
      sessionId: "s1",
      projectId: "p1",
      event: { type: "run_queued", runId: "r1", sessionId: "s1" },
    });
    expect(sm.getRun("r1")?.status).toBe(RunStatus.QUEUED);

    await log.append({
      runId: "r1",
      sessionId: "s1",
      projectId: "p1",
      event: { type: "run_started", runId: "r1", sessionId: "s1" },
    });
    expect(sm.getRun("r1")?.status).toBe(RunStatus.RUNNING);
  });

  it("replays without gaps or duplicates", async () => {
    const log = new InMemoryRunEventLog();
    await log.append({
      runId: "r1",
      sessionId: "s1",
      projectId: "p1",
      event: { type: "assistant", runId: "r1", text: "a" },
    });
    await log.append({
      runId: "r1",
      sessionId: "s1",
      projectId: "p1",
      event: { type: "assistant", runId: "r1", text: "b" },
    });
    const replay = await log.replay("session", "s1", 1);
    expect(replay).toHaveLength(1);
    expect(replay[0]!.seq).toBe(2);
  });

  it("replays 1000 globalOffset events without gaps (LD-03 sample)", async () => {
    const log = new InMemoryRunEventLog();
    for (let i = 0; i < 1000; i++) {
      await log.append({
        runId: "r1",
        sessionId: "s1",
        projectId: "p1",
        event: { type: "assistant", runId: "r1", text: `m${i}` },
      });
    }
    const replay = await log.replay("global", "", 0);
    expect(replay).toHaveLength(1000);
    expect(replay[0]!.globalOffset).toBe(1);
    expect(replay[999]!.globalOffset).toBe(1000);
  });
});

describe("StateMachine", () => {
  it("transitions via event log consumption only", async () => {
    const sm = new StateMachine();
    sm.apply({
      globalOffset: 1,
      runId: "r1",
      seq: 1,
      at: new Date().toISOString(),
      projectId: "p1",
      sessionId: "s1",
      event: { type: "run_queued", runId: "r1", sessionId: "s1" },
    });
    expect(sm.getRun("r1")?.status).toBe(RunStatus.QUEUED);

    sm.apply({
      globalOffset: 2,
      runId: "r1",
      seq: 2,
      at: new Date().toISOString(),
      projectId: "p1",
      sessionId: "s1",
      event: { type: "run_started", runId: "r1", sessionId: "s1" },
    });
    expect(sm.getRun("r1")?.status).toBe(RunStatus.RUNNING);

    sm.apply({
      globalOffset: 3,
      runId: "r1",
      seq: 3,
      at: new Date().toISOString(),
      projectId: "p1",
      sessionId: "s1",
      event: { type: "run_done", runId: "r1", status: "finished" },
    });
    expect(sm.getRun("r1")?.status).toBe(RunStatus.FINISHED);
    expect(sm.getSession("s1")?.status).toBe(SessionStatus.IDLE);
  });

  it("rejects invalid transitions", async () => {
    const sm = new StateMachine();
    const ok = sm.apply({
      globalOffset: 1,
      runId: "r1",
      seq: 1,
      at: new Date().toISOString(),
      projectId: "p1",
      sessionId: "s1",
      event: { type: "run_done", runId: "r1", status: "finished" },
    });
    expect(ok).toBe(false);
  });
});

describe("Scheduler", () => {
  it("limits concurrent executions", async () => {
    const scheduler = new Scheduler(2);
    let running = 0;
    let maxSeen = 0;

    const makeJob = (id: string) => ({
      runId: id,
      sessionId: "s1",
      projectId: "p1",
      priority: 0,
      execute: async () => {
        running += 1;
        maxSeen = Math.max(maxSeen, running);
        await new Promise((r) => setTimeout(r, 50));
        running -= 1;
        scheduler.releaseSlot(id);
      },
    });

    scheduler.enqueue(makeJob("r1"));
    scheduler.enqueue(makeJob("r2"));
    scheduler.enqueue(makeJob("r3"));

    await new Promise((r) => setTimeout(r, 200));
    expect(maxSeen).toBeLessThanOrEqual(2);
  });
});

describe("Idempotency pattern", () => {
  it("duplicate requestId should not double-execute handler", async () => {
    const handler = vi.fn();
    const seen = new Set<string>();

    async function dispatch(requestId: string) {
      if (seen.has(requestId)) return "cached";
      seen.add(requestId);
      return handler();
    }

    await dispatch("req-1");
    await dispatch("req-1");
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
