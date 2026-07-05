import type { FastifyInstance } from "fastify";
import { Scope as ScopeEnum } from "@app/shared";
import { assertProjectAccess } from "../auth/access.js";
import { prisma } from "../db/client.js";
import {
  FileService,
  PathEscapeError,
} from "../services/file/file-service.js";
import { sendError } from "./errors.js";
import type { createAuthService } from "../auth/auth.js";

type AuthService = ReturnType<typeof createAuthService>;

async function projectRoot(projectId: string): Promise<string | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { rootPath: true },
  });
  return project?.rootPath ?? null;
}

function fileError(err: unknown) {
  if (err instanceof PathEscapeError) {
    return {
      code: "forbidden",
      message: "Path access denied",
      retryable: false,
    };
  }
  const e = err as { code?: string; message?: string };
  if (e.code === "not_found") {
    return {
      code: "not_found",
      message: e.message ?? "Not found",
      retryable: false,
    };
  }
  if (e.code === "validation_failed") {
    return {
      code: "validation_failed",
      message: e.message ?? "Validation failed",
      retryable: false,
    };
  }
  if (e.code === "conflict") {
    return {
      code: "conflict",
      message: e.message ?? "Conflict",
      retryable: false,
    };
  }
  if (e.code === "forbidden") {
    return {
      code: "forbidden",
      message: e.message ?? "Forbidden",
      retryable: false,
    };
  }
  return {
    code: "internal_error",
    message: e.message ?? "File operation failed",
    retryable: false,
  };
}

