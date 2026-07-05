import { describe, expect, it } from "vitest";
import { ApprovalGateRegistry } from "./approval-gate.js";

describe("ApprovalGateRegistry", () => {
  it("resolves wait with complete", async () => {
    const registry = new ApprovalGateRegistry();
    const waitPromise = registry.wait("run-1");
    expect(registry.has("run-1")).toBe(true);

    registry.complete("run-1", "approve");
    await expect(waitPromise).resolves.toBe("approve");
    expect(registry.has("run-1")).toBe(false);
  });

  it("returns false when completing unknown run", () => {
    const registry = new ApprovalGateRegistry();
    expect(registry.complete("missing", "reject")).toBe(false);
  });

  it("reuses existing gate for same runId", async () => {
    const registry = new ApprovalGateRegistry();
    const a = registry.wait("run-2");
    const b = registry.wait("run-2");
    registry.complete("run-2", "reject");
    await expect(a).resolves.toBe("reject");
    await expect(b).resolves.toBe("reject");
  });
});
