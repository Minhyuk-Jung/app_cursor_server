import { describe, expect, it } from "vitest";
import {
  execResourceLimitKind,
  isExecMemoryLimitExit,
} from "./exec-resource-limit.js";

describe("exec resource limit (13 §9)", () => {
  it("detects docker OOM exit 137", () => {
    expect(isExecMemoryLimitExit(137, "SIGKILL", "docker", false)).toBe(true);
    expect(execResourceLimitKind(137, "SIGKILL", "docker", false)).toBe(
      "exec_memory_limit",
    );
  });

  it("ignores subprocess SIGKILL", () => {
    expect(isExecMemoryLimitExit(137, "SIGKILL", "subprocess", false)).toBe(
      false,
    );
  });

  it("prefers timeout over memory when timedOut flag set", () => {
    expect(execResourceLimitKind(137, "SIGKILL", "docker", true, false)).toBe(
      "exec_timeout",
    );
  });

  it("returns null when cancelled (user/purge)", () => {
    expect(execResourceLimitKind(137, "SIGKILL", "docker", false, true)).toBeNull();
    expect(execResourceLimitKind(124, null, "docker", true, true)).toBeNull();
  });

  it("returns null for normal exit", () => {
    expect(execResourceLimitKind(0, null, "docker", false)).toBeNull();
  });
});
