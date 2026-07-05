import { relative } from "node:path";
import {
  PathEscapeError,
  assertAbsoluteWithinRoot,
  resolveSafePath,
} from "../file/path-safe.js";
import type { SandboxMode } from "./types.js";

export interface SandboxPolicy {
  mode: SandboxMode;
  /** @cursor/sdk local runtime requires host filesystem path */
  sdkRunsOnHost: boolean;
  /** terminal exec uses container when mode=docker */
  execContainerized: boolean;
  /** ADR-007 P6: 동일 project rootPath·마운트 검증 */
  validatedWorkspacePath: true;
  /** ADR-007: exec 컨테이너와 SDK가 같은 호스트 워크스페이스 마운트 공유 (docker) */
  sharedWorkspaceMount: boolean;
  /** subprocess=완화 모드, docker=컨테이너 exec */
  mitigationMode: SandboxMode;
  /** ADR-007 단계 — mitigation | shared-path | shared-runtime-pending | shared-runtime */
  adr007Phase:
    | "mitigation"
    | "shared-path"
    | "shared-runtime-pending"
    | "shared-runtime";
  /** shared-runtime POC 요청(env) — 구현 전까지 sdkRunsOnHost는 true */
  sharedRuntimeRequested: boolean;
}

export interface SandboxServiceConfig {
  sandboxMode: SandboxMode;
  execTimeoutMs: number;
  maxConcurrentExec: number;
  perProjectMaxExec: number;
  dockerImage: string;
  sandboxMemoryMb: number;
  sandboxCpus: number;
  sdkSharedRuntime?: boolean;
  sdkInContainer?: boolean;
}

/**
 * 13 §8 + ADR-007 — 프로젝트별 샌드박스 정책·경로 검증 단일 원천.
 * 터미널(ExecService)과 SDK 에이전트가 동일 workspace 경로·격리 모드를 공유한다.
 */
export class SandboxService {
  constructor(private config: SandboxServiceConfig) {}

  getMode(): SandboxMode {
    return this.config.sandboxMode;
  }

  getExecConfig(): Omit<SandboxServiceConfig, never> {
    return this.config;
  }

  getPolicy(): SandboxPolicy {
    return sandboxPolicyFallback(this.config);
  }

  /** exec/SDK 공통 — 프로젝트 rootPath 검증 */
  async assertProjectWorkspace(projectRoot: string): Promise<string> {
    return this.resolveExecCwd(projectRoot, ".");
  }

  /** exec cwd — projectRoot 내부 relative 경로만 허용 (SEC-04) */
  async resolveExecCwd(
    projectRoot: string,
    relativeCwd = ".",
  ): Promise<string> {
    return resolveSafePath(projectRoot, relativeCwd);
  }

  /** docker mount용 project root (항상 프로젝트 루트 마운트) */
  dockerWorkdir(projectRoot: string, execCwd: string): string {
    const rel = relative(projectRoot, execCwd).replace(/\\/g, "/");
    if (!rel || rel === ".") return "/workspace";
    return `/workspace/${rel}`;
  }

  /**
   * subprocess 완화 모드 — 명령 문자열 내 절대 경로가 프로젝트 밖을 가리키면 거부 (13 §10, SEC-04).
   * docker 모드는 컨테이너 격리로 스킵.
   */
  async assertSubprocessCommand(
    projectRoot: string,
    command: string,
  ): Promise<void> {
    if (this.config.sandboxMode !== "subprocess") return;

    const winPaths = command.match(/[A-Za-z]:\\[^\s'"`;|&<>]+/g) ?? [];
    for (const raw of winPaths) {
      try {
        await assertAbsoluteWithinRoot(projectRoot, raw);
      } catch (err) {
        if (err instanceof PathEscapeError) throw err;
        throw err;
      }
    }

    const unixMatches = command.match(/(?:^|[\s'"=])(\/[^\s'"`;|&<>]+)/g) ?? [];
    for (const match of unixMatches) {
      const raw = match.trim().replace(/^['"=]/, "");
      if (raw === "/dev/null" || raw.startsWith("/dev/")) continue;
      try {
        await assertAbsoluteWithinRoot(projectRoot, raw);
      } catch (err) {
        if (err instanceof PathEscapeError) throw err;
        throw err;
      }
    }
  }
}

/** sandboxService 미주입 시 /health fallback용 */
export function sandboxPolicyFallback(
  config: Pick<
    SandboxServiceConfig,
    "sandboxMode" | "sdkSharedRuntime" | "sdkInContainer"
  >,
): SandboxPolicy {
  const mode = config.sandboxMode;
  const docker = mode === "docker";
  const sharedRuntimeRequested = Boolean(config.sdkSharedRuntime);
  const sdkInContainer = Boolean(config.sdkInContainer);
  return {
    mode,
    sdkRunsOnHost: !sdkInContainer,
    execContainerized: docker,
    validatedWorkspacePath: true,
    sharedWorkspaceMount: docker,
    mitigationMode: mode,
    adr007Phase:
      sdkInContainer && docker
        ? "shared-runtime"
        : sharedRuntimeRequested && docker
          ? "shared-runtime-pending"
          : docker
            ? "shared-path"
            : "mitigation",
    sharedRuntimeRequested: sharedRuntimeRequested || sdkInContainer,
  };
}
