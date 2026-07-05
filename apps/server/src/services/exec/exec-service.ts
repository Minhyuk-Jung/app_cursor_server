import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { SandboxService } from "./sandbox-service.js";
import type { SandboxSessionRegistry } from "./sandbox-session-registry.js";
import { buildSandboxEnv } from "./types.js";
import type { ExecRunHandle, ExecStreamMessage } from "./types.js";
import {
  execResourceLimitKind,
  type ExecResourceLimitKind,
} from "./exec-resource-limit.js";

export type { SandboxMode } from "./types.js";

export type ExecResourceLimitEvent = {
  projectId: string;
  kind: ExecResourceLimitKind;
  command: string;
};

interface ActiveExec {
  proc: ChildProcessWithoutNullStreams | null;
  timer?: ReturnType<typeof setTimeout>;
  projectId?: string;
  timedOut?: boolean;
  /** 사용자 cancel / purge — 자원 상한 알림 억제 */
  cancelled?: boolean;
}

export class ExecService {
  private active = new Map<string, ActiveExec>();
  private byProject = new Map<string, Set<string>>();

  constructor(
    private sandbox: SandboxService,
    private sandboxSessions?: SandboxSessionRegistry,
    private onResourceLimit?: (
      event: ExecResourceLimitEvent,
    ) => void | Promise<void>,
  ) {}

  getActiveCount(): number {
    return this.active.size;
  }

  getActiveCountForProject(projectId: string): number {
    return this.byProject.get(projectId)?.size ?? 0;
  }

  getSandboxMode() {
    return this.sandbox.getMode();
  }

  canAcceptMore(): boolean {
    return this.active.size < this.sandbox.getExecConfig().maxConcurrentExec;
  }

  canAcceptForProject(projectId: string): boolean {
    return (
      this.getActiveCountForProject(projectId) <
      this.sandbox.getExecConfig().perProjectMaxExec
    );
  }

  /** 13 §6.4 — 유휴 샌드박스 파기 시 해당 프로젝트 exec 강제 종료 */
  cancelProjectExecs(projectId: string): number {
    const ids = this.byProject.get(projectId);
    if (!ids?.size) return 0;
    let cancelled = 0;
    for (const execId of [...ids]) {
      const active = this.active.get(execId);
      if (active?.proc) {
        active.cancelled = true;
        this.killProcess(active.proc);
        cancelled += 1;
      }
    }
    return cancelled;
  }

  run(input: {
    projectId?: string;
    projectRoot: string;
    command: string;
    cwd?: string;
    onMessage: (msg: ExecStreamMessage) => void;
  }): Promise<ExecRunHandle> {
    if (!this.canAcceptMore()) {
      return Promise.reject(
        Object.assign(new Error("Too many concurrent exec sessions"), {
          code: "queue_full",
          retryable: true,
        }),
      );
    }
    if (input.projectId && !this.canAcceptForProject(input.projectId)) {
      return Promise.reject(
        Object.assign(new Error("Project exec limit reached"), {
          code: "project_exec_limit",
          retryable: true,
        }),
      );
    }

    const execId = randomUUID();
    this.active.set(execId, { proc: null as unknown as ChildProcessWithoutNullStreams });
    if (input.projectId) {
      this.trackProject(execId, input.projectId);
    }
    return this.startExec(execId, input).catch((err) => {
      this.untrack(execId);
      throw err;
    });
  }

  cancelAll(): void {
    for (const [execId, active] of this.active) {
      if (active.proc) this.killProcess(active.proc);
      this.cleanup(execId);
    }
  }

