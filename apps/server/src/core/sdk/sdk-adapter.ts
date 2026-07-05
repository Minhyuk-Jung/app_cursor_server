import { Agent, CursorAgentError, Cursor } from "@cursor/sdk";
import type { SDKMessage } from "@cursor/sdk";
import type { DomainEvent } from "@app/shared";
import { ChangeKind, ErrorKind, RunTerminalStatus } from "@app/shared";
import {
  AGENT_TOOL_OUTPUT_CHANNEL,
} from "../../services/exec/exec-boundary.js";
import { isSandboxError } from "../../services/exec/sandbox-errors.js";

export interface AgentCreateSpec {
  cwd: string;
  model: string;
  apiKey: string;
  /** ADR-007 shared-runtime: 컨테이너 준비 검증용 */
  projectId?: string;
}

export type SdkRuntimeMode = "host" | "shared-runtime-pending" | "shared-runtime";

export interface SdkAdapterOptions {
  /** ADR-007: SDK cwd를 프로젝트 워크스페이스로 검증 */
  assertWorkspace?: (projectRoot: string) => Promise<string>;
  /** ADR-007 shared-runtime POC — docker 컨테이너 준비 확인 후 호스트 SDK 실행 */
  runtimeMode?: SdkRuntimeMode;
  assertContainerPrepared?: (
    projectId: string,
    projectRoot: string,
  ) => Promise<void>;
  /** ADR-007 POC 3 — shared-runtime 시 docker exec 대상 컨테이너 */
  resolveContainerName?: (projectId: string) => string | undefined;
  /** docker exec SDK runner timeout (13 EXEC_TIMEOUT_MS) */
  containerExecTimeoutMs?: number;
}

export interface SdkRunHandle {
  runId: string;
  streamEvents(): AsyncIterable<DomainEvent>;
  wait(): Promise<{ status: "finished" | "error" | "cancelled" }>;
  cancel(): Promise<void>;
}

/** string 또는 SDKUserMessage(images) — 04 §6.3 */
export type SdkPromptInput =
  | string
  | { text: string; images?: Array<{ data: string; mimeType: string }> };

export interface SdkAgentHandle {
  agentId: string;
  send(prompt: SdkPromptInput): Promise<SdkRunHandle>;
  dispose(): Promise<void>;
}

type SdkAgent = Awaited<ReturnType<typeof Agent.create>>;

const FILE_TOOL_NAMES = new Set([
  "write",
  "edit",
  "search_replace",
  "delete_file",
  "edit_file",
  "apply_patch",
]);

export class SdkAdapter {
  constructor(private options: SdkAdapterOptions = {}) {}

  async createAgent(spec: AgentCreateSpec): Promise<SdkAgentHandle> {
    try {
      const cwd = this.options.assertWorkspace
        ? await this.options.assertWorkspace(spec.cwd)
        : spec.cwd;
      if (
        (this.options.runtimeMode === "shared-runtime-pending" ||
          this.options.runtimeMode === "shared-runtime") &&
        spec.projectId &&
        this.options.assertContainerPrepared
      ) {
        await this.options.assertContainerPrepared(spec.projectId, cwd);
      }
      if (this.options.runtimeMode === "shared-runtime") {
        return this.createAgentInContainer(spec);
      }
      const agent = await Agent.create({
        apiKey: spec.apiKey,
        model: { id: spec.model },
        local: { cwd, settingSources: [] },
      });
      return this.wrapAgent(agent);
    } catch (err) {
      throw classifyStartupError(err);
    }
  }

  async resumeAgent(
    agentId: string,
    apiKey: string,
    projectRoot?: string,
    projectId?: string,
  ): Promise<SdkAgentHandle> {
    try {
      if (this.options.assertWorkspace && projectRoot) {
        await this.options.assertWorkspace(projectRoot);
      }
      if (
        (this.options.runtimeMode === "shared-runtime-pending" ||
          this.options.runtimeMode === "shared-runtime") &&
        projectId &&
        projectRoot &&
        this.options.assertContainerPrepared
      ) {
        await this.options.assertContainerPrepared(projectId, projectRoot);
      }
      if (this.options.runtimeMode === "shared-runtime") {
        return this.resumeAgentInContainer(agentId, apiKey, projectId);
      }
      const agent = await Agent.resume(agentId, { apiKey });
      return this.wrapAgent(agent);
    } catch (err) {
      throw classifyStartupError(err);
    }
  }

  async listModels(apiKey: string): Promise<Array<{ id: string; name?: string }>> {
    try {
      const models = await Cursor.models.list({ apiKey });
      return models.map((m) => ({ id: m.id }));
    } catch {
      return [{ id: "composer-2.5" }];
    }
  }

  private async createAgentInContainer(
    spec: AgentCreateSpec,
  ): Promise<SdkAgentHandle> {
    const bridge = await this.containerBridge(spec.projectId);
    const { containerWorkspacePath } = await import(
      "./sdk-container-runtime.js"
    );
    return bridge.createAgent({
      ...spec,
      cwd: containerWorkspacePath(),
    });
  }

  private async resumeAgentInContainer(
    agentId: string,
    apiKey: string,
    projectId?: string,
  ): Promise<SdkAgentHandle> {
    const bridge = await this.containerBridge(projectId);
    return bridge.resumeHandle(agentId, apiKey);
  }

  private async containerBridge(projectId?: string) {
    const containerName = this.requireContainerName(projectId);
    const { ContainerSdkBridge } = await import("./container-sdk-bridge.js");
    return new ContainerSdkBridge(containerName, {
      execTimeoutMs: this.options.containerExecTimeoutMs,
    });
  }

