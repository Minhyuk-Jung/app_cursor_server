import type { FastifyInstance } from "fastify";
import { Scope as ScopeEnum } from "@app/shared";
import { assertProjectAccess } from "../auth/access.js";
import { prisma } from "../db/client.js";
import type { GitService } from "../services/git/git-service.js";
import type { ServerConfig } from "../config.js";
import { sendError } from "./errors.js";
import type { createAuthService } from "../auth/auth.js";

type AuthService = ReturnType<typeof createAuthService>;

export async function registerGitRoutes(
  app: FastifyInstance,
  auth: AuthService,
  gitService: GitService,
  config: ServerConfig,
): Promise<void> {
  app.get<{ Params: { id: string }; Querystring: { paths?: string } }>(
    "/api/v1/projects/:id/git",
    async (request, reply) => {
      if (!auth.requireScope(request.auth!, ScopeEnum.PROJECT_READ)) {
        return sendError(reply, {
          code: "forbidden",
          message: "Insufficient scope",
          retryable: false,
        });
      }
      const access = await assertProjectAccess(
        request.auth!.userId,
        request.params.id,
      );
      if (!access.ok) return sendError(reply, access.error);

      const project = await prisma.project.findUnique({
        where: { id: request.params.id },
      });
      if (!project) {
        return sendError(reply, {
          code: "not_found",
          message: "Project not found",
          retryable: false,
        });
      }

      try {
        const status = await gitService.getRepoStatus(project.rootPath);
        return reply.send(status);
      } catch (err) {
        const e = err as { message?: string };
        return sendError(reply, {
          code: "internal_error",
          message: e.message ?? "Git status failed",
          retryable: false,
        });
      }
    },
  );

  app.get<{ Params: { id: string }; Querystring: { paths?: string } }>(
    "/api/v1/projects/:id/diff",
    async (request, reply) => {
      if (!auth.requireScope(request.auth!, ScopeEnum.PROJECT_READ)) {
        return sendError(reply, {
          code: "forbidden",
          message: "Insufficient scope",
          retryable: false,
        });
      }
      const access = await assertProjectAccess(
        request.auth!.userId,
        request.params.id,
      );
      if (!access.ok) return sendError(reply, access.error);

      const project = await prisma.project.findUnique({
        where: { id: request.params.id },
      });
      if (!project) {
        return sendError(reply, {
          code: "not_found",
          message: "Project not found",
          retryable: false,
        });
      }

      const paths = request.query.paths
        ? request.query.paths.split(",").filter(Boolean)
        : undefined;

      try {
        const diff = await gitService.getDiff(project.rootPath, paths);
        return reply.send(diff);
      } catch (err) {
        const e = err as { message?: string };
        return sendError(reply, {
          code: "internal_error",
          message: e.message ?? "Diff failed",
          retryable: false,
        });
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/v1/projects/:id/commit",
    async (request, reply) => {
      if (!auth.requireScope(request.auth!, ScopeEnum.GIT_WRITE)) {
        return sendError(reply, {
          code: "forbidden",
          message: "Insufficient scope",
          retryable: false,
        });
      }
      const access = await assertProjectAccess(
        request.auth!.userId,
        request.params.id,
      );
      if (!access.ok) return sendError(reply, access.error);

      const body = request.body as { message?: string; paths?: string[] };
      if (!body.message?.trim() || !body.paths?.length) {
        return sendError(reply, {
          code: "validation_failed",
          message: "message and paths are required",
          retryable: false,
        });
      }

      const project = await prisma.project.findUnique({
        where: { id: request.params.id },
      });
      if (!project) {
        return sendError(reply, {
          code: "not_found",
          message: "Project not found",
          retryable: false,
        });
      }

      try {
        const result = await gitService.commit(
          project.rootPath,
          body.message.trim(),
          body.paths,
        );
        return reply.send(result);
      } catch (err) {
        const e = err as { code?: string; message?: string };
        return sendError(reply, {
          code: e.code ?? "internal_error",
          message: e.message ?? "Commit failed",
          retryable: false,
        });
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/v1/projects/:id/push",
    async (request, reply) => {
      if (!auth.requireScope(request.auth!, ScopeEnum.GIT_WRITE)) {
        return sendError(reply, {
          code: "forbidden",
          message: "Insufficient scope",
          retryable: false,
        });
      }
      const access = await assertProjectAccess(
        request.auth!.userId,
        request.params.id,
      );
      if (!access.ok) return sendError(reply, access.error);

      const body = (request.body ?? {}) as { remote?: string; branch?: string };
      const project = await prisma.project.findUnique({
        where: { id: request.params.id },
      });
      if (!project) {
        return sendError(reply, {
          code: "not_found",
          message: "Project not found",
          retryable: false,
        });
      }

      try {
        const remoteUrl = await gitService.getRemoteUrl(
          project.rootPath,
          body.remote ?? "origin",
        );
        if (remoteUrl) {
          gitService.assertRemoteAllowed(remoteUrl, config.gitRemoteWhitelist);
        }
        const result = await gitService.push(
          project.rootPath,
          body.remote,
          body.branch,
        );
        return reply.send(result);
      } catch (err) {
        const e = err as { code?: string; message?: string };
        return sendError(reply, {
          code: e.code ?? "internal_error",
          message: e.message ?? "Push failed",
          retryable: e.code === "conflict",
        });
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/v1/projects/:id/pr",
    async (request, reply) => {
      if (!auth.requireScope(request.auth!, ScopeEnum.GIT_WRITE)) {
        return sendError(reply, {
          code: "forbidden",
          message: "Insufficient scope",
          retryable: false,
        });
      }
      const access = await assertProjectAccess(
        request.auth!.userId,
        request.params.id,
      );
      if (!access.ok) return sendError(reply, access.error);

      const body = request.body as {
        title?: string;
        body?: string;
        base?: string;
      };
      if (!body.title?.trim()) {
        return sendError(reply, {
          code: "validation_failed",
          message: "title is required",
          retryable: false,
        });
      }
      if (!config.githubToken) {
        return sendError(reply, {
          code: "not_implemented",
          message: "GITHUB_TOKEN is not configured",
          retryable: false,
        });
      }

      const project = await prisma.project.findUnique({
        where: { id: request.params.id },
      });
      if (!project) {
        return sendError(reply, {
          code: "not_found",
          message: "Project not found",
          retryable: false,
        });
      }

      const remoteUrl = await gitService.getRemoteUrl(project.rootPath);
      if (!remoteUrl) {
        return sendError(reply, {
          code: "conflict",
          message: "No git remote configured",
          retryable: false,
        });
      }

      const parsed = gitService.parseGithubRemote(remoteUrl);
      if (!parsed) {
        return sendError(reply, {
          code: "not_implemented",
          message: "Only GitHub remotes are supported for PR",
          retryable: false,
        });
      }

      const head = await gitService.currentBranch(project.rootPath);
      const base = body.base ?? "main";

      try {
        gitService.assertRemoteAllowed(remoteUrl, config.gitRemoteWhitelist);
        await gitService.push(project.rootPath, "origin", head);
        const pr = await gitService.createPullRequest({
          owner: parsed.owner,
          repo: parsed.repo,
          title: body.title.trim(),
          body: body.body ?? "",
          head,
          base,
          token: config.githubToken,
        });
        return reply.status(201).send(pr);
      } catch (err) {
        const e = err as { code?: string; message?: string };
        return sendError(reply, {
          code: e.code ?? "internal_error",
          message: e.message ?? "PR creation failed",
          retryable: false,
        });
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/v1/projects/:id/rollback",
    async (request, reply) => {
      if (!auth.requireScope(request.auth!, ScopeEnum.GIT_WRITE)) {
        return sendError(reply, {
          code: "forbidden",
          message: "Insufficient scope",
          retryable: false,
        });
      }
      const access = await assertProjectAccess(
        request.auth!.userId,
        request.params.id,
      );
      if (!access.ok) return sendError(reply, access.error);

      const body = request.body as { snapshotRef?: string; runId?: string };
      const project = await prisma.project.findUnique({
        where: { id: request.params.id },
      });
      if (!project) {
        return sendError(reply, {
          code: "not_found",
          message: "Project not found",
          retryable: false,
        });
      }

      let snapshotRef = body.snapshotRef;
      if (!snapshotRef && body.runId) {
        const run = await prisma.run.findUnique({
          where: { id: body.runId },
          include: { session: true },
        });
        if (!run || run.session.projectId !== project.id) {
          return sendError(reply, {
            code: "not_found",
            message: "Run not found",
            retryable: false,
          });
        }
        snapshotRef = run.snapshotRef ?? undefined;
      }

      if (!snapshotRef) {
        return sendError(reply, {
          code: "validation_failed",
          message: "snapshotRef or runId is required",
          retryable: false,
        });
      }

      try {
        await gitService.restoreSnapshot(project.rootPath, snapshotRef);
        return reply.send({ snapshotRef, restored: true });
      } catch (err) {
        const e = err as { message?: string };
        return sendError(reply, {
          code: "internal_error",
          message: e.message ?? "Rollback failed",
          retryable: false,
        });
      }
    },
  );
}
