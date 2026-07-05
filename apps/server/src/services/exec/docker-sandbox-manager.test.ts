import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DockerSandboxManager,
  isDockerAvailable,
} from "./docker-sandbox-manager.js";
import { SandboxService } from "./sandbox-service.js";
import { SandboxSessionRegistry } from "./sandbox-session-registry.js";
import { ExecService } from "./exec-service.js";

describe.skipIf(!isDockerAvailable())("DockerSandboxManager (ADR-007 P6)", () => {
  let tmpDir: string;
  let manager: DockerSandboxManager;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "docker-sb-"));
    manager = new DockerSandboxManager();
  });

  afterEach(async () => {
    try {
      manager.removeContainer(manager.containerNameFor("test-proj"));
    } catch {
      /* ignore */
    }
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("creates and reuses project container with bridge IP", () => {
    const first = manager.ensureContainer({
      projectId: "test-proj",
      projectRoot: tmpDir,
      image: "node:22-alpine",
      memoryMb: 128,
      cpus: 1,
    });
    expect(first.containerName).toContain("cursor-sb-");
    expect(first.host).toMatch(/^\d+\.\d+\.\d+\.\d+$/);

    const second = manager.ensureContainer({
      projectId: "test-proj",
      projectRoot: tmpDir,
      image: "node:22-alpine",
      memoryMb: 128,
      cpus: 1,
    });
    expect(second.containerName).toBe(first.containerName);
  });

  it("exec via docker exec in reused container", async () => {
    const sandbox = new SandboxService({
      sandboxMode: "docker",
      execTimeoutMs: 60_000,
      maxConcurrentExec: 2,
      perProjectMaxExec: 2,
      dockerImage: "node:22-alpine",
      sandboxMemoryMb: 128,
      sandboxCpus: 1,
    });
    const sessions = new SandboxSessionRegistry(
      { memoryMb: 128, cpus: 1, execTimeoutMs: 60_000 },
      { sandboxService: sandbox, dockerManager: manager },
    );
    const exec = new ExecService(sandbox, sessions);

    const result = await exec.runToCompletion({
      projectId: "docker-reuse",
      projectRoot: tmpDir,
      command: "echo docker-reuse-ok",
    });
    expect(result.stdout).toContain("docker-reuse-ok");
    expect(sessions.get("docker-reuse")?.containerName).toBeTruthy();
  }, 120_000);

  it("resolvePreviewHost uses container IP after prepare", () => {
    const sandbox = new SandboxService({
      sandboxMode: "docker",
      execTimeoutMs: 30_000,
      maxConcurrentExec: 2,
      perProjectMaxExec: 2,
      dockerImage: "node:22-alpine",
      sandboxMemoryMb: 128,
      sandboxCpus: 1,
    });
    const sessions = new SandboxSessionRegistry(
      { memoryMb: 128, cpus: 1, execTimeoutMs: 30_000 },
      { sandboxService: sandbox, dockerManager: manager },
    );
    sessions.prepare("prev-proj", tmpDir, false);
    const host = sessions.resolvePreviewHost("prev-proj");
    expect(host).not.toBe("127.0.0.1");
    expect(host).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
  });
});

describe("isDockerAvailable", () => {
  it("returns boolean", () => {
    expect(typeof isDockerAvailable()).toBe("boolean");
  });
});
