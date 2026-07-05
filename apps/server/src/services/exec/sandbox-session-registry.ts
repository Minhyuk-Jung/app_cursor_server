import { randomUUID } from "node:crypto";
import type { DockerSandboxManager } from "./docker-sandbox-manager.js";
import type { SandboxService } from "./sandbox-service.js";
import { sandboxError, isSandboxError } from "./sandbox-errors.js";

export type SandboxSessionStatus = "ready" | "running" | "idle";

/** 13 §5.1 resourceLimits */
export interface SandboxResourceLimits {
  memoryMb: number;
  cpus: number;
  execTimeoutMs: number;
}

/** 13 §5.1 — 프로젝트별 샌드박스 세션 (in-memory, P6) */
export interface SandboxSession {
  sandboxId: string;
  projectId: string;
  status: SandboxSessionStatus;
  createdAt: number;
  lastActivityAt: number;
  resourceLimits: SandboxResourceLimits;
  /** docker 모드 — 재사용 컨테이너 (13 §6.1) */
  containerName?: string;
  /** preview 프록시 upstream host (bridge IP) */
  containerHost?: string;
}

export interface SandboxSessionRegistryDeps {
  sandboxService?: SandboxService;
  dockerManager?: DockerSandboxManager;
}

/**
 * 13 §4 샌드박스 관리기 — 프로젝트별 세션 생성·유휴 파기.
 * docker 모드: DockerSandboxManager로 컨테이너 재사용 (ADR-007 P6).
 */
export class SandboxSessionRegistry {
  constructor(
    private defaultLimits: SandboxResourceLimits,
    private deps: SandboxSessionRegistryDeps = {},
  ) {}

  getOrCreate(projectId: string): SandboxSession {
    let session = this.sessions.get(projectId);
    if (!session) {
      session = {
        sandboxId: randomUUID(),
        projectId,
        status: "ready",
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
        resourceLimits: { ...this.defaultLimits },
      };
      this.sessions.set(projectId, session);
    }
    return session;
  }

  /**
   * docker 모드 — 컨테이너가 이미 준비됐으면 host refresh만 (13 §6.1 재사용).
   */
  ensurePrepared(projectId: string, projectRoot: string, running: boolean): SandboxSession {
    if (this.deps.sandboxService?.getMode() !== "docker") {
      return this.getOrCreate(projectId);
    }
    const session = this.getOrCreate(projectId);
    if (session.containerName && session.containerHost) {
      session.containerHost = this.deps.dockerManager!.getContainerHost(
        session.containerName,
      );
      session.status = running ? "running" : "idle";
      session.lastActivityAt = Date.now();
      return session;
    }
    return this.prepare(projectId, projectRoot, running);
  }

  /**
   * exec/SDK 공통 — docker 모드 시 프로젝트 컨테이너 준비 (13 §6.1, ADR-007).
   */
  prepare(projectId: string, projectRoot: string, running: boolean): SandboxSession {
    const session = this.getOrCreate(projectId);
    const mode = this.deps.sandboxService?.getMode();

    if (mode === "docker") {
      if (!this.deps.dockerManager) {
        throw sandboxError(
          "docker_unavailable",
          "SANDBOX_MODE=docker but Docker is not available",
          false,
        );
      }
      try {
        if (session.containerName) {
          session.containerHost = this.deps.dockerManager.getContainerHost(
            session.containerName,
          );
        } else {
          const cfg = this.deps.sandboxService!.getExecConfig();
          const container = this.deps.dockerManager.ensureContainer({
            projectId,
            projectRoot,
            image: cfg.dockerImage,
            memoryMb: cfg.sandboxMemoryMb,
            cpus: cfg.sandboxCpus,
          });
          session.containerName = container.containerName;
          session.containerHost = container.host;
        }
      } catch (err) {
        if (isSandboxError(err)) throw err;
        throw sandboxError(
          "sandbox_create_failed",
          err instanceof Error ? err.message : "Docker sandbox create failed",
          true,
        );
      }
    }

    session.status = running ? "running" : "idle";
    session.lastActivityAt = Date.now();
    return session;
  }

  touch(projectId: string, running: boolean): SandboxSession {
    const session = this.getOrCreate(projectId);
    session.status = running ? "running" : "idle";
    session.lastActivityAt = Date.now();
    return session;
  }

  get(projectId: string): SandboxSession | undefined {
    return this.sessions.get(projectId);
  }

  /** preview upstream — docker 컨테이너 IP 또는 localhost (subprocess) */
  resolvePreviewHost(projectId: string): string {
    if (this.deps.sandboxService?.getMode() === "docker") {
      const session = this.sessions.get(projectId);
      if (!session?.containerHost) {
        throw sandboxError(
          "sandbox_not_ready",
          "Docker sandbox container is not prepared for preview",
          true,
        );
      }
      return session.containerHost;
    }
    return "127.0.0.1";
  }

  /**
   * 프로젝트 단위 즉시 파기 (아카이브·삭제 시 orphan 컨테이너 방지, §6.4).
   */
  purgeProject(projectId: string, onPurge?: (projectId: string) => void): boolean {
    const session = this.sessions.get(projectId);
    if (!session) return false;
    if (session.containerName && this.deps.dockerManager) {
      this.deps.dockerManager.removeContainer(session.containerName);
    }
    onPurge?.(projectId);
    this.sessions.delete(projectId);
    return true;
  }

  /** 서버 종료 시 전체 샌드박스 파기 (13 §6.4) */
  purgeAll(onPurge?: (projectId: string) => void): number {
    let purged = 0;
    for (const projectId of [...this.sessions.keys()]) {
      if (this.purgeProject(projectId, onPurge)) purged += 1;
    }
    return purged;
  }

  /**
   * 유휴 세션 파기. running이지만 lastActivity 초과 시 stale로 간주해 onPurge 후 제거 (§6.4).
   */
  purgeIdle(
    idleMs: number,
    onPurge?: (projectId: string) => void,
  ): number {
    const now = Date.now();
    let purged = 0;
    for (const [projectId, session] of this.sessions) {
      const stale = now - session.lastActivityAt > idleMs;
      if (!stale) continue;
      if (session.status === "idle" || session.status === "running") {
        if (session.containerName && this.deps.dockerManager) {
          this.deps.dockerManager.removeContainer(session.containerName);
        }
        onPurge?.(projectId);
        this.sessions.delete(projectId);
        purged += 1;
      }
    }
    return purged;
  }

  size(): number {
    return this.sessions.size;
  }

  private sessions = new Map<string, SandboxSession>();
}
