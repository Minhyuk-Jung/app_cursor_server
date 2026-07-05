import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type GitChangeKind = "added" | "modified" | "deleted" | "renamed";

export interface GitChangeItem {
  path: string;
  changeKind: GitChangeKind;
  staged: boolean;
  oldPath?: string;
}

export interface GitDiffFile {
  path: string;
  hunks: string;
}

export interface GitServiceOptions {
  userName: string;
  userEmail: string;
}

export class GitService {
  constructor(private options: GitServiceOptions) {}

  async initRepo(rootPath: string): Promise<void> {
    await mkdir(rootPath, { recursive: true });
    await this.git(rootPath, ["init"]);
    await this.ensureIdentity(rootPath);
    const keep = path.join(rootPath, ".gitkeep");
    try {
      await writeFile(keep, "", { flag: "wx" });
    } catch {
      // already exists
    }
    await this.git(rootPath, ["add", "-A"]);
    try {
      await this.git(rootPath, ["commit", "-m", "Initial commit"]);
    } catch {
      await this.git(rootPath, ["commit", "--allow-empty", "-m", "Initial commit"]);
    }
  }

  async cloneRepo(gitUrl: string, rootPath: string): Promise<void> {
    await mkdir(path.dirname(rootPath), { recursive: true });
    await execFileAsync("git", ["clone", gitUrl, rootPath], {
      maxBuffer: 10 * 1024 * 1024,
    });
    await this.ensureIdentity(rootPath);
  }

  async createSnapshot(rootPath: string, runId: string): Promise<string> {
    const tag = `snapshot/${runId}`;
    await this.ensureIdentity(rootPath);
    await this.git(rootPath, ["add", "-A"]);
    try {
      await this.git(rootPath, ["commit", "-m", `[snapshot] pre-run ${runId.slice(0, 8)}`]);
    } catch {
      // no changes — tag current HEAD
    }
    try {
      await this.git(rootPath, ["tag", "-f", tag]);
    } catch (err) {
      throw Object.assign(new Error("Snapshot tag failed"), {
        code: "internal_error",
        cause: err,
        retryable: false,
      });
    }
    return tag;
  }

  async restoreSnapshot(rootPath: string, snapshotRef: string): Promise<void> {
    await this.git(rootPath, ["reset", "--hard", snapshotRef]);
    await this.git(rootPath, ["clean", "-fd"]);
  }

  async listChanges(rootPath: string): Promise<GitChangeItem[]> {
    const out = await this.git(rootPath, ["status", "--porcelain"]);
    if (!out) return [];

    const items: GitChangeItem[] = [];
    for (const line of out.split("\n")) {
      if (!line.trim()) continue;
      const stagedCode = line.slice(0, 2);
      const rawPath = line.slice(3).trim();
      const staged = stagedCode[0] !== " " && stagedCode[0] !== "?";
      let changeKind: GitChangeKind = "modified";
      let filePath = rawPath;
      let oldPath: string | undefined;

      if (rawPath.includes(" -> ")) {
        const parts = rawPath.split(" -> ");
        oldPath = parts[0];
        filePath = parts[1] ?? rawPath;
        changeKind = "renamed";
      } else if (stagedCode.includes("A") || stagedCode.includes("?")) {
        changeKind = "added";
      } else if (stagedCode.includes("D")) {
        changeKind = "deleted";
      }

      items.push({ path: filePath, changeKind, staged, oldPath });
    }
    return items;
  }

  async getDiff(
    rootPath: string,
    paths?: string[],
  ): Promise<{
    changes: GitChangeItem[];
    files: GitDiffFile[];
    conflicts: string[];
  }> {
    const changes = await this.listChanges(rootPath);
    const conflicts = await this.listConflicts(rootPath);
    const targetPaths =
      paths && paths.length > 0 ? paths : changes.map((c) => c.path);

    const files: GitDiffFile[] = [];
    for (const filePath of targetPaths) {
      let hunks = "";
      try {
        hunks = await this.git(rootPath, ["diff", "--", filePath]);
        if (!hunks) {
          hunks = await this.git(rootPath, ["diff", "--cached", "--", filePath]);
        }
        if (!hunks) {
          await this.git(rootPath, ["add", "-N", "--", filePath]);
          hunks = await this.git(rootPath, ["diff", "--", filePath]);
        }
      } catch {
        hunks = "";
      }
      files.push({ path: filePath, hunks });
    }

    return { changes, files, conflicts };
  }

  async listConflicts(rootPath: string): Promise<string[]> {
    try {
      const out = await this.git(rootPath, [
        "diff",
        "--name-only",
        "--diff-filter=U",
      ]);
      return out.split("\n").map((line) => line.trim()).filter(Boolean);
    } catch {
      return [];
    }
  }

  assertRemoteAllowed(remoteUrl: string, whitelist: string[]): void {
    if (whitelist.length === 0) return;
    const normalized = remoteUrl.toLowerCase();
    const allowed = whitelist.some((entry) =>
      normalized.includes(entry.toLowerCase()),
    );
    if (!allowed) {
      throw Object.assign(
        new Error(`Remote not allowed by whitelist: ${remoteUrl}`),
        { code: "forbidden", retryable: false },
      );
    }
  }

