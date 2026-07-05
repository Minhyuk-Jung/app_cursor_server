import { describe, expect, it } from "vitest";
import { StateMachine } from "./state-machine.js";
import { RunStatus, SessionStatus } from "@app/shared";

describe("StateMachine transitions", () => {
  it("queued → running → streaming → finished", async () => {
    const sm = new StateMachine();
    expect(
      sm.apply({
        globalOffset: 1,
        runId: "r1",
        seq: 1,
        at: new Date().toISOString(),
        projectId: "p1",
        sessionId: "s1",
        event: { type: "run_queued", runId: "r1", sessionId: "s1" },
      }),
    ).toBe(true);
    expect(sm.getRun("r1")?.status).toBe(RunStatus.QUEUED);

    expect(
      sm.apply({
        globalOffset: 2,
        runId: "r1",
        seq: 2,
        at: new Date().toISOString(),
        projectId: "p1",
        sessionId: "s1",
        event: { type: "run_started", runId: "r1", sessionId: "s1" },
      }),
    ).toBe(true);
    expect(sm.getRun("r1")?.status).toBe(RunStatus.RUNNING);

    expect(
      sm.apply({
        globalOffset: 3,
        runId: "r1",
        seq: 3,
        at: new Date().toISOString(),
        projectId: "p1",
        sessionId: "s1",
        event: { type: "assistant", runId: "r1", text: "hi" },
      }),
    ).toBe(true);
    expect(sm.getRun("r1")?.status).toBe(RunStatus.STREAMING);

    expect(
      sm.apply({
        globalOffset: 4,
        runId: "r1",
        seq: 4,
        at: new Date().toISOString(),
        projectId: "p1",
        sessionId: "s1",
        event: { type: "run_done", runId: "r1", status: "finished" },
      }),
    ).toBe(true);
    expect(sm.getRun("r1")?.status).toBe(RunStatus.FINISHED);
    expect(sm.getSession("s1")?.status).toBe(SessionStatus.IDLE);
  });

  it("streaming → waiting_approval → streaming on approve", () => {
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
    sm.apply({
      globalOffset: 2,
      runId: "r1",
      seq: 2,
      at: new Date().toISOString(),
      projectId: "p1",
      sessionId: "s1",
      event: { type: "run_started", runId: "r1", sessionId: "s1" },
    });
    sm.apply({
      globalOffset: 3,
      runId: "r1",
      seq: 3,
      at: new Date().toISOString(),
      projectId: "p1",
      sessionId: "s1",
      event: {
        type: "approval_required",
        runId: "r1",
        approvalId: "r1-approval",
        detail: "tool",
      },
    });
    expect(sm.getRun("r1")?.status).toBe(RunStatus.WAITING_APPROVAL);

    expect(
      sm.apply({
        globalOffset: 4,
        runId: "r1",
        seq: 4,
        at: new Date().toISOString(),
        projectId: "p1",
        sessionId: "s1",
        event: {
          type: "approval_resolved",
          runId: "r1",
          approvalId: "r1-approval",
          decision: "approve",
        },
      }),
    ).toBe(true);
    expect(sm.getRun("r1")?.status).toBe(RunStatus.STREAMING);
  });

  it("rejects illegal run_started when not queued", () => {
    const sm = new StateMachine();
    sm.apply({
      globalOffset: 1,
      runId: "r1",
      seq: 1,
      at: new Date().toISOString(),
      projectId: "p1",
      sessionId: "s1",
      event: { type: "run_started", runId: "r1", sessionId: "s1" },
    });
    expect(
      sm.apply({
        globalOffset: 2,
        runId: "r1",
        seq: 2,
        at: new Date().toISOString(),
        projectId: "p1",
        sessionId: "s1",
        event: { type: "run_started", runId: "r1", sessionId: "s1" },
      }),
    ).toBe(false);
  });
});
