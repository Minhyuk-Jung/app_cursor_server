import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileService, PathEscapeError } from "./file-service.js";
import { resolveSafePath } from "./path-safe.js";

describe("path-safe (SEC-01)", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "file-svc-"));
    await writeFile(path.join(tmp, "hello.txt"), "hello");
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("allows files inside root", async () => {
    const resolved = await resolveSafePath(tmp, "hello.txt");
    expect(resolved).toContain("hello.txt");
  });

  it("blocks ../ escape", async () => {
    await expect(resolveSafePath(tmp, "../outside.txt")).rejects.toBeInstanceOf(
      PathEscapeError,
    );
  });

  it("blocks absolute path outside root", async () => {
    await expect(
      resolveSafePath(tmp, path.join("..", "Windows", "System32")),
    ).rejects.toBeInstanceOf(PathEscapeError);
  });

  it("blocks symlink escape when supported", async () => {
    const outside = await mkdtemp(path.join(os.tmpdir(), "file-out-"));
    try {
      await writeFile(path.join(outside, "secret.txt"), "secret");
      const linkPath = path.join(tmp, "escape-link");
      try {
        await symlink(path.join(outside, "secret.txt"), linkPath);
      } catch {
        return;
      }
      await expect(resolveSafePath(tmp, "escape-link")).rejects.toBeInstanceOf(
        PathEscapeError,
      );
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

describe("FileService", () => {
  let tmp: string;
  let svc: FileService;

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "file-svc-"));
    svc = new FileService();
    await mkdir(path.join(tmp, "src"), { recursive: true });
    await writeFile(path.join(tmp, "src", "app.ts"), "export {};\n");
    await writeFile(path.join(tmp, "readme.md"), "# Hi");
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("returns tree with files", async () => {
    const tree = await svc.getTree(tmp);
    expect(tree.type).toBe("dir");
    expect(tree.children?.some((c) => c.name === "readme.md")).toBe(true);
  });

  it("reads text file with language inference", async () => {
    const file = await svc.readFile(tmp, "src/app.ts");
    expect(file.language).toBe("typescript");
    expect(file.content).toContain("export");
  });

  it("truncates large files", async () => {
    const smallSvc = new FileService({ maxReadBytes: 8 });
    await writeFile(path.join(tmp, "big.txt"), "0123456789abcdef");
    const file = await smallSvc.readFile(tmp, "big.txt");
    expect(file.truncated).toBe(true);
    expect(file.content).toHaveLength(8);
  });

  it("detects binary files without content", async () => {
    await writeFile(path.join(tmp, "data.bin"), Buffer.from([0, 1, 2, 3]));
    const file = await svc.readFile(tmp, "data.bin");
    expect(file.language).toBe("binary");
    expect(file.content).toBeUndefined();
  });

  it("writes atomically", async () => {
    await svc.writeFile(tmp, "new.txt", "data");
    const content = await readFile(path.join(tmp, "new.txt"), "utf-8");
    expect(content).toBe("data");
  });

  it("creates, renames, and deletes files", async () => {
    await svc.createFile(tmp, "draft.txt", "v1");
    await svc.renamePath(tmp, "draft.txt", "final.txt");
    const content = await readFile(path.join(tmp, "final.txt"), "utf-8");
    expect(content).toBe("v1");
    await svc.deletePath(tmp, "final.txt");
    await expect(svc.readFile(tmp, "final.txt")).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("creates directories", async () => {
    await svc.createDir(tmp, "nested/dir");
    const tree = await svc.getTree(tmp);
    expect(
      tree.children?.some((c) => c.name === "nested" && c.type === "dir"),
    ).toBe(true);
  });

  it("searches file content", async () => {
    const matches = await svc.search(tmp, "export");
    expect(matches.some((m) => m.path.includes("app.ts"))).toBe(true);
  });

  it("searches file names", async () => {
    const matches = await svc.search(tmp, "readme");
    expect(
      matches.some((m) => m.path.includes("readme.md") && m.line === 0),
    ).toBe(true);
  });

  it("excludes binary from content search", async () => {
    await writeFile(path.join(tmp, "findme.bin"), "findme-inside");
    const matches = await svc.search(tmp, "findme-inside");
    expect(matches.some((m) => m.path.endsWith("findme.bin"))).toBe(false);
  });

  it("stores and reads attachments", async () => {
    const saved = await svc.saveAttachment(tmp, Buffer.from("png-bytes"));
    const read = await svc.readAttachment(tmp, saved.ref);
    expect(read.data.toString()).toBe("png-bytes");
  });
});
