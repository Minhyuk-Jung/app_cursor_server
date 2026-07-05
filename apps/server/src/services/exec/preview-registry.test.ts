import { describe, expect, it } from "vitest";
import { PreviewRegistry } from "./preview-registry.js";

describe("PreviewRegistry (13 §6.3)", () => {
  it("revokeForProject removes all preview tokens for project", () => {
    const reg = new PreviewRegistry();
    reg.issue({
      projectId: "p1",
      userId: "u1",
      port: 5173,
      ttlMs: 60_000,
    });
    reg.issue({
      projectId: "p1",
      userId: "u1",
      port: 5174,
      ttlMs: 60_000,
    });
    reg.issue({
      projectId: "p2",
      userId: "u1",
      port: 5173,
      ttlMs: 60_000,
    });

    expect(reg.revokeForProject("p1")).toBe(2);
    expect(reg.size()).toBe(1);
  });
});
