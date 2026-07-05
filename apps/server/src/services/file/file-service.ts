import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  inferLanguage,
  isBinaryExtension,
  isImageLanguage,
} from "./language.js";
import { PathEscapeError, resolveSafePath, toRelativePath } from "./path-safe.js";

export interface TreeNode {
  name: string;
  path: string;
  type: "dir" | "file";
  children?: TreeNode[];
  size?: number;
}

export interface FileContent {
  path: string;
  language: string;
  encoding: "utf-8" | "binary";
  content?: string;
  truncated: boolean;
}

export interface SearchMatch {
  path: string;
  line: number;
  snippet: string;
}

const DEFAULT_SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  ".attachments",
  "__pycache__",
]);

const MAX_READ_BYTES = 1024 * 1024;
const MAX_SEARCH_FILE_BYTES = 256 * 1024;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export { MAX_ATTACHMENT_BYTES };

export interface FileServiceOptions {
  maxReadBytes?: number;
  skipDirs?: Set<string>;
}

export class FileService {
  private maxReadBytes: number;
  private skipDirs: Set<string>;

  constructor(options: FileServiceOptions = {}) {
    this.maxReadBytes = options.maxReadBytes ?? MAX_READ_BYTES;
    this.skipDirs = options.skipDirs ?? DEFAULT_SKIP_DIRS;
  }

  async getTree(projectRoot: string, subPath = ""): Promise<TreeNode> {
    const abs = await resolveSafePath(projectRoot, subPath);
    const st = await stat(abs);
    if (!st.isDirectory()) {
      throw Object.assign(new Error("Not a directory"), { code: "not_found" });
    }
    return this.buildTree(projectRoot, abs, "");
  }

  private async buildTree(
    projectRoot: string,
    absDir: string,
    relPath: string,
  ): Promise<TreeNode> {
    const name = relPath ? path.basename(relPath) : path.basename(absDir);
    const entries = await readdir(absDir, { withFileTypes: true });
    const children: TreeNode[] = [];

    const sorted = entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) {
        return a.isDirectory() ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    for (const entry of sorted) {
      if (entry.name.startsWith(".") && entry.name !== ".env.example") {
        if (this.skipDirs.has(entry.name) || entry.name === ".attachments") {
          continue;
        }
      }
      if (this.skipDirs.has(entry.name)) continue;

      const childRel = relPath ? `${relPath}/${entry.name}` : entry.name;
      const childAbs = path.join(absDir, entry.name);

      if (entry.isDirectory()) {
        children.push(await this.buildTree(projectRoot, childAbs, childRel));
      } else if (entry.isFile()) {
        const fst = await stat(childAbs);
        children.push({
          name: entry.name,
          path: childRel.replace(/\\/g, "/"),
          type: "file",
          size: fst.size,
        });
      }
    }

    return {
      name: name || ".",
      path: relPath.replace(/\\/g, "/"),
      type: "dir",
      children,
    };
  }

  async readFile(projectRoot: string, filePath: string): Promise<FileContent> {
    let abs: string;
    try {
      abs = await resolveSafePath(projectRoot, filePath);
    } catch (err) {
      throw err;
    }

    let st: Awaited<ReturnType<typeof stat>>;
    try {
      st = await stat(abs);
    } catch (err) {
      const e = err as { code?: string };
      if (e.code === "ENOENT") {
        throw Object.assign(new Error("Not found"), { code: "not_found" });
      }
      throw err;
    }
    if (!st.isFile()) {
      throw Object.assign(new Error("Not a file"), { code: "not_found" });
    }

    const language = inferLanguage(filePath);
    const rel = toRelativePath(projectRoot, abs);

    if (isImageLanguage(language)) {
      const buf = await readFile(abs);
      return {
        path: rel,
        language,
        encoding: "binary",
        content: buf.toString("base64"),
        truncated: false,
      };
    }

    if (isBinaryExtension(filePath) && language === "binary") {
      return {
        path: rel,
        language: "binary",
        encoding: "binary",
        truncated: false,
      };
    }

    const truncated = st.size > this.maxReadBytes;
    const buf = await readFile(abs);
    const slice = truncated ? buf.subarray(0, this.maxReadBytes) : buf;
    return {
      path: rel,
      language,
      encoding: "utf-8",
      content: slice.toString("utf-8"),
      truncated,
    };
  }

