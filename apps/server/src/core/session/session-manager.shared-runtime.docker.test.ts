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

const DEFAULT_SDK_IMAGE = "cursor-sandbox-sdk:test";
const dockerfileDir = path.resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../../docker/sandbox-sdk",
);

describe.skipIf(!isDockerAvailable())(
  "SessionManager shared-runtime docker (05 + 04 POC 3)",
  () => {
    let ctx: AppContext;
    const manager = new DockerSandboxManager();
    const apiKey = process.env.CURSOR_API_KEY ?? "";

    beforeAll(async () => {
      const sdkImage = process.env.SANDBOX_DOCKER_IMAGE ?? DEFAULT_SDK_IMAGE;
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
        cursorApiKey: apiKey,
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

    it("executeRun records assistant + single run_done via RunEventLog", async () => {
      if (!apiKey) {
        return;
      }

      const dir = await mkdtemp(path.join(os.tmpdir(), "p6-sm-rt-"));
      const project = await prisma.project.create({
        data: {
          userId: "dev-user",
          name: "sm-shared-runtime",
          rootPath: dir,
          status: "active",
        },
      });

      const session = await ctx.sessionManager.createSession(
        project.id,
        "composer-2.5",
        dir,
        "test",
        "shared-runtime-sm",
      );

      const prepared = await ctx.sessionManager.prepareRun(
        session.id,
        "Reply with exactly: sm-poc3",
      );
      await ctx.sessionManager.recordQueued(prepared);

      await ctx.sessionManager.executeRun(
        prepared.runId,
        prepared.sessionId,
        prepared.projectId,
        "Reply with exactly: sm-poc3",
      );

      const events = await ctx.eventLog.replay(
        "session",
        prepared.sessionId,
        0,
      );
      const types = events.map((e) => e.event.type);
      const runDoneCount = types.filter((t) => t === "run_done").length;
      expect(runDoneCount).toBe(1);
      expect(types).toContain("assistant");
    }, 300_000);

    it("2nd executeRun reuses cached agent (05 §12 resume+cache)", async () => {
      if (!apiKey) {
        return;
      }

      const dir = await mkdtemp(path.join(os.tmpdir(), "p6-sm-rt2-"));
      const project = await prisma.project.create({
        data: {
          userId: "dev-user",
          name: "sm-shared-runtime-2",
          rootPath: dir,
          status: "active",
        },
      });

      const session = await ctx.sessionManager.createSession(
        project.id,
        "composer-2.5",
        dir,
        "test",
        "shared-runtime-2nd",
      );

      for (const prompt of ["Say hi briefly.", "Say bye briefly."]) {
        const prepared = await ctx.sessionManager.prepareRun(session.id, prompt);
        await ctx.sessionManager.recordQueued(prepared);
        await ctx.sessionManager.executeRun(
          prepared.runId,
          prepared.sessionId,
          prepared.projectId,
          prompt,
        );
      }

      const events = await ctx.eventLog.replay("session", session.id, 0);
      const runDoneCount = events.filter((e) => e.event.type === "run_done").length;
      expect(runDoneCount).toBe(2);
      expect(
        events.filter((e) => e.event.type === "assistant").length,
      ).toBeGreaterThanOrEqual(2);
    }, 600_000);
  },
);
