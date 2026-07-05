import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { SDKMessage } from "@cursor/sdk";
import type { DomainEvent } from "@app/shared";
import {
  classifyStartupError,
  mapSdkMessageForTest,
  runErrorEvent,
  type AgentCreateSpec,
  type SdkAgentHandle,
  type SdkPromptInput,
  type SdkRunHandle,
} from "./sdk-adapter.js";

const SDK_CREATE_SCRIPT = "/opt/cursor-sdk/sdk-create.mjs";
const SDK_SEND_SCRIPT = "/opt/cursor-sdk/sdk-send.mjs";

type NdjsonLine = {
  kind?: string;
  runId?: string;
  event?: SDKMessage;
  status?: string;
};

export interface ContainerSdkBridgeOptions {
  execTimeoutMs?: number;
}

/**
 * ADR-007 POC 3 — docker exec 로 컨테이ner 내부 @cursor/sdk 실행.
 * SessionManager 계약: streamEvents()는 run_done 미포함, wait()가 종료 상태 확정.
 */
export class ContainerSdkBridge {
  constructor(
    private containerName: string,
    private options: ContainerSdkBridgeOptions = {},
  ) {}

  async createAgent(spec: AgentCreateSpec): Promise<SdkAgentHandle> {
    const payload = JSON.stringify({
      model: spec.model,
      cwd: spec.cwd,
    });
    const stdout = await this.execScript(
      SDK_CREATE_SCRIPT,
      spec.apiKey,
      payload,
    );
    let parsed: { agentId?: string };
    try {
      parsed = JSON.parse(stdout.trim()) as { agentId?: string };
    } catch {
      throw classifyStartupError(
        new Error(
          `Container SDK create returned invalid JSON: ${stdout.slice(0, 200)}`,
        ),
      );
    }
    if (!parsed.agentId) {
      throw classifyStartupError(
        new Error("Container SDK create missing agentId"),
      );
    }
    return this.agentHandle(parsed.agentId, spec.apiKey);
  }

  resumeHandle(agentId: string, apiKey: string): SdkAgentHandle {
    return this.agentHandle(agentId, apiKey);
  }

  private agentHandle(agentId: string, apiKey: string): SdkAgentHandle {
    const containerName = this.containerName;
    return {
      agentId,
      send: (prompt) => this.sendRun(containerName, agentId, apiKey, prompt),
      dispose: async () => {},
    };
  }

  private dockerExecArgs(apiKey: string, scriptPath: string): string[] {
    return [
      "exec",
      "-i",
      "-e",
      `CURSOR_API_KEY=${apiKey}`,
      this.containerName,
      "node",
      scriptPath,
    ];
  }

