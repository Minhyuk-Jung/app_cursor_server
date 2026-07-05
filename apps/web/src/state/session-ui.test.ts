import { describe, expect, it } from "vitest";
import { applyEventToState, createInitialSessionState, dbMessagesToChat, applyReplayEvents, userMessageDisplayContent } from "./session-ui.js";

describe("session-ui event handling", () => {
  it("accumulates assistant text for same run", () => {
    let state = createInitialSessionState();
    const base = {
      globalOffset: 1,
      runId: "r1",
      projectId: "p1",
      sessionId: "s1",
      at: new Date().toISOString(),
    };
    state = applyEventToState(state, {
      ...base,
      seq: 1,
      event: { type: "assistant", runId: "r1", text: "Hello" },
    });
    state = applyEventToState(state, {
      ...base,
      seq: 2,
      event: { type: "assistant", runId: "r1", text: " world" },
    });
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]!.content).toBe("Hello world");
  });

  it("routes tool events to work panel", () => {
    const state = applyEventToState(createInitialSessionState(), {
      globalOffset: 1,
      runId: "r1",
      seq: 1,
      at: new Date().toISOString(),
      projectId: "p1",
      sessionId: "s1",
      event: { type: "tool", runId: "r1", name: "read_file", input: {} },
    });
    expect(state.workItems).toHaveLength(1);
    expect(state.workItems[0]!.type).toBe("tool");
  });

  it("merges tool completed output by callId (§8.1)", () => {
    const base = {
      runId: "r1",
      projectId: "p1",
      sessionId: "s1",
      at: new Date().toISOString(),
    };
    let state = applyEventToState(createInitialSessionState(), {
      ...base,
      globalOffset: 1,
      seq: 1,
      event: {
        type: "tool",
        runId: "r1",
        name: "run_terminal_cmd",
        callId: "c1",
        toolStatus: "started",
        outputChannel: "agent_tool",
      },
    });
    state = applyEventToState(state, {
      ...base,
      globalOffset: 2,
      seq: 2,
      at: new Date().toISOString(),
      event: {
        type: "tool",
        runId: "r1",
        name: "run_terminal_cmd",
        callId: "c1",
        toolStatus: "completed",
        output: "tests passed",
        outputChannel: "agent_tool",
      },
    });
    expect(state.workItems).toHaveLength(1);
    expect(state.workItems[0]!.summary).toContain("run_terminal_cmd");
    expect(state.workItems[0]!.detail).toBe("tests passed");
  });

  it("merges assistant rows by runId in dbMessagesToChat", () => {
    const chat = dbMessagesToChat([
      { id: "1", role: "assistant", content: "Hi", runId: "r1" },
      { id: "2", role: "assistant", content: " there", runId: "r1" },
    ]);
    expect(chat).toHaveLength(1);
    expect(chat[0]!.content).toBe("Hi there");
  });

  it("parses attachmentsJson in dbMessagesToChat (UR-15 3차)", () => {
    const chat = dbMessagesToChat([
      {
        id: "u1",
        role: "user",
        content: "analyze",
        runId: "r1",
        attachmentsJson: JSON.stringify([
          { kind: "image", ref: "ref-abc", mime: "image/png" },
        ]),
      },
    ]);
    expect(chat[0]!.attachments).toHaveLength(1);
    expect(chat[0]!.attachments![0]!.ref).toBe("ref-abc");
  });

  it("userMessageDisplayContent strips legacy attachment meta lines", () => {
    expect(
      userMessageDisplayContent("analyze\n\n📷 image (png, ref abc…)", [
        { kind: "image", ref: "abc" },
      ]),
    ).toBe("analyze");
    expect(userMessageDisplayContent("plain", undefined)).toBe("plain");
  });

  it("applyReplayEvents skips assistant", () => {
    let state = createInitialSessionState();
    state.messages = [{ id: "u1", role: "user", content: "x" }];
    state = applyReplayEvents(state, [
      {
        globalOffset: 1,
        runId: "r1",
        seq: 1,
        at: new Date().toISOString(),
        projectId: "p1",
        sessionId: "s1",
        event: { type: "tool", runId: "r1", name: "grep", input: {} },
      },
      {
        globalOffset: 2,
        runId: "r1",
        seq: 2,
        at: new Date().toISOString(),
        projectId: "p1",
        sessionId: "s1",
        event: { type: "assistant", runId: "r1", text: "ignored" },
      },
    ]);
    expect(state.messages).toHaveLength(1);
    expect(state.workItems).toHaveLength(1);
  });
});
