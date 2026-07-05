import { describe, expect, it } from "vitest";
import { isNewSeq } from "./event-stream";
import {
  applyEventToState,
  createInitialSessionState,
} from "../state/session-ui";

describe("mobile event-stream", () => {
  it("isNewSeq accepts strictly increasing seq", () => {
    expect(isNewSeq(2, 1)).toBe(true);
    expect(isNewSeq(1, 1)).toBe(false);
  });
});

describe("mobile session-ui", () => {
  it("applyEventToState streams assistant chunks", () => {
    let state = createInitialSessionState();
    state = applyEventToState(state, {
      seq: 1,
      runId: "r1",
      sessionId: "s1",
      projectId: "p1",
      at: "2026-01-01T00:00:00Z",
      event: { type: "assistant", runId: "r1", text: "hi" },
    });
    state = applyEventToState(state, {
      seq: 2,
      runId: "r1",
      sessionId: "s1",
      projectId: "p1",
      at: "2026-01-01T00:00:01Z",
      event: { type: "assistant", runId: "r1", text: " there" },
    });
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]!.content).toBe("hi there");
    expect(state.runStatus).toBe("streaming");
  });

  it("applyEventToState sets pendingApproval", () => {
    const state = applyEventToState(createInitialSessionState(), {
      seq: 3,
      runId: "r1",
      sessionId: "s1",
      projectId: "p1",
      at: "2026-01-01T00:00:02Z",
      event: {
        type: "approval_required",
        runId: "r1",
        approvalId: "a1",
        detail: "delete file",
      },
    });
    expect(state.pendingApproval?.approvalId).toBe("a1");
    expect(state.runStatus).toBe("waiting_approval");
  });
});
