import { prisma } from "../db/client.js";

export async function getProjectOwner(projectId: string): Promise<string | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { userId: true },
  });
  return project?.userId ?? null;
}

export async function getSessionProject(
  sessionId: string,
): Promise<{ projectId: string; userId: string } | null> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { project: { select: { id: true, userId: true } } },
  });
  if (!session) return null;
  return { projectId: session.project.id, userId: session.project.userId };
}

export async function getRunContext(
  runId: string,
): Promise<{ sessionId: string; projectId: string; userId: string } | null> {
  const run = await prisma.run.findUnique({
    where: { id: runId },
    include: {
      session: { include: { project: { select: { id: true, userId: true } } } },
    },
  });
  if (!run) return null;
  return {
    sessionId: run.sessionId,
    projectId: run.session.project.id,
    userId: run.session.project.userId,
  };
}

export function ownsResource(userId: string, ownerId: string): boolean {
  return userId === ownerId;
}

export function accessDenied() {
  return {
    code: "forbidden",
    message: "Access denied to this resource",
    retryable: false,
  };
}

export function projectArchived() {
  return {
    code: "conflict",
    message: "Project is archived",
    retryable: false,
  };
}

async function assertProjectActive(
  projectId: string,
): Promise<{ ok: true } | { ok: false; error: ReturnType<typeof projectArchived> | { code: string; message: string; retryable: boolean } }> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { status: true },
  });
  if (!project) {
    return {
      ok: false,
      error: {
        code: "not_found",
        message: "Project not found",
        retryable: false,
      },
    };
  }
  if (project.status === "archived") {
    return { ok: false, error: projectArchived() };
  }
  return { ok: true };
}

export async function assertProjectAccess(
  userId: string,
  projectId: string,
): Promise<{ ok: true } | { ok: false; error: ReturnType<typeof accessDenied> | ReturnType<typeof projectArchived> | { code: string; message: string; retryable: boolean } }> {
  const ownerId = await getProjectOwner(projectId);
  if (!ownerId) {
    return {
      ok: false,
      error: {
        code: "not_found",
        message: "Project not found",
        retryable: false,
      },
    };
  }
  if (!ownsResource(userId, ownerId)) {
    return { ok: false, error: accessDenied() };
  }
  const active = await assertProjectActive(projectId);
  if (!active.ok) return active;
  return { ok: true };
}

export async function assertSessionAccess(
  userId: string,
  sessionId: string,
): Promise<
  | { ok: true; projectId: string }
  | { ok: false; error: ReturnType<typeof accessDenied> | { code: string; message: string; retryable: boolean } }
> {
  const ctx = await getSessionProject(sessionId);
  if (!ctx) {
    return {
      ok: false,
      error: {
        code: "not_found",
        message: "Session not found",
        retryable: false,
      },
    };
  }
  if (!ownsResource(userId, ctx.userId)) {
    return { ok: false, error: accessDenied() };
  }
  const active = await assertProjectActive(ctx.projectId);
  if (!active.ok) return active;
  return { ok: true, projectId: ctx.projectId };
}

export async function assertRunAccess(
  userId: string,
  runId: string,
): Promise<{ ok: true } | { ok: false; error: ReturnType<typeof accessDenied> | { code: string; message: string; retryable: boolean } }> {
  const ctx = await getRunContext(runId);
  if (!ctx) {
    return {
      ok: false,
      error: {
        code: "not_found",
        message: "Run not found",
        retryable: false,
      },
    };
  }
  if (!ownsResource(userId, ctx.userId)) {
    return { ok: false, error: accessDenied() };
  }
  return { ok: true };
}

export async function assertReplayAccess(
  userId: string,
  scope: "session" | "project" | "global",
  scopeId?: string,
): Promise<{ ok: true } | { ok: false; error: ReturnType<typeof accessDenied> | { code: string; message: string; retryable: boolean } }> {
  if (scope === "global") return { ok: true };
  if (scope === "project" && scopeId) {
    return assertProjectAccess(userId, scopeId);
  }
  if (scope === "session" && scopeId) {
    const result = await assertSessionAccess(userId, scopeId);
    if (!result.ok) return result;
    return { ok: true };
  }
  return {
    ok: false,
    error: {
      code: "validation_failed",
      message: "scopeId is required for session/project replay",
      retryable: false,
    },
  };
}
