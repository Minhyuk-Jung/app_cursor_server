import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ExecService } from "./exec-service.js";
import { SandboxService } from "./sandbox-service.js";
import { buildSandboxEnv, isPreviewPortAllowed } from "./types.js";

function makeSandbox(overrides?: Partial<ConstructorParameters<typeof SandboxService>[0]>) {
  return new SandboxService({
    sandboxMode: "subprocess",
    execTimeoutMs: 30_000,
    maxConcurrentExec: 3,
    perProjectMaxExec: 2,
    dockerImage: "node:22-alpine",
    sandboxMemoryMb: 512,
    sandboxCpus: 1,
    ...overrides,
  });
}

describe("ExecService (P6)", () => {
  let tmpDir: string;
  let exec: ExecService;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "exec-svc-"));
    exec = new ExecService(makeSandbox());
  });

  afterEach(async () => {
    exec.cancelAll();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("runs command in project cwd and streams stdout", async () => {
    await writeFile(path.join(tmpDir, "hello.txt"), "world");

    const chunks: string[] = [];
    let exitCode: number | null = null;

    await exec.run({
      projectRoot: tmpDir,
      command: process.platform === "win32" ? "type hello.txt" : "cat hello.txt",
      onMessage: (msg) => {
        if (msg.type === "stdout") chunks.push(msg.data);
        if (msg.type === "exit") exitCode = msg.code;
      },
    });

    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (exitCode !== null) {
          clearInterval(check);
          resolve();
        }
      }, 20);
    });

    expect(chunks.join("")).toContain("world");
    expect(exitCode).toBe(0);
  });

  it("rejects cwd outside project root (SEC-04 path guard)", async () => {
    await expect(
      exec.run({
        projectRoot: tmpDir,
        command: "echo hi",
        cwd: "../../../etc",
        onMessage: () => {},
      }),
    ).rejects.toMatchObject({ code: "path_escape" });
  });

  it("rejects command with absolute path outside project (SEC-04)", async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), "exec-sec04-"));
    const projA = path.join(base, "proj-a");
    const projB = path.join(base, "proj-b");
    await mkdir(projA, { recursive: true });
    await mkdir(projB, { recursive: true });
    await writeFile(path.join(projB, "secret.txt"), "leak");

    const outside = path.join(projB, "secret.txt");
    await expect(
      exec.run({
        projectRoot: projA,
        command: process.platform === "win32" ? `type ${outside}` : `cat ${outside}`,
        onMessage: () => {},
      }),
    ).rejects.toMatchObject({ code: "path_escape" });

    await rm(base, { recursive: true, force: true });
  });

  it("runToCompletion collects stdout and exit code", async () => {
    const result = await exec.runToCompletion({
      projectRoot: tmpDir,
      command: process.platform === "win32" ? "echo done-ok" : "echo done-ok",
    });
    expect(result.stdout).toContain("done-ok");
    expect(result.exitCode).toBe(0);
  });

  it("kills long-running exec after execTimeoutMs (NFR-13)", async () => {
    const timed = new ExecService(makeSandbox({ execTimeoutMs: 500 }));
    const slowCmd =
      process.platform === "win32"
        ? "ping -n 6 127.0.0.1"
        : "sleep 3";
    const errors: Array<{ type: string; code?: string }> = [];
    let exitCode: number | null = null;

    await new Promise<void>((resolve) => {
      void timed
        .run({
          projectRoot: tmpDir,
          command: slowCmd,
          onMessage: (msg) => {
            if (msg.type === "error") errors.push(msg);
            if (msg.type === "exit") {
              exitCode = msg.code;
              resolve();
            }
          },
        })
        .catch(() => resolve());
    });

    expect(exitCode).not.toBe(0);
    expect(errors.some((m) => m.code === "exec_timeout")).toBe(true);
  }, 10_000);

  it("cancelProjectExecs terminates project exec (§6.4)", async () => {
    const limits: Array<{ kind: string }> = [];
    const { SandboxSessionRegistry } = await import("./sandbox-session-registry.js");
    const sessions = new SandboxSessionRegistry({
      memoryMb: 512,
      cpus: 1,
      execTimeoutMs: 30_000,
    });
    const tracked = new ExecService(makeSandbox(), sessions, (event) => {
      limits.push(event);
    });

    void tracked.run({
      projectId: "proj-cancel",
      projectRoot: tmpDir,
      command: 'node -e "setInterval(()=>{}, 60000)"',
      onMessage: () => {},
    });

    await new Promise((r) => setTimeout(r, 200));
    expect(tracked.getActiveCountForProject("proj-cancel")).toBe(1);
    expect(tracked.cancelProjectExecs("proj-cancel")).toBe(1);
    expect(limits).toHaveLength(0);

    const deadline = Date.now() + 5000;
    while (
      Date.now() < deadline &&
      tracked.getActiveCountForProject("proj-cancel") > 0
    ) {
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(tracked.getActiveCountForProject("proj-cancel")).toBe(0);
    tracked.cancelAll();
  }, 15_000);

  it("does not fire resource limit callback on handle.cancel (13 §9)", async () => {
    const limits: Array<{ kind: string }> = [];
    const svc = new ExecService(makeSandbox(), undefined, (event) => {
      limits.push(event);
    });
    const slowCmd =
      process.platform === "win32"
        ? "ping -n 30 127.0.0.1"
        : "sleep 30";

    await new Promise<void>((resolve) => {
      void svc
        .run({
          projectId: "proj-user-cancel",
          projectRoot: tmpDir,
          command: slowCmd,
          onMessage: (msg) => {
            if (msg.type === "exit") resolve();
          },
        })
        .then((handle) => {
          setTimeout(() => handle.cancel(), 150);
        })
        .catch(() => resolve());
    });

    expect(limits).toHaveLength(0);
  }, 15_000);

  it("enforces max concurrent exec limit", () => {
    const limited = makeSandbox({ maxConcurrentExec: 1 });
    const limitedExec = new ExecService(limited);
    (
      limitedExec as unknown as { active: Map<string, unknown> }
    ).active.set("reserved", { proc: null });
    expect(limitedExec.canAcceptMore()).toBe(false);
    expect(limitedExec.getActiveCount()).toBe(1);
  });

  it("enforces per-project exec limit", async () => {
    const limited = makeSandbox({ perProjectMaxExec: 1, maxConcurrentExec: 5 });
    const limitedExec = new ExecService(limited);
    const holdCmd =
      process.platform === "win32"
        ? 'ping -n 60 127.0.0.1 > nul'
        : 'sleep 60';

    await limitedExec.run({
      projectId: "proj-limit",
      projectRoot: tmpDir,
      command: holdCmd,
      onMessage: () => {},
    });
    await new Promise((r) => setTimeout(r, 100));

    await expect(
      limitedExec.run({
        projectId: "proj-limit",
        projectRoot: tmpDir,
        command: "echo blocked",
        onMessage: () => {},
      }),
    ).rejects.toMatchObject({ code: "project_exec_limit" });

    limitedExec.cancelProjectExecs("proj-limit");
    await new Promise((r) => setTimeout(r, 500));
    limitedExec.cancelAll();
  }, 15_000);

  it("exposes exec timeout from sandbox config", () => {
    const sandbox = makeSandbox({ execTimeoutMs: 1234 });
    expect(sandbox.getExecConfig().execTimeoutMs).toBe(1234);
  });
});

