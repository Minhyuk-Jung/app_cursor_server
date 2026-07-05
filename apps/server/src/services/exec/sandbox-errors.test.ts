import { describe, expect, it } from "vitest";
import { SandboxService } from "./sandbox-service.js";
import { SandboxSessionRegistry } from "./sandbox-session-registry.js";

describe("sandbox-errors (13 §9)", () => {
  it("prepare throws docker_unavailable when docker mode without manager", () => {
    const sandbox = new SandboxService({
      sandboxMode: "docker",
      execTimeoutMs: 30_000,
      maxConcurrentExec: 2,
      perProjectMaxExec: 2,
      dockerImage: "node:22-alpine",
      sandboxMemoryMb: 128,
      sandboxCpus: 1,
    });
    const reg = new SandboxSessionRegistry(
      { memoryMb: 128, cpus: 1, execTimeoutMs: 30_000 },
      { sandboxService: sandbox },
    );
    let err: unknown;
    try {
      reg.prepare("p1", "/tmp/ws", false);
    } catch (e) {
      err = e;
    }
    expect(err).toMatchObject({
      code: "docker_unavailable",
      retryable: false,
    });
  });

  it("resolvePreviewHost throws sandbox_not_ready in docker mode without container", () => {
    const sandbox = new SandboxService({
      sandboxMode: "docker",
      execTimeoutMs: 30_000,
      maxConcurrentExec: 2,
      perProjectMaxExec: 2,
      dockerImage: "node:22-alpine",
      sandboxMemoryMb: 128,
      sandboxCpus: 1,
    });
    const reg = new SandboxSessionRegistry(
      { memoryMb: 128, cpus: 1, execTimeoutMs: 30_000 },
      { sandboxService: sandbox },
    );
    reg.getOrCreate("p2");
    let err: unknown;
    try {
      reg.resolvePreviewHost("p2");
    } catch (e) {
      err = e;
    }
    expect(err).toMatchObject({ code: "sandbox_not_ready", retryable: true });
  });
});