  private guardProtectedPath(relativePath: string): void {
    const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
    if (
      normalized === ".attachments" ||
      normalized.startsWith(".attachments/")
    ) {
      throw Object.assign(new Error("Protected path"), {
        code: "forbidden",
      });
    }
  }

  async createFile(
    projectRoot: string,
    filePath: string,
    content = "",
  ): Promise<{ path: string; bytes: number }> {
    this.guardProtectedPath(filePath);
    const abs = await resolveSafePath(projectRoot, filePath);
    try {
      await stat(abs);
      throw Object.assign(new Error("File already exists"), {
        code: "conflict",
      });
    } catch (err) {
      const e = err as { code?: string };
      if (e.code === "conflict") throw err;
      if (e.code !== "ENOENT") throw err;
    }
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content, "utf-8");
    const st = await stat(abs);
    return {
      path: toRelativePath(projectRoot, abs),
      bytes: st.size,
    };
  }

  async createDir(
    projectRoot: string,
    dirPath: string,
  ): Promise<{ path: string }> {
    this.guardProtectedPath(dirPath);
    const abs = await resolveSafePath(projectRoot, dirPath);
    await mkdir(abs, { recursive: true });
    return { path: toRelativePath(projectRoot, abs) };
  }

  async deletePath(
    projectRoot: string,
    targetPath: string,
  ): Promise<{ path: string }> {
    this.guardProtectedPath(targetPath);
    const abs = await resolveSafePath(projectRoot, targetPath);
    const rel = toRelativePath(projectRoot, abs);
    if (!rel) {
      throw Object.assign(new Error("Cannot delete project root"), {
        code: "validation_failed",
      });
    }
    await rm(abs, { recursive: true, force: true });
    return { path: rel };
  }

  async renamePath(
    projectRoot: string,
    fromPath: string,
    toPath: string,
  ): Promise<{ from: string; to: string }> {
    this.guardProtectedPath(fromPath);
    this.guardProtectedPath(toPath);
    const fromAbs = await resolveSafePath(projectRoot, fromPath);
    const toAbs = await resolveSafePath(projectRoot, toPath);
    try {
      await stat(toAbs);
      throw Object.assign(new Error("Target already exists"), {
        code: "conflict",
      });
    } catch (err) {
      const e = err as { code?: string };
      if (e.code !== "ENOENT") {
        if (e.code === "conflict") throw err;
      }
    }
    await mkdir(path.dirname(toAbs), { recursive: true });
    await rename(fromAbs, toAbs);
    return {
      from: toRelativePath(projectRoot, fromAbs),
      to: toRelativePath(projectRoot, toAbs),
    };
  }

  async writeFile(
    projectRoot: string,
    filePath: string,
    content: string,
  ): Promise<{ path: string; bytes: number }> {
    this.guardProtectedPath(filePath);
    const abs = await resolveSafePath(projectRoot, filePath);
    await mkdir(path.dirname(abs), { recursive: true });
    const tmp = `${abs}.${randomUUID()}.tmp`;
    await writeFile(tmp, content, "utf-8");
    await rename(tmp, abs);
    const st = await stat(abs);
    return {
      path: toRelativePath(projectRoot, abs),
      bytes: st.size,
    };
  }

  async search(
    projectRoot: string,
    query: string,
    maxResults = 50,
  ): Promise<SearchMatch[]> {
    if (!query.trim()) return [];
    const results: SearchMatch[] = [];
    await this.searchDir(projectRoot, projectRoot, query, results, maxResults);
    return results;
  }

  private async searchDir(
    projectRoot: string,
    absDir: string,
    query: string,
    results: SearchMatch[],
    maxResults: number,
  ): Promise<void> {
    if (results.length >= maxResults) return;
    const entries = await readdir(absDir, { withFileTypes: true });
    for (const entry of entries) {
      if (results.length >= maxResults) return;
      if (this.skipDirs.has(entry.name)) continue;
      if (entry.name.startsWith(".") && entry.name !== ".env.example") continue;

      const childAbs = path.join(absDir, entry.name);
      if (entry.isDirectory()) {
        await this.searchDir(projectRoot, childAbs, query, results, maxResults);
      } else if (entry.isFile()) {
        const rel = toRelativePath(projectRoot, childAbs);
        if (entry.name.toLowerCase().includes(query.toLowerCase())) {
          results.push({ path: rel, line: 0, snippet: entry.name });
        }
        if (results.length >= maxResults) return;
        if (isBinaryExtension(rel)) continue;
        const st = await stat(childAbs);
        if (st.size > MAX_SEARCH_FILE_BYTES) continue;
        try {
          const text = await readFile(childAbs, "utf-8");
          const lines = text.split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (results.length >= maxResults) return;
            const line = lines[i]!;
            if (line.toLowerCase().includes(query.toLowerCase())) {
              results.push({
                path: rel,
                line: i + 1,
                snippet: line.trim().slice(0, 200),
              });
            }
          }
        } catch {
          // skip unreadable
        }
      }
    }
  }

  attachmentsDir(projectRoot: string): string {
    return path.join(projectRoot, ".attachments");
  }

  async saveAttachment(
    projectRoot: string,
    data: Buffer,
    mime?: string,
  ): Promise<{ ref: string; mime?: string; size: number }> {
    if (data.length > MAX_ATTACHMENT_BYTES) {
      throw Object.assign(new Error("Attachment too large"), {
        code: "validation_failed",
      });
    }
    const dir = this.attachmentsDir(projectRoot);
    await mkdir(dir, { recursive: true });
    const ref = randomUUID();
    await writeFile(path.join(dir, ref), data);
    if (mime) {
      await writeFile(path.join(dir, `${ref}.mime`), mime, "utf8");
    }
    return { ref, mime, size: data.length };
  }

  async readAttachment(
    projectRoot: string,
    ref: string,
  ): Promise<{ data: Buffer; ref: string; mime?: string }> {
    if (!/^[0-9a-f-]{36}$/i.test(ref)) {
      throw Object.assign(new Error("Invalid ref"), { code: "validation_failed" });
    }
    const abs = await resolveSafePath(
      projectRoot,
      path.join(".attachments", ref),
    );
    const data = await readFile(abs);
    let mime: string | undefined;
    try {
      const mimePath = path.join(this.attachmentsDir(projectRoot), `${ref}.mime`);
      mime = (await readFile(mimePath, "utf8")).trim() || undefined;
    } catch {
      // optional sidecar
    }
    return { data, ref, mime };
  }
}

/** UR-15/P7 — Message에 없는 오래된 첨부 blob 정리 */
export async function purgeOrphanAttachments(
  projectRoot: string,
  referencedRefs: Set<string>,
  minAgeMs = 86_400_000,
): Promise<number> {
  const dir = path.join(projectRoot, ".attachments");
  let removed = 0;
  try {
    const entries = await readdir(dir);
    const now = Date.now();
    for (const entry of entries) {
      if (entry.endsWith(".mime")) continue;
      if (!/^[0-9a-f-]{36}$/i.test(entry)) continue;
      if (referencedRefs.has(entry)) continue;
      const full = path.join(dir, entry);
      const st = await stat(full);
      if (now - st.mtimeMs < minAgeMs) continue;
      await rm(full, { force: true });
      await rm(path.join(dir, `${entry}.mime`), { force: true });
      removed += 1;
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw err;
  }
  return removed;
}

export { PathEscapeError };
