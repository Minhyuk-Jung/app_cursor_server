import { describe, expect, it } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SandboxService } from "./sandbox-service.js";

describe("SandboxService (ADR-007)", () => {
  it("reports shared workspace policy for subprocess mode", () => {
    const svc = new SandboxService({
      sandboxMode: "subprocess",
      execTimeoutMs: 30_000,
      maxConcurrentExec: 3,
      perProjectMaxExec: 2,
      dockerImage: "node:22-alpine",
      sandboxMemoryMb: 512,
      sandboxCpus: 1,
    });
    expect(svc.getPolicy()).toEqual({
      mode: "subprocess",
      sdkRunsOnHost: true,
      execContainerized: false,
      validatedWorkspacePath: true,
      sharedWorkspaceMount: false,
      mitigationMode: "subprocess",
      adr007Phase: "mitigation",
      sharedRuntimeRequested: false,
    });
  });

  it("reports shared-runtime-pending when SDK_SHARED_RUNTIME requested (not yet implemented)", () => {
    const svc = new SandboxService({
      sandboxMode: "docker",
      execTimeoutMs: 30_000,
      maxConcurrentExec: 3,
      perProjectMaxExec: 2,
      dockerImage: "node:22-alpine",
      sandboxMemoryMb: 512,
      sandboxCpus: 1,
      sdkSharedRuntime: true,
    });
    const policy = svc.getPolicy();
    expect(policy.adr007Phase).toBe("shared-runtime-pending");
    expect(policy.sharedRuntimeRequested).toBe(true);
    expect(policy.sdkRunsOnHost).toBe(true);
  });

  it("reports shared-runtime when SDK_IN_CONTAINER (POC 3)", () => {
    const svc = new SandboxService({
      sandboxMode: "docker",
      execTimeoutMs: 30_000,
      maxConcurrentExec: 3,
      perProjectMaxExec: 2,
      dockerImage: "node:22-alpine",
      sandboxMemoryMb: 512,
      sandboxCpus: 1,
      sdkInContainer: true,
    });
    const policy = svc.getPolicy();
    expect(policy.adr007Phase).toBe("shared-runtime");
    expect(policy.sdkRunsOnHost).toBe(false);
    expect(policy.sharedRuntimeRequested).toBe(true);
  });

  it("reports docker exec isolation with host SDK", () => {
    const svc = new SandboxService({
      sandboxMode: "docker",
      execTimeoutMs: 30_000,
      maxConcurrentExec: 3,
      perProjectMaxExec: 2,
      dockerImage: "node:22-alpine",
      sandboxMemoryMb: 512,
      sandboxCpus: 1,
    });
    const policy = svc.getPolicy();
    expect(policy.execContainerized).toBe(true);
    expect(policy.sdkRunsOnHost).toBe(true);
    expect(policy.validatedWorkspacePath).toBe(true);
    expect(policy.sharedWorkspaceMount).toBe(true);
    expect(policy.adr007Phase).toBe("shared-path");
    expect(policy.mitigationMode).toBe("docker");
  });

  it("validates project workspace path", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "sandbox-svc-"));
    try {
      const svc = new SandboxService({
        sandboxMode: "subprocess",
        execTimeoutMs: 30_000,
        maxConcurrentExec: 3,
      perProjectMaxExec: 2,
        dockerImage: "node:22-alpine",
        sandboxMemoryMb: 512,
        sandboxCpus: 1,
      });
      const resolved = await svc.assertProjectWorkspace(tmp);
      expect(resolved).toBeTruthy();
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("resolveExecCwd blocks sibling project path segments", async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), "sandbox-base-"));
    const projA = path.join(base, "proj-a");
    const projB = path.join(base, "proj-b");
    await mkdir(projA, { recursive: true });
    await mkdir(projB, { recursive: true });
    await writeFile(path.join(projB, "secret.txt"), "leak");
    try {
      const svc = new SandboxService({
        sandboxMode: "subprocess",
        execTimeoutMs: 30_000,
        maxConcurrentExec: 3,
      perProjectMaxExec: 2,
        dockerImage: "node:22-alpine",
        sandboxMemoryMb: 512,
        sandboxCpus: 1,
      });
      await expect(
        svc.resolveExecCwd(projA, "../proj-b"),
      ).rejects.toMatchObject({ code: "path_escape" });
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("dockerWorkdir maps exec cwd under project mount", async () => {
    const svc = new SandboxService({
      sandboxMode: "docker",
      execTimeoutMs: 30_000,
      maxConcurrentExec: 3,
      perProjectMaxExec: 2,
      dockerImage: "node:22-alpine",
      sandboxMemoryMb: 512,
      sandboxCpus: 1,
    });
    const root = "C:\\proj";
    expect(svc.dockerWorkdir(root, path.join(root, "src"))).toBe(
      "/workspace/src",
    );
  });

  it("assertSubprocessCommand blocks absolute path outside project (SEC-04)", async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), "sandbox-cmd-"));
    const projA = path.join(base, "proj-a");
    const projB = path.join(base, "proj-b");
    await mkdir(projA, { recursive: true });
    await mkdir(projB, { recursive: true });
    await writeFile(path.join(projB, "secret.txt"), "leak");
    try {
      const svc = new SandboxService({
        sandboxMode: "subprocess",
        execTimeoutMs: 30_000,
        maxConcurrentExec: 3,
      perProjectMaxExec: 2,
        dockerImage: "node:22-alpine",
        sandboxMemoryMb: 512,
        sandboxCpus: 1,
      });
      const outsideFile = path.join(projB, "secret.txt");
      await expect(
        svc.assertSubprocessCommand(projA, `echo ${outsideFile}`),
      ).rejects.toMatchObject({ code: "path_escape" });
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("assertSubprocessCommand allows paths inside project", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "sandbox-cmd-ok-"));
    await writeFile(path.join(tmp, "local.txt"), "ok");
    try {
      const svc = new SandboxService({
        sandboxMode: "subprocess",
        execTimeoutMs: 30_000,
        maxConcurrentExec: 3,
      perProjectMaxExec: 2,
        dockerImage: "node:22-alpine",
        sandboxMemoryMb: 512,
        sandboxCpus: 1,
      });
      const inside = path.join(tmp, "local.txt");
      await expect(
        svc.assertSubprocessCommand(tmp, `echo ${inside}`),
      ).resolves.toBeUndefined();
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
