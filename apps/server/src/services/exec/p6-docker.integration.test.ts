import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createApp, type AppContext } from "../../app.js";
import { prisma, disconnectDb } from "../../db/client.js";
import { useTestDatabase } from "../../test-helpers/db.js";
import {
  DockerSandboxManager,
  isDockerAvailable,
} from "./docker-sandbox-manager.js";

const AUTH = { authorization: "Bearer dev-local-key" };

function dockerOnly() {
  return isDockerAvailable();
}

describe.skipIf(!dockerOnly())("P6 S17 docker preview integration", () => {
  let ctx: AppContext;
  let baseUrl: string;
  let tmpDir: string;
  const manager = new DockerSandboxManager();

  beforeAll(async () => {
    await useTestDatabase("file:./test-p6-docker-int.db");
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "p6-docker-int-"));
    ctx = await createApp({ port: 0, sandboxMode: "docker" });
    await ctx.app.listen({ port: 0, host: "127.0.0.1" });
    const addr = ctx.app.server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    if (ctx) await ctx.app.close();
    await disconnectDb();
  });

  afterEach(async () => {
    const names = manager.listManagedContainerNames();
    for (const name of names) {
      manager.removeContainer(name);
    }
  });

  it("proxies HTTP preview to dev server listening on 0.0.0.0 inside container (UR-10/S17)", async () => {
    const project = await prisma.project.create({
      data: {
        userId: "dev-user",
        name: "docker-preview-int",
        rootPath: tmpDir,
        status: "active",
      },
    });

    const previewPort = 9876;
    await ctx.execService.runToCompletion({
      projectId: project.id,
      projectRoot: tmpDir,
      command: "echo warm",
    });

    const session = ctx.sandboxSessions.get(project.id);
    expect(session?.containerName).toBeTruthy();

    const serverScript =
      "require('http').createServer((q,s)=>{s.writeHead(200);s.end('s17-docker-preview')}).listen(" +
      `${previewPort},'0.0.0.0')`;
    execFileSync(
      "docker",
      [
        "exec",
        "-d",
        session!.containerName!,
        "node",
        "-e",
        serverScript,
      ],
      { stdio: "ignore" },
    );
    await new Promise((r) => setTimeout(r, 800));

    const issue = await ctx.app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/preview`,
      headers: AUTH,
      payload: { port: previewPort },
    });
    expect(issue.statusCode).toBe(200);
    const { previewPath } = issue.json() as { previewPath: string };

    const proxy = await ctx.app.inject({
      method: "GET",
      url: previewPath,
    });
    expect(proxy.statusCode).toBe(200);
    expect(proxy.body).toContain("s17-docker-preview");
  }, 120_000);

  it("runs npm test inside docker sandbox with stdout (S17/UR-09)", async () => {
    await writeFile(
      path.join(tmpDir, "package.json"),
      JSON.stringify({
        name: "s17-docker-npm",
        scripts: {
          test: 'node -e "console.log(\'s17-docker-npm-ok\')"',
        },
      }),
    );

    const project = await prisma.project.create({
      data: {
        userId: "dev-user",
        name: "docker-npm-int",
        rootPath: tmpDir,
        status: "active",
      },
    });

    const result = await ctx.execService.runToCompletion({
      projectId: project.id,
      projectRoot: tmpDir,
      command: "npm test",
    });

    expect(result.stdout).toContain("s17-docker-npm-ok");
    expect(result.exitCode).toBe(0);
    expect(ctx.sandboxSessions.get(project.id)?.containerName).toBeTruthy();
  }, 120_000);

  it("SEC-04: docker exec cannot read sibling project files (NFR-23)", async () => {
    const dirA = path.join(tmpDir, "sec-a");
    const dirB = path.join(tmpDir, "sec-b");
    await mkdir(dirA, { recursive: true });
    await mkdir(dirB, { recursive: true });
    await writeFile(path.join(dirB, "secret.txt"), "sibling-secret");

    const projectA = await prisma.project.create({
      data: {
        userId: "dev-user",
        name: "docker-sec-a",
        rootPath: dirA,
        status: "active",
      },
    });

    const siblingFile = path.join(dirB, "secret.txt").replace(/\\/g, "/");
    const result = await ctx.execService.runToCompletion({
      projectId: projectA.id,
      projectRoot: dirA,
      command: `cat "${siblingFile}"`,
    });

    expect(result.stdout).not.toContain("sibling-secret");
    expect(result.exitCode).not.toBe(0);
  }, 120_000);

  it("ADR-007: sandbox container provides Node.js for shared-runtime POC", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "p6-node-rt-"));
    const project = await prisma.project.create({
      data: {
        userId: "dev-user",
        name: "docker-node-rt",
        rootPath: dir,
        status: "active",
      },
    });

    ctx.sandboxSessions.ensurePrepared(project.id, dir, false);
    const session = ctx.sandboxSessions.get(project.id);
    expect(session?.containerName).toBeTruthy();

    const { verifyContainerNodeRuntime } = await import(
      "../../core/sdk/sdk-container-runtime.js"
    );
    verifyContainerNodeRuntime(session!.containerName!);
  }, 60_000);

  it("NFR-13: docker memory limit kills heavy allocation", async () => {
    const lowMemDir = await mkdtemp(path.join(os.tmpdir(), "p6-mem-"));
    const project = await prisma.project.create({
      data: {
        userId: "dev-user",
        name: "docker-mem-limit",
        rootPath: lowMemDir,
        status: "active",
      },
    });

    const lowMemCtx = await createApp({
      port: 0,
      sandboxMode: "docker",
      sandboxMemoryMb: 64,
    });
    await lowMemCtx.app.listen({ port: 0, host: "127.0.0.1" });

    try {
      const result = await lowMemCtx.execService.runToCompletion({
        projectId: project.id,
        projectRoot: lowMemDir,
        command:
          'node -e "const b=[];for(;;)b.push(Buffer.alloc(1024*1024))"',
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.errorCode).toBe("exec_memory_limit");

      const deadline = Date.now() + 5000;
      let notes: Awaited<ReturnType<typeof prisma.notification.findMany>> = [];
      while (Date.now() < deadline) {
        notes = await prisma.notification.findMany({
          where: {
            userId: "dev-user",
            kind: "exec_memory_limit",
            projectId: project.id,
          },
        });
        if (notes.length >= 1) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      expect(notes).toHaveLength(1);
      expect(notes[0].deeplink).toBe(`/project/${project.id}/terminal`);
    } finally {
      await lowMemCtx.app.close();
      manager.removeContainer(
        manager.containerNameFor(project.id),
      );
    }
  }, 120_000);
});

describe("P6 docker unavailable guard", () => {
  it.skipIf(isDockerAvailable())(
    "rejects preview when SANDBOX_MODE=docker but Docker missing",
    async () => {
      const ctx = await createApp({ port: 0, sandboxMode: "docker" });
      const project = await prisma.project.create({
        data: {
          userId: "dev-user",
          name: "no-docker",
          rootPath: path.join(process.cwd(), "test-workspaces", "no-docker"),
          status: "active",
        },
      });

      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/v1/projects/${project.id}/preview`,
        headers: AUTH,
        payload: { port: 5173 },
      });
      expect(res.statusCode).toBe(503);
      const body = res.json() as { error?: { code?: string } };
      expect(body.error?.code).toBe("docker_unavailable");
      await ctx.app.close();
    },
  );
});