  private requireContainerName(projectId?: string): string {
    if (!projectId || !this.options.resolveContainerName) {
      throw classifyStartupError(
        new Error(
          "shared-runtime requires a prepared sandbox container for the project",
        ),
      );
    }
    const containerName = this.options.resolveContainerName(projectId);
    if (!containerName) {
      throw classifyStartupError(
        new Error(
          `No sandbox container for project "${projectId}" (shared-runtime)`,
        ),
      );
    }
    return containerName;
  }

  private wrapAgent(agent: SdkAgent): SdkAgentHandle {
    return {
      agentId: agent.agentId,
      send: (prompt: SdkPromptInput) => this.wrapSend(agent, prompt),
      dispose: async () => {
        agent.close();
      },
    };
  }

  private async wrapSend(
    agent: SdkAgent,
    prompt: SdkPromptInput,
  ): Promise<SdkRunHandle> {
    try {
      const run = await agent.send(prompt);
      const runId = run.id;

      return {
        runId,
        streamEvents: () => this.mapStream(run, runId),
        wait: async () => {
          const result = await run.wait();
          if (result.status === "finished") {
            return { status: "finished" as const };
          }
          if (result.status === "cancelled") {
            return { status: "cancelled" as const };
          }
          return { status: "error" as const };
        },
        cancel: async () => {
          if (run.supports("cancel")) {
            await run.cancel();
          }
        },
      };
    } catch (err) {
      throw classifyStartupError(err);
    }
  }

  private async *mapStream(
    run: Awaited<ReturnType<SdkAgent["send"]>>,
    runId: string,
  ): AsyncIterable<DomainEvent> {
    for await (const event of run.stream()) {
      const mapped = mapSdkMessage(event, runId);
      if (mapped) {
        yield mapped;
      } else {
        console.debug(`[SdkAdapter] unmapped SDK message type=${event.type}`);
      }
    }
  }
}

function mapSdkMessage(
  event: SDKMessage,
  runId: string,
): DomainEvent | null {
  if (event.type === "assistant") {
    const text = event.message.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
    if (!text) return null;
    return { type: "assistant", runId, text };
  }

  if (event.type === "task" && event.text) {
    const steps = event.text
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    if (steps.length === 0) return null;
    return { type: "plan", runId, steps };
  }

  if (event.type === "tool_call") {
    const status = event.status ?? "running";
    if (status === "running") {
      const fileChange = mapFileChangeFromTool(event.name, event.args, runId);
      if (fileChange) return fileChange;
      return {
        type: "tool",
        runId,
        name: event.name,
        callId: event.call_id,
        toolStatus: "started",
        input:
          typeof event.args === "object" && event.args !== null
            ? (event.args as Record<string, unknown>)
            : {},
        outputChannel: AGENT_TOOL_OUTPUT_CHANNEL,
      };
    }
    if (status === "completed" || status === "error") {
      return {
        type: "tool",
        runId,
        name: event.name,
        callId: event.call_id,
        toolStatus: status === "error" ? "error" : "completed",
        output: formatToolResult(event.result),
        outputChannel: AGENT_TOOL_OUTPUT_CHANNEL,
      };
    }
    return null;
  }

  if (event.type === "status" && event.message?.toLowerCase().includes("approval")) {
    return {
      type: "approval_required",
      runId,
      approvalId: `${runId}-approval`,
      detail: event.message,
    };
  }

  return null;
}

function formatToolResult(result: unknown): string {
  if (result == null) return "";
  if (typeof result === "string") return result;
  if (
    typeof result === "object" &&
    result !== null &&
    "output" in result &&
    typeof (result as { output: unknown }).output === "string"
  ) {
    return (result as { output: string }).output;
  }
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

function mapFileChangeFromTool(
  name: string,
  args: unknown,
  runId: string,
): DomainEvent | null {
  if (!FILE_TOOL_NAMES.has(name)) return null;
  const record =
    typeof args === "object" && args !== null
      ? (args as Record<string, unknown>)
      : {};
  const filePath =
    (record.path as string | undefined) ??
    (record.file_path as string | undefined) ??
    (record.target_file as string | undefined);
  if (!filePath) return null;

  const changeKind =
    name === "delete_file" ? ChangeKind.DELETE : ChangeKind.EDIT;
  return { type: "file_change", runId, path: filePath, changeKind };
}

export function classifyStartupError(err: unknown): DomainEvent {
  if (err instanceof CursorAgentError) {
    return {
      type: "error",
      errorKind: ErrorKind.STARTUP,
      message: err.message,
      retryable: err.isRetryable,
    };
  }
  if (isSandboxError(err)) {
    return {
      type: "error",
      errorKind: ErrorKind.STARTUP,
      message: err.message,
      retryable: err.retryable,
    };
  }
  const message = err instanceof Error ? err.message : String(err);
  return {
    type: "error",
    errorKind: ErrorKind.STARTUP,
    message,
    retryable: false,
  };
}

export function runErrorEvent(
  runId: string,
  message: string,
  retryable = false,
): DomainEvent {
  return {
    type: "error",
    runId,
    errorKind: ErrorKind.RUN,
    message,
    retryable,
  };
}

export function runDoneEvent(
  runId: string,
  status: "finished" | "error" | "cancelled",
): DomainEvent {
  const mapped =
    status === "finished"
      ? RunTerminalStatus.FINISHED
      : status === "cancelled"
        ? RunTerminalStatus.CANCELLED
        : RunTerminalStatus.ERROR;
  return { type: "run_done", runId, status: mapped };
}

/** @internal unit tests */
export function mapSdkMessageForTest(
  event: SDKMessage,
  runId: string,
): DomainEvent | null {
  return mapSdkMessage(event, runId);
}
