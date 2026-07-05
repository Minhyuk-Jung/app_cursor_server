import { describe, expect, it } from "vitest";
import { ExecOutputChannel } from "@app/shared";
import {
  AGENT_TOOL_OUTPUT_CHANNEL,
  isShellTool,
  SHELL_TOOL_NAMES,
  USER_TERMINAL_OUTPUT_CHANNEL,
} from "./exec-boundary.js";

describe("exec-boundary (13 §8.1)", () => {
  it("defines distinct output channels", () => {
    expect(USER_TERMINAL_OUTPUT_CHANNEL).toBe(ExecOutputChannel.USER_TERMINAL);
    expect(AGENT_TOOL_OUTPUT_CHANNEL).toBe(ExecOutputChannel.AGENT_TOOL);
    expect(USER_TERMINAL_OUTPUT_CHANNEL).not.toBe(AGENT_TOOL_OUTPUT_CHANNEL);
  });

  it("recognizes shell tool names", () => {
    expect(isShellTool("run_terminal_cmd")).toBe(true);
    expect(isShellTool("Shell")).toBe(true);
    expect(isShellTool("write")).toBe(false);
    for (const name of SHELL_TOOL_NAMES) {
      expect(isShellTool(name)).toBe(true);
    }
  });
});
