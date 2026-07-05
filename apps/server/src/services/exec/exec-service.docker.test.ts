import { execSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ExecService } from "./exec-service.js";
import { SandboxService } from "./sandbox-service.js";

function dockerAvailable(): boolean {
  try {
    execSync("docker version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function makeDockerSandbox() {
  return new SandboxService({
    sandboxMode: "docker",
    execTimeoutMs: 60_000,
    maxConcurrentExec: 2,
    perProjectMaxExec: 2,
    dockerImage: "node:22-alpine",
    sandboxMemoryMb: 256,
    sandboxCpus: 1,
  });
}

describe.skipIf(!dockerAvailable())("ExecService docker (P6 NFR-13)", () => {
  let tmpDir: string;
  let exec: ExecService;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "exec-docker-"));
    exec = new ExecService(makeDockerSandbox());
  });

  afterEach(async () => {
    exec.cancelAll();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("runs command inside docker container", async () => {
    const result = await exec.runToCompletion({
      projectRoot: tmpDir,
      command: "echo docker-ok",
    });
    expect(result.stdout).toContain("docker-ok");
    expect(result.exitCode).toBe(0);
  }, 120_000);
});
