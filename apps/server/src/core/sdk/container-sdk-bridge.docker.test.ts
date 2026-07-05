import { execFileSync } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createApp, type AppContext } from "../../app.js";
import { prisma, disconnectDb } from "../../db/client.js";
import {
  DockerSandboxManager,
  isDockerAvailable,
} from "../../services/exec/docker-sandbox-manager.js";
import { verifyContainerSdkPackage } from "./sdk-container-runtime.js";

const DEFAULT_SDK_IMAGE = "cursor-sandbox-sdk:test";
const dockerfileDir = path.resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../../docker/sandbox-sdk",
);

function resolveSdkImage(): string {
  return process.env.SANDBOX_DOCKER_IMAGE ?? DEFAULT_SDK_IMAGE;
}

describe.skipIf(!isDockerAvailable())(
  "ContainerSdkBridge docker integration (ADR-007 POC 3)",
  () => {
    let ctx: AppContext;
    let sdkImage: string;
    const manager = new DockerSandboxManager();

    beforeAll(async () => {
      sdkImage = resolveSdkImage();
      if (!process.env.SANDBOX_DOCKER_IMAGE) {
        execFileSync(
          "docker",
          ["build", "-t", sdkImage, dockerfileDir],
          { stdio: "inherit" },
        );
      }
      ctx = await createApp({
        port: 0,
        sandboxMode: "docker",
        sandboxDockerImage: sdkImage,
        sdkInContainer: true,
      });
      await ctx.app.listen({ port: 0, host: "127.0.0.1" });
    });

    afterAll(async () => {
      if (ctx) await ctx.app.close();
      await disconnectDb();
    });

    afterEach(async () => {
      for (const name of manager.listManagedContainerNames()) {
        manager.removeContainer(name);
      }
    });

    it("sandbox-sdk image provides @cursor/sdk in container", async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), "p6-sdk-bridge-"));
      const project = await prisma.project.create({
        data: {
          userId: "dev-user",
          name: "sdk-bridge-pkg",
          rootPath: dir,
          status: "active",
        },
      });

      ctx.sandboxSessions.ensurePrepared(project.id, dir, false);
      const session = ctx.sandboxSessions.get(project.id);
      expect(session?.containerName).toBeTruthy();
      verifyContainerSdkPackage(session!.containerName!);
    }, 120_000);

    it("SdkAdapter createAgent uses container bridge when SDK_IN_CONTAINER", async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), "p6-sdk-create-"));
      const project = await prisma.project.create({
        data: {
          userId: "dev-user",
          name: "sdk-bridge-create",
          rootPath: dir,
          status: "active",
        },
      });

      ctx.sandboxSessions.ensurePrepared(project.id, dir, false);

      const apiKey = process.env.CURSOR_API_KEY;
      if (!apiKey) {
        await expect(
          ctx.sdk.createAgent({
            cwd: dir,
            model: "composer-2.5",
            apiKey: "invalid-key-for-bridge-path",
            projectId: project.id,
          }),
        ).rejects.toBeTruthy();
        return;
      }

      const handle = await ctx.sdk.createAgent({
        cwd: dir,
        model: "composer-2.5",
        apiKey,
        projectId: project.id,
      });
      expect(handle.agentId).toBeTruthy();
      await handle.dispose();
    }, 180_000);

    it("send → streamEvents → wait matches SessionManager contract (04 §6.4)", async () => {
      const apiKey = process.env.CURSOR_API_KEY;
      if (!apiKey) {
        return;
      }

      const dir = await mkdtemp(path.join(os.tmpdir(), "p6-sdk-send-"));
      const project = await prisma.project.create({
        data: {
          userId: "dev-user",
          name: "sdk-bridge-send",
          rootPath: dir,
          status: "active",
        },
      });

      ctx.sandboxSessions.ensurePrepared(project.id, dir, false);
      const agent = await ctx.sdk.createAgent({
        cwd: dir,
        model: "composer-2.5",
        apiKey,
        projectId: project.id,
      });

      const run = await agent.send("Reply with exactly: poc3-ok");
      const streamEvents: Array<{ type: string }> = [];
      for await (const event of run.streamEvents()) {
        streamEvents.push(event);
        expect(event.type).not.toBe("run_done");
      }

      const result = await run.wait();
      expect(["finished", "error", "cancelled"]).toContain(result.status);
      expect(streamEvents.some((e) => e.type === "assistant")).toBe(true);
      await agent.dispose();
    }, 300_000);
  },
);
