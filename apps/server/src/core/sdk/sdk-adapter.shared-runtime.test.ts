import { describe, expect, it } from "vitest";
import { SdkAdapter } from "./sdk-adapter.js";

describe("SdkAdapter shared-runtime POC (ADR-007)", () => {
  it("ensures container prepared before Agent.create when shared-runtime-pending", async () => {
    let prepared = false;
    const adapter = new SdkAdapter({
      assertWorkspace: async (root) => root,
      runtimeMode: "shared-runtime-pending",
      assertContainerPrepared: async (projectId, root) => {
        expect(projectId).toBe("proj-1");
        expect(root).toContain("workspace");
        prepared = true;
      },
    });

    await expect(
      adapter.createAgent({
        cwd: "/tmp/workspace",
        model: "composer-2.5",
        apiKey: "test-key",
        projectId: "proj-1",
      }),
    ).rejects.toBeTruthy();
    expect(prepared).toBe(true);
  });

  it("ensures container prepared before Agent.create when shared-runtime", async () => {
    let prepared = false;
    const adapter = new SdkAdapter({
      assertWorkspace: async (root) => root,
      runtimeMode: "shared-runtime",
      assertContainerPrepared: async () => {
        prepared = true;
      },
    });

    await expect(
      adapter.createAgent({
        cwd: "/tmp/workspace",
        model: "composer-2.5",
        apiKey: "test-key",
        projectId: "proj-1",
      }),
    ).rejects.toBeTruthy();
    expect(prepared).toBe(true);
  });

  it("skips container prep in host runtime mode", async () => {
    let prepared = false;
    const adapter = new SdkAdapter({
      runtimeMode: "host",
      assertContainerPrepared: async () => {
        prepared = true;
      },
    });

    await expect(
      adapter.createAgent({
        cwd: "/tmp/workspace",
        model: "composer-2.5",
        apiKey: "test-key",
        projectId: "proj-1",
      }),
    ).rejects.toBeTruthy();
    expect(prepared).toBe(false);
  });

  it("ensures container prepared before Agent.resume when shared-runtime-pending", async () => {
    let prepared = false;
    const adapter = new SdkAdapter({
      assertWorkspace: async (root) => root,
      runtimeMode: "shared-runtime-pending",
      assertContainerPrepared: async (projectId, root) => {
        expect(projectId).toBe("proj-2");
        expect(root).toBe("/tmp/ws");
        prepared = true;
      },
    });

    await expect(
      adapter.resumeAgent("agent-1", "test-key", "/tmp/ws", "proj-2"),
    ).rejects.toBeTruthy();
    expect(prepared).toBe(true);
  });
});