export async function registerFileRoutes(
  app: FastifyInstance,
  auth: AuthService,
  fileService: FileService,
): Promise<void> {
  app.get<{ Params: { id: string } }>(
    "/api/v1/projects/:id/tree",
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

      const root = await projectRoot(request.params.id);
      if (!root) {
        return sendError(reply, {
          code: "not_found",
          message: "Project not found",
          retryable: false,
        });
      }

      try {
        const tree = await fileService.getTree(root);
        return reply.send({ tree });
      } catch (err) {
        return sendError(reply, fileError(err));
      }
    },
  );

  app.get<{
    Params: { id: string };
    Querystring: { path?: string };
  }>("/api/v1/projects/:id/file", async (request, reply) => {
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

    const filePath = request.query.path;
    if (!filePath) {
      return sendError(reply, {
        code: "validation_failed",
        message: "path query is required",
        retryable: false,
      });
    }

    const root = await projectRoot(request.params.id);
    if (!root) {
      return sendError(reply, {
        code: "not_found",
        message: "Project not found",
        retryable: false,
      });
    }

    try {
      const file = await fileService.readFile(root, filePath);
      return reply.send(file);
    } catch (err) {
      return sendError(reply, fileError(err));
    }
  });

  app.put<{ Params: { id: string } }>(
    "/api/v1/projects/:id/file",
    async (request, reply) => {
      if (!auth.requireScope(request.auth!, ScopeEnum.PROJECT_WRITE)) {
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

      const body = request.body as { path?: string; content?: string };
      if (!body.path || body.content === undefined) {
        return sendError(reply, {
          code: "validation_failed",
          message: "path and content are required",
          retryable: false,
        });
      }

      const root = await projectRoot(request.params.id);
      if (!root) {
        return sendError(reply, {
          code: "not_found",
          message: "Project not found",
          retryable: false,
        });
      }

      try {
        const result = await fileService.writeFile(
          root,
          body.path,
          body.content,
        );
        return reply.send(result);
      } catch (err) {
        return sendError(reply, fileError(err));
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/v1/projects/:id/file",
    async (request, reply) => {
      if (!auth.requireScope(request.auth!, ScopeEnum.PROJECT_WRITE)) {
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
        path?: string;
        kind?: "file" | "dir";
        content?: string;
      };
      if (!body.path || !body.kind) {
        return sendError(reply, {
          code: "validation_failed",
          message: "path and kind are required",
          retryable: false,
        });
      }

      const root = await projectRoot(request.params.id);
      if (!root) {
        return sendError(reply, {
          code: "not_found",
          message: "Project not found",
          retryable: false,
        });
      }

      try {
        if (body.kind === "dir") {
          const result = await fileService.createDir(root, body.path);
          return reply.status(201).send(result);
        }
        const result = await fileService.createFile(
          root,
          body.path,
          body.content ?? "",
        );
        return reply.status(201).send(result);
      } catch (err) {
        return sendError(reply, fileError(err));
      }
    },
  );

  app.delete<{
    Params: { id: string };
    Querystring: { path?: string };
  }>("/api/v1/projects/:id/file", async (request, reply) => {
    if (!auth.requireScope(request.auth!, ScopeEnum.PROJECT_WRITE)) {
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

    const filePath = request.query.path;
    if (!filePath) {
      return sendError(reply, {
        code: "validation_failed",
        message: "path query is required",
        retryable: false,
      });
    }

    const root = await projectRoot(request.params.id);
    if (!root) {
      return sendError(reply, {
        code: "not_found",
        message: "Project not found",
        retryable: false,
      });
    }

    try {
      const result = await fileService.deletePath(root, filePath);
      return reply.send(result);
    } catch (err) {
      return sendError(reply, fileError(err));
    }
  });

  app.patch<{ Params: { id: string } }>(
    "/api/v1/projects/:id/file",
    async (request, reply) => {
      if (!auth.requireScope(request.auth!, ScopeEnum.PROJECT_WRITE)) {
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

      const body = request.body as { from?: string; to?: string };
      if (!body.from || !body.to) {
        return sendError(reply, {
          code: "validation_failed",
          message: "from and to are required",
          retryable: false,
        });
      }

      const root = await projectRoot(request.params.id);
      if (!root) {
        return sendError(reply, {
          code: "not_found",
          message: "Project not found",
          retryable: false,
        });
      }

      try {
        const result = await fileService.renamePath(root, body.from, body.to);
        return reply.send(result);
      } catch (err) {
        return sendError(reply, fileError(err));
      }
    },
  );

  app.get<{
    Params: { id: string };
    Querystring: { q?: string };
  }>("/api/v1/projects/:id/search", async (request, reply) => {
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

    const root = await projectRoot(request.params.id);
    if (!root) {
      return sendError(reply, {
        code: "not_found",
        message: "Project not found",
        retryable: false,
      });
    }

    try {
      const matches = await fileService.search(root, request.query.q ?? "");
      return reply.send({ matches });
    } catch (err) {
      return sendError(reply, fileError(err));
    }
  });

  app.post<{ Params: { id: string } }>(
    "/api/v1/projects/:id/attachments",
    async (request, reply) => {
      if (!auth.requireScope(request.auth!, ScopeEnum.PROJECT_WRITE)) {
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

      const root = await projectRoot(request.params.id);
      if (!root) {
        return sendError(reply, {
          code: "not_found",
          message: "Project not found",
          retryable: false,
        });
      }

      try {
        let data: Buffer;
        let mime: string | undefined;

        if (request.isMultipart()) {
          let part;
          try {
            part = await request.file();
          } catch (err) {
            if ((err as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE") {
              return sendError(reply, {
                code: "validation_failed",
                message: "Attachment too large",
                retryable: false,
              });
            }
            throw err;
          }
          if (!part) {
            return sendError(reply, {
              code: "validation_failed",
              message: "multipart file field is required",
              retryable: false,
            });
          }
          data = await part.toBuffer();
          mime = part.mimetype || undefined;
        } else {
          const body = request.body as {
            dataBase64?: string;
            mime?: string;
          };
          if (!body.dataBase64) {
            return sendError(reply, {
              code: "validation_failed",
              message: "dataBase64 is required (or use multipart/form-data)",
              retryable: false,
            });
          }
          data = Buffer.from(body.dataBase64, "base64");
          mime = body.mime;
        }

        const saved = await fileService.saveAttachment(root, data, mime);
        return reply.status(201).send(saved);
      } catch (err) {
        return sendError(reply, fileError(err));
      }
    },
  );

  app.get<{ Params: { id: string; ref: string } }>(
    "/api/v1/projects/:id/attachments/:ref",
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

      const root = await projectRoot(request.params.id);
      if (!root) {
        return sendError(reply, {
          code: "not_found",
          message: "Project not found",
          retryable: false,
        });
      }

      try {
        const { data, mime } = await fileService.readAttachment(
          root,
          request.params.ref,
        );
        const contentType = mime ?? "application/octet-stream";
        const ext =
          contentType.startsWith("image/") ?
            contentType.slice("image/".length).split("+")[0]
          : "bin";
        return reply
          .header("Content-Type", contentType)
          .header(
            "Content-Disposition",
            `inline; filename="attachment-${request.params.ref.slice(0, 8)}.${ext}"`,
          )
          .send(data);
      } catch (err) {
        return sendError(reply, fileError(err));
      }
    },
  );
}