  async runToCompletion(input: {
    projectId?: string;
    projectRoot: string;
    command: string;
    cwd?: string;
  }): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number | null;
    errorCode?: string;
  }> {
    const stdout: string[] = [];
    const stderr: string[] = [];
    let exitCode: number | null = null;
    let errorCode: string | undefined;

    await new Promise<void>((resolve, reject) => {
      void this.run({
        ...input,
        onMessage: (msg) => {
          if (msg.type === "stdout") stdout.push(msg.data);
          if (msg.type === "stderr") stderr.push(msg.data);
          if (msg.type === "error" && msg.code) errorCode = String(msg.code);
          if (msg.type === "exit") {
            exitCode = msg.code;
            resolve();
          }
        },
      }).catch(reject);
    });

    return {
      stdout: stdout.join(""),
      stderr: stderr.join(""),
      exitCode,
      ...(errorCode ? { errorCode } : {}),
    };
  }

  private async startExec(
    execId: string,
    input: {
      projectId?: string;
      projectRoot: string;
      command: string;
      cwd?: string;
      onMessage: (msg: ExecStreamMessage) => void;
    },
  ): Promise<ExecRunHandle> {
    const projectWorkspace = await this.sandbox.assertProjectWorkspace(
      input.projectRoot,
    );
    const execCwd = await this.sandbox.resolveExecCwd(
      input.projectRoot,
      input.cwd ?? ".",
    );
    await this.sandbox.assertSubprocessCommand(
      input.projectRoot,
      input.command,
    );

    let sandboxId: string | undefined;
    if (input.projectId && this.sandboxSessions) {
      const session = this.sandboxSessions.prepare(
        input.projectId,
        projectWorkspace,
        true,
      );
      sandboxId = session.sandboxId;
    }

    input.onMessage({
      type: "started",
      execId,
      command: input.command,
      ...(sandboxId ? { sandboxId } : {}),
    });

    const cfg = this.sandbox.getExecConfig();
    const proc =
      cfg.sandboxMode === "docker"
        ? this.spawnDocker(
            projectWorkspace,
            execCwd,
            input.command,
            cfg,
            input.projectId,
          )
        : this.spawnSubprocess(execCwd, input.command);

    const active: ActiveExec = { proc, projectId: input.projectId };
    this.active.set(execId, active);

    active.timer = setTimeout(() => {
      active.timedOut = true;
      this.killProcess(proc);
    }, cfg.execTimeoutMs);

    const refreshActivity = () => {
      if (input.projectId && this.sandboxSessions) {
        this.sandboxSessions.touch(input.projectId, true);
      }
    };

    proc.stdout.on("data", (chunk: Buffer) => {
      refreshActivity();
      input.onMessage({ type: "stdout", data: chunk.toString("utf8") });
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      refreshActivity();
      input.onMessage({ type: "stderr", data: chunk.toString("utf8") });
    });

    proc.on("error", (err) => {
      this.markProjectIdle(input.projectId);
      this.cleanup(execId);
      input.onMessage({ type: "error", message: err.message });
      input.onMessage({ type: "exit", code: 1, signal: null });
    });

    proc.on("close", (code, signal) => {
      void this.handleExecClose(
        execId,
        active,
        input,
        cfg,
        code,
        signal,
      );
    });

    return {
      execId,
      cancel: () => {
        active.cancelled = true;
        this.killProcess(proc);
      },
      writeStdin: (data: string) => {
        if (!proc.killed && proc.stdin.writable) {
          proc.stdin.write(data);
        }
      },
    };
  }

  private async handleExecClose(
    execId: string,
    active: ActiveExec,
    input: {
      projectId?: string;
      command: string;
      onMessage: (msg: ExecStreamMessage) => void;
    },
    cfg: ReturnType<SandboxService["getExecConfig"]>,
    code: number | null,
    signal: NodeJS.Signals | string | null,
  ): Promise<void> {
    this.markProjectIdle(input.projectId);
    const limitKind = execResourceLimitKind(
      code,
      signal,
      cfg.sandboxMode,
      Boolean(active.timedOut),
      Boolean(active.cancelled),
    );
    if (limitKind === "exec_timeout") {
      input.onMessage({
        type: "error",
        message: `Command exceeded exec timeout (${cfg.execTimeoutMs}ms)`,
        code: "exec_timeout",
      });
    } else if (limitKind === "exec_memory_limit") {
      input.onMessage({
        type: "error",
        message: `Command exceeded sandbox memory limit (${cfg.sandboxMemoryMb}MB)`,
        code: "exec_memory_limit",
      });
    }
    if (limitKind && input.projectId && this.onResourceLimit) {
      try {
        await this.onResourceLimit({
          projectId: input.projectId,
          kind: limitKind,
          command: input.command,
        });
      } catch (err) {
        console.error("[exec] exec resource limit notification failed:", err);
      }
    }
    this.cleanup(execId);
    input.onMessage({
      type: "exit",
      code: limitKind === "exec_timeout" ? 124 : code,
      signal: signal ?? null,
    });
  }

  private markProjectIdle(projectId?: string): void {
    if (projectId && this.sandboxSessions) {
      this.sandboxSessions.touch(projectId, false);
    }
  }

  private trackProject(execId: string, projectId: string): void {
    let set = this.byProject.get(projectId);
    if (!set) {
      set = new Set();
      this.byProject.set(projectId, set);
    }
    set.add(execId);
  }

  private untrack(execId: string): void {
    const active = this.active.get(execId);
    if (active?.projectId) {
      const set = this.byProject.get(active.projectId);
      set?.delete(execId);
      if (set?.size === 0) this.byProject.delete(active.projectId);
    }
    this.active.delete(execId);
  }

  private spawnSubprocess(
    cwd: string,
    command: string,
  ): ChildProcessWithoutNullStreams {
    return spawn(command, {
      cwd,
      shell: true,
      env: buildSandboxEnv(cwd),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
  }

  private spawnDocker(
    projectRoot: string,
    execCwd: string,
    command: string,
    cfg: ReturnType<SandboxService["getExecConfig"]>,
    projectId?: string,
  ): ChildProcessWithoutNullStreams {
    const workdir = this.sandbox.dockerWorkdir(projectRoot, execCwd);
    const containerName =
      projectId && this.sandboxSessions
        ? this.sandboxSessions.get(projectId)?.containerName
        : undefined;

    if (containerName) {
      return spawn(
        "docker",
        ["exec", "-i", "-w", workdir, containerName, "sh", "-lc", command],
        {
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
        },
      );
    }

    const mount =
      process.platform === "win32"
        ? projectRoot.replace(/\\/g, "/")
        : projectRoot;
    return spawn(
      "docker",
      [
        "run",
        "--rm",
        "-i",
        "--cpus",
        String(cfg.sandboxCpus),
        "--memory",
        `${cfg.sandboxMemoryMb}m`,
        "-v",
        `${mount}:/workspace`,
        "-w",
        workdir,
        cfg.dockerImage,
        "sh",
        "-lc",
        command,
      ],
      {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      },
    );
  }

  private cleanup(execId: string): void {
    const active = this.active.get(execId);
    if (!active) return;
    if (active.timer) clearTimeout(active.timer);
    this.untrack(execId);
  }

  private killProcess(proc: ChildProcessWithoutNullStreams): void {
    if (process.platform === "win32" && proc.pid) {
      spawn("taskkill", ["/PID", String(proc.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
    } else {
      proc.kill("SIGTERM");
      setTimeout(() => {
        if (!proc.killed) proc.kill("SIGKILL");
      }, 500);
    }
  }
}
