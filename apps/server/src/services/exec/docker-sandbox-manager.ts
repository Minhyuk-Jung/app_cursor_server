import { execFileSync } from "node:child_process";

export const DOCKER_SANDBOX_NETWORK = "cursor-sandboxes";

export function isDockerAvailable(): boolean {
  try {
    execFileSync("docker", ["version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export interface DockerSandboxContainer {
  containerName: string;
  /** bridge network IP — preview 프록시 upstream (13 §6.3) */
  host: string;
}

/**
 * 13 §6.1 + ADR-007 — 프로젝트별 격리 컨테이너 생성·재사용·파기.
 * exec는 `docker exec`, 프리뷰는 컨테이너 IP:port 로 연결한다.
 */
export class DockerSandboxManager {
  private networkReady = false;

  constructor(
    private readonly options: { networkInternal?: boolean } = {},
  ) {}

  containerNameFor(projectId: string): string {
    const safe = projectId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40);
    return `cursor-sb-${safe || "proj"}`;
  }

  ensureNetwork(): void {
    if (this.networkReady) return;
    try {
      execFileSync("docker", ["network", "inspect", DOCKER_SANDBOX_NETWORK], {
        stdio: "ignore",
      });
    } catch {
      const createArgs = ["network", "create"];
      if (this.options.networkInternal) {
        createArgs.push("--internal");
      }
      createArgs.push(DOCKER_SANDBOX_NETWORK);
      execFileSync("docker", createArgs, {
        stdio: "ignore",
      });
    }
    this.networkReady = true;
  }

  ensureContainer(input: {
    projectId: string;
    projectRoot: string;
    image: string;
    memoryMb: number;
    cpus: number;
  }): DockerSandboxContainer {
    this.ensureNetwork();
    const containerName = this.containerNameFor(input.projectId);
    const mount =
      process.platform === "win32"
        ? input.projectRoot.replace(/\\/g, "/")
        : input.projectRoot;

    if (this.containerExists(containerName)) {
      if (!this.containerRunning(containerName)) {
        execFileSync("docker", ["start", containerName], { stdio: "ignore" });
      }
      return { containerName, host: this.getContainerIp(containerName) };
    }

    execFileSync(
      "docker",
      [
        "run",
        "-d",
        "--name",
        containerName,
        "--network",
        DOCKER_SANDBOX_NETWORK,
        "--cpus",
        String(input.cpus),
        "--memory",
        `${input.memoryMb}m`,
        "-v",
        `${mount}:/workspace`,
        "-w",
        "/workspace",
        input.image,
        "sleep",
        "infinity",
      ],
      { stdio: "ignore" },
    );

    return { containerName, host: this.getContainerHost(containerName) };
  }

  /** bridge IP 조회 (prepare·preview refresh) */
  getContainerHost(containerName: string): string {
    return this.getContainerIp(containerName);
  }

  /** cursor-sb-* 컨테이너 이름 목록 */
  listManagedContainerNames(): string[] {
    try {
      const out = execFileSync(
        "docker",
        [
          "ps",
          "-a",
          "--filter",
          "name=cursor-sb-",
          "--format",
          "{{.Names}}",
        ],
        { encoding: "utf8" },
      );
      return out
        .trim()
        .split(/\r?\n/)
        .filter((n) => n.startsWith("cursor-sb-"));
    } catch {
      return [];
    }
  }

  /** stopped orphan cursor-sb 컨테이너 정리 (서버 기동 시 §6.4) */
  pruneStoppedManagedContainers(): number {
    let pruned = 0;
    for (const name of this.listManagedContainerNames()) {
      if (!this.containerRunning(name)) {
        this.removeContainer(name);
        pruned += 1;
      }
    }
    return pruned;
  }

  removeContainer(containerName: string): void {
    try {
      execFileSync("docker", ["rm", "-f", containerName], { stdio: "ignore" });
    } catch {
      /* already gone */
    }
  }

  private containerExists(name: string): boolean {
    try {
      execFileSync("docker", ["inspect", name], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }

  private containerRunning(name: string): boolean {
    try {
      const out = execFileSync(
        "docker",
        ["inspect", "-f", "{{.State.Running}}", name],
        { encoding: "utf8" },
      );
      return out.trim() === "true";
    } catch {
      return false;
    }
  }

  private getContainerIp(name: string): string {
    const out = execFileSync(
      "docker",
      [
        "inspect",
        "-f",
        "{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}",
        name,
      ],
      { encoding: "utf8" },
    );
    const ip = out.trim();
    if (!ip) {
      throw new Error(`Docker sandbox has no network IP: ${name}`);
    }
    return ip;
  }
}
