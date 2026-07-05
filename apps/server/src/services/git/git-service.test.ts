import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { GitService } from "./git-service.js";

const exec = promisify(execFile);

describe("GitService (P5)", () => {
  let tmpDir: string;
  let git: GitService;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "git-svc-"));
    git = new GitService({
      userName: "Test User",
      userEmail: "test@example.com",
    });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("initializes repo with initial commit", async () => {
    await git.initRepo(tmpDir);
    const branch = await git.currentBranch(tmpDir);
    expect(branch).toBeTruthy();
  });

  it("reports repo status with dirty flag", async () => {
    await git.initRepo(tmpDir);
    const clean = await git.getRepoStatus(tmpDir);
    expect(clean.dirty).toBe(false);
    expect(clean.changedCount).toBe(0);
    await writeFile(path.join(tmpDir, "dirty.txt"), "x");
    const dirty = await git.getRepoStatus(tmpDir);
    expect(dirty.dirty).toBe(true);
    expect(dirty.changedCount).toBeGreaterThan(0);
    expect(dirty.stagedCount).toBe(0);
    expect(dirty.unstagedCount).toBeGreaterThan(0);
    expect(dirty.branch).toBe(clean.branch);
    expect(dirty.lastCommitMessage).toBeTruthy();
    expect(dirty.ahead).toBeNull();
    expect(dirty.behind).toBeNull();
  });

  it("creates snapshot tag before run", async () => {
    await git.initRepo(tmpDir);
    await writeFile(path.join(tmpDir, "a.txt"), "hello");
    const tag = await git.createSnapshot(tmpDir, "run-abc123");
    expect(tag).toBe("snapshot/run-abc123");
  });

  it("lists changes and diff after edit", async () => {
    await git.initRepo(tmpDir);
    await writeFile(path.join(tmpDir, "b.txt"), "world");
    const { changes, files } = await git.getDiff(tmpDir);
    expect(changes.some((c) => c.path === "b.txt")).toBe(true);
    expect(files.some((f) => f.path === "b.txt" && f.hunks.includes("world"))).toBe(
      true,
    );
  });

  it("commits selected paths", async () => {
    await git.initRepo(tmpDir);
    await writeFile(path.join(tmpDir, "c.txt"), "commit me");
    const result = await git.commit(tmpDir, "feat: add c", ["c.txt"]);
    expect(result.commitHash).toMatch(/^[0-9a-f]{7,40}$/i);
    const changes = await git.listChanges(tmpDir);
    expect(changes.length).toBe(0);
  });

  it("restores snapshot on rollback", async () => {
    await git.initRepo(tmpDir);
    await writeFile(path.join(tmpDir, "d.txt"), "v1");
    const tag = await git.createSnapshot(tmpDir, "run-rollback");
    await writeFile(path.join(tmpDir, "d.txt"), "v2");
    await git.restoreSnapshot(tmpDir, tag);
    const { changes } = await git.getDiff(tmpDir);
    expect(changes.some((c) => c.path === "d.txt")).toBe(false);
  });

  it("creates session branch", async () => {
    await git.initRepo(tmpDir);
    const branch = git.sessionBranchName("session-id-12345678");
    await git.createBranch(tmpDir, branch);
    expect(await git.currentBranch(tmpDir)).toBe(branch);
  });

  it("assertRemoteAllowed enforces whitelist (12 §10)", () => {
    expect(() =>
      git.assertRemoteAllowed("https://evil.com/repo.git", ["github.com"]),
    ).toThrow(/not allowed/);
    expect(() =>
      git.assertRemoteAllowed("https://github.com/org/repo.git", [
        "github.com/org",
      ]),
    ).not.toThrow();
  });

  it("reports ahead/behind when upstream is configured", async () => {
    const remoteDir = path.join(tmpDir, "remote.git");
    await mkdir(remoteDir, { recursive: true });
    await exec("git", ["init", "--bare", remoteDir]);

    await git.initRepo(tmpDir);
    const branch = await git.currentBranch(tmpDir);
    await exec("git", ["remote", "add", "origin", remoteDir], { cwd: tmpDir });
    await exec("git", ["push", "-u", "origin", branch], { cwd: tmpDir });

    const synced = await git.getRepoStatus(tmpDir);
    expect(synced.ahead).toBe(0);
    expect(synced.behind).toBe(0);

    await writeFile(path.join(tmpDir, "ahead.txt"), "local only");
    await git.commit(tmpDir, "feat: local ahead", ["ahead.txt"]);
    const aheadStatus = await git.getRepoStatus(tmpDir);
    expect(aheadStatus.ahead).toBe(1);
    expect(aheadStatus.behind).toBe(0);
  });

  it("returns empty conflicts when clean", async () => {
    await git.initRepo(tmpDir);
    const { conflicts } = await git.getDiff(tmpDir);
    expect(conflicts).toEqual([]);
  });

  it("detects merge conflict files (P5 UR-08)", async () => {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const exec = promisify(execFile);

    await git.initRepo(tmpDir);
    const mainBranch = await git.currentBranch(tmpDir);
    await writeFile(path.join(tmpDir, "conflict.txt"), "base");
    await git.commit(tmpDir, "base on main", ["conflict.txt"]);

    const featureBranch = "feature/conflict-test";
    await git.createBranch(tmpDir, featureBranch);
    await writeFile(path.join(tmpDir, "conflict.txt"), "feature change");
    await git.commit(tmpDir, "feature edit", ["conflict.txt"]);

    await git.checkoutBranch(tmpDir, mainBranch);
    await writeFile(path.join(tmpDir, "conflict.txt"), "main change");
    await git.commit(tmpDir, "main edit", ["conflict.txt"]);

    try {
      await exec("git", ["merge", featureBranch], { cwd: tmpDir });
    } catch {
      // expected merge conflict
    }

    const { conflicts } = await git.getDiff(tmpDir);
    expect(conflicts).toContain("conflict.txt");
  });

  it("pushes successfully to local bare remote", async () => {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const exec = promisify(execFile);

    await git.initRepo(tmpDir);
    const bareDir = await mkdtemp(path.join(os.tmpdir(), "git-bare-"));
    await exec("git", ["init", "--bare"], { cwd: bareDir });
    await exec("git", ["remote", "add", "origin", bareDir.replace(/\\/g, "/")], {
      cwd: tmpDir,
    });
    await writeFile(path.join(tmpDir, "push.txt"), "push content");
    await git.commit(tmpDir, "feat: push", ["push.txt"]);

    const result = await git.push(tmpDir);
    expect(result.remote).toBe("origin");
    expect(result.branch).toBeTruthy();

    const { stdout } = await exec("git", ["rev-parse", "HEAD"], { cwd: bareDir });
    expect(stdout.trim()).toMatch(/^[0-9a-f]{40}$/i);

    await rm(bareDir, { recursive: true, force: true });
  });
});