describe("sandbox helpers (P6)", () => {
  it("buildSandboxEnv omits server secrets from child env", () => {
    const prev = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgres://secret";
    const env = buildSandboxEnv("/tmp/ws");
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.HOME).toBe("/tmp/ws");
    process.env.DATABASE_URL = prev;
  });

  it("validates preview port range", () => {
    expect(isPreviewPortAllowed(5173, 3000, 9999)).toBe(true);
    expect(isPreviewPortAllowed(22, 3000, 9999)).toBe(false);
    expect(isPreviewPortAllowed(10000, 3000, 9999)).toBe(false);
  });
});

describe("PreviewRegistry (P6)", () => {
  it("issues and validates preview tokens", async () => {
    const { PreviewRegistry } = await import("./preview-registry.js");
    const reg = new PreviewRegistry();
    const entry = reg.issue({
      projectId: "p1",
      userId: "u1",
      port: 5173,
      ttlMs: 60_000,
    });
    expect(reg.get(entry.token)?.port).toBe(5173);
    reg.revoke(entry.token);
    expect(reg.get(entry.token)).toBeNull();
  });

  it("expires tokens after ttl", async () => {
    const { PreviewRegistry } = await import("./preview-registry.js");
    const reg = new PreviewRegistry();
    const entry = reg.issue({
      projectId: "p1",
      userId: "u1",
      port: 5173,
      ttlMs: 1,
    });
    await new Promise((r) => setTimeout(r, 15));
    expect(reg.get(entry.token)).toBeNull();
  });
});
