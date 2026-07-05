import { describe, expect, it } from "vitest";
import { SdkAdapter } from "./sdk-adapter.js";
import { SandboxService } from "../../services/exec/sandbox-service.js";

function makeSandbox() {
  return new SandboxService({
    sandboxMode: "subprocess",
    execTimeoutMs: 30_000,
    maxConcurrentExec: 3,
    perProjectMaxExec: 2,
    dockerImage: "node:22-alpine",
    sandboxMemoryMb: 512,
    sandboxCpus: 1,
  });
}

describe("SdkAdapter sandbox (ADR-007)", () => {
  it("runs workspace validation before Agent.create", async () => {
    const sandbox = makeSandbox();
    const adapter = new SdkAdapter({
      assertWorkspace: (root) => sandbox.assertProjectWorkspace(root),
    });

    await expect(
      adapter.createAgent({
        cwd: "C:\\nonexistent-sandbox-workspace-xyz",
        model: "composer-2.5",
        apiKey: "test-key",
      }),
    ).rejects.toMatchObject({
      type: "error",
      errorKind: "startup",
    });
  });

  it("validates project root before resumeAgent", async () => {
    const sandbox = makeSandbox();
    const adapter = new SdkAdapter({
      assertWorkspace: (root) => sandbox.assertProjectWorkspace(root),
    });

    await expect(
      adapter.resumeAgent("fake-agent-id", "test-key", "C:\\nonexistent-resume-root"),
    ).rejects.toMatchObject({
      type: "error",
      errorKind: "startup",
    });
  });
});
