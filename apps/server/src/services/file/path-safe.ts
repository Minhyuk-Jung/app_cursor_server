import path from "node:path";
import { realpath } from "node:fs/promises";

export class PathEscapeError extends Error {
  readonly code = "path_escape";

  constructor(message = "Path escapes project root") {
    super(message);
  }
}

/** 11 §6.1 — 프로젝트 rootPath 내부 경로만 허용 */
export async function resolveSafePath(
  rootPath: string,
  relativePath: string,
): Promise<string> {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (normalized.includes("\0")) {
    throw new PathEscapeError();
  }

  const segments = normalized.split("/").filter(Boolean);
  if (segments.some((s) => s === "..")) {
    throw new PathEscapeError();
  }

  const candidate = path.resolve(rootPath, ...segments);
  const rootReal = await realpath(rootPath);
  let targetReal: string;
  try {
    targetReal = await realpath(candidate);
  } catch {
    const parent = path.dirname(candidate);
    const parentReal = await realpath(parent).catch(() => parent);
    targetReal = path.resolve(parentReal, path.basename(candidate));
  }

  const within =
    targetReal === rootReal ||
    (!path.relative(rootReal, targetReal).startsWith("..") &&
      !path.isAbsolute(path.relative(rootReal, targetReal)));
  if (!within) {
    throw new PathEscapeError();
  }

  return targetReal;
}

export function toRelativePath(rootPath: string, absolutePath: string): string {
  return path.relative(rootPath, absolutePath).replace(/\\/g, "/");
}

/** SEC-04 — 절대 경로가 프로젝트 rootPath 내부인지 검증 (subprocess 명령 스캔용) */
export async function assertAbsoluteWithinRoot(
  rootPath: string,
  absolutePath: string,
): Promise<string> {
  const normalized = path.resolve(absolutePath);
  const rootReal = await realpath(rootPath);
  let targetReal: string;
  try {
    targetReal = await realpath(normalized);
  } catch {
    const parent = path.dirname(normalized);
    const parentReal = await realpath(parent).catch(() => parent);
    targetReal = path.resolve(parentReal, path.basename(normalized));
  }

  const within =
    targetReal === rootReal ||
    (!path.relative(rootReal, targetReal).startsWith("..") &&
      !path.isAbsolute(path.relative(rootReal, targetReal)));
  if (!within) {
    throw new PathEscapeError("Absolute path escapes project root");
  }
  return targetReal;
}