  async commit(
    rootPath: string,
    message: string,
    paths: string[],
  ): Promise<{ commitHash: string }> {
    await this.ensureIdentity(rootPath);
    if (paths.length === 0) {
      throw Object.assign(new Error("No files to commit"), {
        code: "validation_failed",
        retryable: false,
      });
    }
    await this.git(rootPath, ["add", "--", ...paths]);
    await this.git(rootPath, ["commit", "-m", message]);
    const hash = await this.git(rootPath, ["rev-parse", "HEAD"]);
    return { commitHash: hash };
  }

  async createBranch(
    rootPath: string,
    branchName: string,
    checkout = true,
  ): Promise<void> {
    await this.git(rootPath, ["branch", branchName]);
    if (checkout) {
      await this.checkoutBranch(rootPath, branchName);
    }
  }

  async checkoutBranch(rootPath: string, branchName: string): Promise<void> {
    await this.git(rootPath, ["checkout", branchName]);
  }

  async currentBranch(rootPath: string): Promise<string> {
    return this.git(rootPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
  }

  async getRepoStatus(
    rootPath: string,
  ): Promise<{
    branch: string;
    dirty: boolean;
    changedCount: number;
    stagedCount: number;
    unstagedCount: number;
    lastCommitMessage: string | null;
    ahead: number | null;
    behind: number | null;
  }> {
    const branch = await this.currentBranch(rootPath);
    const porcelain = await this.git(rootPath, ["status", "--porcelain"]);
    const lines = porcelain
      .split("\n")
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0);
    let stagedCount = 0;
    let unstagedCount = 0;
    for (const line of lines) {
      const indexStatus = line[0] ?? " ";
      const workTreeStatus = line[1] ?? " ";
    if (indexStatus === "?" && workTreeStatus === "?") {
        unstagedCount += 1;
        continue;
      }
      if (indexStatus !== " " && indexStatus !== "?") stagedCount += 1;
      if (workTreeStatus !== " " && workTreeStatus !== "?") unstagedCount += 1;
    }

    let lastCommitMessage: string | null = null;
    try {
      const msg = await this.git(rootPath, ["log", "-1", "--pretty=%s"]);
      lastCommitMessage = msg.trim() || null;
    } catch {
      lastCommitMessage = null;
    }

    let ahead: number | null = null;
    let behind: number | null = null;
    try {
      const counts = await this.git(rootPath, [
        "rev-list",
        "--left-right",
        "--count",
        "@{upstream}...HEAD",
      ]);
      const parts = counts.trim().split(/\s+/);
      if (parts.length === 2) {
        behind = Number.parseInt(parts[0]!, 10);
        ahead = Number.parseInt(parts[1]!, 10);
      }
    } catch {
      ahead = null;
      behind = null;
    }

    return {
      branch,
      dirty: lines.length > 0,
      changedCount: lines.length,
      stagedCount,
      unstagedCount,
      lastCommitMessage,
      ahead,
      behind,
    };
  }

  async push(
    rootPath: string,
    remote = "origin",
    branch?: string,
  ): Promise<{ remote: string; branch: string }> {
    const targetBranch = branch ?? (await this.currentBranch(rootPath));
    try {
      await this.git(rootPath, ["push", remote, targetBranch]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw Object.assign(new Error(`Push failed: ${message}`), {
        code: "conflict",
        retryable: true,
      });
    }
    return { remote, branch: targetBranch };
  }

  async createPullRequest(input: {
    owner: string;
    repo: string;
    title: string;
    body: string;
    head: string;
    base: string;
    token: string;
  }): Promise<{ url: string; number: number }> {
    const res = await fetch(
      `https://api.github.com/repos/${input.owner}/${input.repo}/pulls`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.token}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: input.title,
          body: input.body,
          head: input.head,
          base: input.base,
        }),
      },
    );
    if (!res.ok) {
      const text = await res.text();
      throw Object.assign(new Error(`PR creation failed: ${text}`), {
        code: "conflict",
        retryable: false,
      });
    }
    const data = (await res.json()) as { html_url: string; number: number };
    return { url: data.html_url, number: data.number };
  }

  parseGithubRemote(url: string): { owner: string; repo: string } | null {
    const ssh = url.match(/git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/);
    if (ssh) return { owner: ssh[1]!, repo: ssh[2]! };
    const https = url.match(/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/);
    if (https) return { owner: https[1]!, repo: https[2]! };
    return null;
  }

  async getRemoteUrl(rootPath: string, remote = "origin"): Promise<string | null> {
    try {
      return await this.git(rootPath, ["remote", "get-url", remote]);
    } catch {
      return null;
    }
  }

  sessionBranchName(sessionId: string): string {
    return `session/${sessionId.slice(0, 8)}`;
  }

  private async ensureIdentity(rootPath: string): Promise<void> {
    await this.git(rootPath, ["config", "user.name", this.options.userName]);
    await this.git(rootPath, ["config", "user.email", this.options.userEmail]);
  }

  private async git(cwd: string, args: string[]): Promise<string> {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout.trim();
  }
}
