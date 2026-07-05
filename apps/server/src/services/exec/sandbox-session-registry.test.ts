import { describe, expect, it, vi } from "vitest";
import { SandboxSessionRegistry } from "./sandbox-session-registry.js";
import type { DockerSandboxManager } from "./docker-sandbox-manager.js";

const DEFAULT_LIMITS = {
  memoryMb: 512,
  cpus: 1,
  execTimeoutMs: 300_000,
};

describe("SandboxSessionRegistry (P6 §4)", () => {
  it("creates sandboxId per project with resourceLimits", () => {
    const reg = new SandboxSessionRegistry(DEFAULT_LIMITS);
    const a = reg.getOrCreate("proj-a");
    expect(a.resourceLimits.memoryMb).toBe(512);
    expect(a.sandboxId).toBeTruthy();
  });

  it("tracks activity and status", () => {
    const reg = new SandboxSessionRegistry(DEFAULT_LIMITS);
    reg.touch("proj-a", true);
    expect(reg.get("proj-a")?.status).toBe("running");
    reg.touch("proj-a", false);
    expect(reg.get("proj-a")?.status).toBe("idle");
  });

  it("purges idle sessions and invokes onPurge", () => {
    const reg = new SandboxSessionRegistry(DEFAULT_LIMITS);
    reg.getOrCreate("old-proj");
    const session = reg.get("old-proj")!;
    session.lastActivityAt = Date.now() - 120_000;
    session.status = "idle";

    const onPurge = vi.fn();
    expect(reg.purgeIdle(60_000, onPurge)).toBe(1);
    expect(onPurge).toHaveBeenCalledWith("old-proj");
    expect(reg.get("old-proj")).toBeUndefined();
  });

  it("purges stale running sessions (§6.4)", () => {
    const reg = new SandboxSessionRegistry(DEFAULT_LIMITS);
    reg.touch("stale-run", true);
    const session = reg.get("stale-run")!;
    session.lastActivityAt = Date.now() - 120_000;

    const onPurge = vi.fn();
    expect(reg.purgeIdle(60_000, onPurge)).toBe(1);
    expect(onPurge).toHaveBeenCalledWith("stale-run");
  });

  it("does not purge active running sessions", () => {
    const reg = new SandboxSessionRegistry(DEFAULT_LIMITS);
    reg.touch("active", true);
    expect(reg.purgeIdle(60_000)).toBe(0);
    expect(reg.size()).toBe(1);
  });

  it("removes docker container on purge when manager present", () => {
    const removeContainer = vi.fn();
    const dockerManager = {
      removeContainer,
    } as unknown as DockerSandboxManager;
    const reg = new SandboxSessionRegistry(DEFAULT_LIMITS, {
      dockerManager,
    });
    const session = reg.getOrCreate("docker-purge");
    session.containerName = "cursor-sb-test";
    session.status = "idle";
    session.lastActivityAt = Date.now() - 120_000;

    expect(reg.purgeIdle(60_000)).toBe(1);
    expect(removeContainer).toHaveBeenCalledWith("cursor-sb-test");
  });

  it("purgeProject removes session and docker container immediately", () => {
    const removeContainer = vi.fn();
    const dockerManager = {
      removeContainer,
    } as unknown as DockerSandboxManager;
    const reg = new SandboxSessionRegistry(DEFAULT_LIMITS, { dockerManager });
    const onPurge = vi.fn();
    const session = reg.getOrCreate("archived-proj");
    session.containerName = "cursor-sb-archived";

    expect(reg.purgeProject("archived-proj", onPurge)).toBe(true);
    expect(removeContainer).toHaveBeenCalledWith("cursor-sb-archived");
    expect(onPurge).toHaveBeenCalledWith("archived-proj");
    expect(reg.get("archived-proj")).toBeUndefined();
  });

  it("purgeAll removes every session", () => {
    const reg = new SandboxSessionRegistry(DEFAULT_LIMITS);
    reg.getOrCreate("a");
    reg.getOrCreate("b");
    expect(reg.purgeAll()).toBe(2);
    expect(reg.size()).toBe(0);
  });

  it("ensurePrepared skips ensureContainer when already prepared", () => {
    const ensureContainer = vi.fn();
    const getContainerHost = vi.fn().mockReturnValue("172.20.0.2");
    const dockerManager = {
      ensureContainer,
      getContainerHost,
      removeContainer: vi.fn(),
    } as unknown as DockerSandboxManager;
    const sandboxService = {
      getMode: () => "docker" as const,
      getExecConfig: vi.fn(),
    };
    const reg = new SandboxSessionRegistry(DEFAULT_LIMITS, {
      dockerManager,
      sandboxService: sandboxService as never,
    });
    const session = reg.getOrCreate("prepared");
    session.containerName = "cursor-sb-prepared";
    session.containerHost = "172.20.0.1";

    reg.ensurePrepared("prepared", "/tmp/ws", false);

    expect(ensureContainer).not.toHaveBeenCalled();
    expect(getContainerHost).toHaveBeenCalledWith("cursor-sb-prepared");
    expect(session.containerHost).toBe("172.20.0.2");
  });
});
