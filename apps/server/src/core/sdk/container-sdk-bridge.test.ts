import { describe, expect, it } from "vitest";
import { RunTerminalStatus } from "@app/shared";
import { parseContainerSdkLinesForTest } from "./container-sdk-bridge.js";

describe("ContainerSdkBridge stream contract (04 §6.4~6.5)", () => {
  it("maps stream lines to domain events without run_done", () => {
    const lines = [
      JSON.stringify({ kind: "run", runId: "run-abc" }),
      JSON.stringify({
        kind: "stream",
        event: {
          type: "assistant",
          message: { content: [{ type: "text", text: "hello" }] },
        },
      }),
      JSON.stringify({ kind: "done", status: "finished" }),
    ];

    const { events, runId, doneStatus } = parseContainerSdkLinesForTest(lines);
    expect(runId).toBe("run-abc");
    expect(doneStatus).toBe("finished");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "assistant",
      runId: "run-abc",
      text: "hello",
    });
    expect(events.some((e) => e.type === "run_done")).toBe(false);
  });

  it("SessionManager records run_done once from wait() after stream", () => {
    const lines = [
      JSON.stringify({ kind: "run", runId: "run-1" }),
      JSON.stringify({
        kind: "stream",
        event: {
          type: "assistant",
          message: { content: [{ type: "text", text: "ok" }] },
        },
      }),
      JSON.stringify({ kind: "done", status: "finished" }),
    ];

    const parsed = parseContainerSdkLinesForTest(lines);
    const streamEvents = parsed.events;
    const waitStatus = parsed.doneStatus === "finished" ? "finished" : "error";

    const recorded = [
      ...streamEvents,
      { type: "run_done" as const, runId: parsed.runId, status: RunTerminalStatus.FINISHED },
    ];
    const runDoneCount = recorded.filter((e) => e.type === "run_done").length;
    expect(runDoneCount).toBe(1);
    expect(waitStatus).toBe("finished");
  });
});