  private execScript(
    scriptPath: string,
    apiKey: string,
    stdin: string,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn("docker", this.dockerExecArgs(apiKey, scriptPath), {
        stdio: ["pipe", "pipe", "pipe"],
      });
      const clearTimer = this.armExecTimeout(proc, reject);
      let stdout = "";
      let stderr = "";
      proc.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      proc.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      proc.on("error", (err) => {
        clearTimer();
        reject(classifyStartupError(err));
      });
      proc.on("close", (code) => {
        clearTimer();
        if (code !== 0) {
          reject(
            classifyStartupError(
              new Error(stderr.trim() || `docker exec exited ${code}`),
            ),
          );
          return;
        }
        resolve(stdout);
      });
      proc.stdin.write(stdin);
      proc.stdin.end();
    });
  }

  private armExecTimeout(
    proc: ChildProcessWithoutNullStreams,
    onTimeout?: (err: ReturnType<typeof classifyStartupError>) => void,
  ): () => void {
    const ms = this.options.execTimeoutMs;
    if (!ms || ms <= 0) return () => {};
    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      if (onTimeout) {
        onTimeout(
          classifyStartupError(
            new Error(`Container SDK exec timed out after ${ms}ms`),
          ),
        );
      }
    }, ms);
    return () => clearTimeout(timer);
  }

  private sendRun(
    containerName: string,
    agentId: string,
    apiKey: string,
    prompt: SdkPromptInput,
  ): Promise<SdkRunHandle> {
    const proc = spawn(
      "docker",
      [
        "exec",
        "-i",
        "-e",
        `CURSOR_API_KEY=${apiKey}`,
        containerName,
        "node",
        SDK_SEND_SCRIPT,
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    proc.stdin.write(JSON.stringify({ agentId, prompt }));
    proc.stdin.end();

    return Promise.resolve(
      new ContainerSdkRun(proc, this.options.execTimeoutMs).asHandle(),
    );
  }
}

class ContainerSdkRun {
  runId = `container-run-${Date.now()}`;
  private stdoutBuffer = "";
  private domainEvents: DomainEvent[] = [];
  private domainWaiters: Array<(event: DomainEvent | null) => void> = [];
  private streamEnded = false;
  private doneStatus: "finished" | "error" | "cancelled" | null = null;
  private timedOut = false;
  private stderr = "";
  private exitCode: number | null = null;
  private readonly closePromise: Promise<void>;
  private readonly clearTimer: () => void;

  constructor(
    private proc: ChildProcessWithoutNullStreams,
    private execTimeoutMs?: number,
  ) {
    this.clearTimer = this.armRunTimeout();
    proc.stdout.on("data", (chunk: Buffer) => {
      this.stdoutBuffer += chunk.toString();
      const parts = this.stdoutBuffer.split("\n");
      this.stdoutBuffer = parts.pop() ?? "";
      for (const part of parts) {
        const line = part.trim();
        if (line) this.processLine(line);
      }
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      this.stderr += chunk.toString();
    });
    proc.on("error", () => {
      this.clearTimer();
      this.finalizeStream();
    });
    this.closePromise = new Promise((resolve) => {
      proc.on("close", (code) => {
        this.clearTimer();
        this.exitCode = code;
        if (this.stdoutBuffer.trim()) {
          this.processLine(this.stdoutBuffer.trim());
          this.stdoutBuffer = "";
        }
        this.finalizeStream();
        resolve();
      });
    });
  }

  asHandle(): SdkRunHandle {
    const self = this;
    return {
      get runId() {
        return self.runId;
      },
      streamEvents: () => self.streamEvents(),
      wait: () => self.wait(),
      cancel: () => self.cancel(),
    };
  }

  private pushDomainEvent(event: DomainEvent): void {
    const waiter = this.domainWaiters.shift();
    if (waiter) {
      waiter(event);
    } else {
      this.domainEvents.push(event);
    }
  }

  private async nextDomainEvent(): Promise<DomainEvent | null> {
    if (this.domainEvents.length > 0) {
      return this.domainEvents.shift()!;
    }
    if (this.streamEnded) return null;
    return new Promise((resolve) => {
      this.domainWaiters.push(resolve);
    });
  }

  private endStream(): void {
    if (this.streamEnded) return;
    this.streamEnded = true;
    for (const waiter of this.domainWaiters) {
      waiter(null);
    }
    this.domainWaiters = [];
  }

  private finalizeStream(): void {
    if (this.streamEnded && this.doneStatus) return;
    if (!this.doneStatus) {
      if (this.timedOut) {
        this.doneStatus = "error";
        if (!this.streamEnded) {
          this.pushDomainEvent(
            runErrorEvent(
              this.runId,
              `Container SDK exec timed out after ${this.execTimeoutMs}ms`,
            ),
          );
        }
      } else if (this.exitCode === 143 || this.exitCode === 130) {
        this.doneStatus = "cancelled";
      } else if (this.exitCode !== 0 && this.exitCode !== null) {
        this.doneStatus = "error";
        if (!this.streamEnded) {
          this.pushDomainEvent(
            runErrorEvent(
              this.runId,
              this.stderr.trim() ||
                `Container SDK send exited ${this.exitCode}`,
            ),
          );
        }
      } else if (this.exitCode === 0) {
        this.doneStatus = "finished";
      } else {
        this.doneStatus = "error";
      }
    }
    this.endStream();
  }

  private processLine(line: string): void {
    if (this.streamEnded) return;

    let msg: NdjsonLine;
    try {
      msg = JSON.parse(line) as NdjsonLine;
    } catch {
      this.pushDomainEvent(
        runErrorEvent(this.runId, `Invalid container SDK stream: ${line}`),
      );
      return;
    }

    if (msg.kind === "run" && msg.runId) {
      this.runId = msg.runId;
      return;
    }

    if (msg.kind === "stream" && msg.event) {
      const mapped = mapSdkMessageForTest(msg.event, this.runId);
      if (mapped) {
        this.pushDomainEvent(mapped);
      }
      return;
    }

    if (msg.kind === "done") {
      this.doneStatus =
        msg.status === "finished"
          ? "finished"
          : msg.status === "cancelled"
            ? "cancelled"
            : "error";
      this.endStream();
    }
  }

  async *streamEvents(): AsyncIterable<DomainEvent> {
    while (true) {
      const event = await this.nextDomainEvent();
      if (!event) break;
      yield event;
    }
  }

  async wait(): Promise<{ status: "finished" | "error" | "cancelled" }> {
    await this.closePromise;
    if (!this.streamEnded) {
      this.finalizeStream();
    }
    return { status: this.doneStatus ?? "error" };
  }

  async cancel(): Promise<void> {
    this.clearTimer();
    this.proc.kill("SIGTERM");
    await this.closePromise;
  }

  private armRunTimeout(): () => void {
    const ms = this.execTimeoutMs;
    if (!ms || ms <= 0) return () => {};
    const timer = setTimeout(() => {
      this.timedOut = true;
      this.proc.kill("SIGTERM");
    }, ms);
    return () => clearTimeout(timer);
  }
}

/** @internal unit tests — NDJSON line → domain events (run_done 제외) */
export function parseContainerSdkLinesForTest(
  lines: string[],
  initialRunId = "test-run",
): { events: DomainEvent[]; runId: string; doneStatus: string | null } {
  const events: DomainEvent[] = [];
  let runId = initialRunId;
  let doneStatus: string | null = null;

  for (const line of lines) {
    let msg: NdjsonLine;
    try {
      msg = JSON.parse(line) as NdjsonLine;
    } catch {
      events.push(runErrorEvent(runId, `Invalid: ${line}`));
      continue;
    }
    if (msg.kind === "run" && msg.runId) {
      runId = msg.runId;
      continue;
    }
    if (msg.kind === "stream" && msg.event) {
      const mapped = mapSdkMessageForTest(msg.event, runId);
      if (mapped) events.push(mapped);
      continue;
    }
    if (msg.kind === "done") {
      doneStatus = msg.status ?? "error";
    }
  }

  return { events, runId, doneStatus };
}
