import { describe, expect, it } from "vitest";
import { ExecOutputChannel } from "@app/shared";
import { mapSdkMessageForTest } from "./sdk-adapter.js";

describe("SdkAdapter mapSdkMessage (13 §8.1)", () => {
  it("tags running tool_call with agent_tool and started status", () => {
    const ev = mapSdkMessageForTest(
      {
        type: "tool_call",
        name: "run_terminal_cmd",
        status: "running",
        call_id: "call-1",
        args: { command: "npm test" },
      } as Parameters<typeof mapSdkMessageForTest>[0],
      "run-1",
    );
    expect(ev).toMatchObject({
      type: "tool",
      runId: "run-1",
      name: "run_terminal_cmd",
      callId: "call-1",
      toolStatus: "started",
      outputChannel: ExecOutputChannel.AGENT_TOOL,
    });
  });

  it("maps completed tool_call with shell output (§8.1)", () => {
    const ev = mapSdkMessageForTest(
      {
        type: "tool_call",
        name: "run_terminal_cmd",
        status: "completed",
        call_id: "call-2",
        result: { output: "s17-npm-ok\n" },
      } as Parameters<typeof mapSdkMessageForTest>[0],
      "run-1",
    );
    expect(ev).toMatchObject({
      type: "tool",
      name: "run_terminal_cmd",
      callId: "call-2",
      toolStatus: "completed",
      output: "s17-npm-ok\n",
      outputChannel: ExecOutputChannel.AGENT_TOOL,
    });
  });

  it("does not tag file_change events with output channel", () => {
    const ev = mapSdkMessageForTest(
      {
        type: "tool_call",
        name: "write",
        status: "running",
        args: { path: "src/a.ts", contents: "x" },
      } as Parameters<typeof mapSdkMessageForTest>[0],
      "run-2",
    );
    expect(ev).toMatchObject({
      type: "file_change",
      path: "src/a.ts",
    });
    expect(ev).not.toHaveProperty("outputChannel");
  });
});
