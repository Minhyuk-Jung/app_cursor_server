import { execFileSync } from "node:child_process";

/**
 * ADR-007 shared-runtime POC — 컨테이너 내부 Node 런타임 준비 확인.
 * SDK in-container(3단계) 전 필수 전제: exec 샌드박스 이미지에 node 제공.
 */
export function verifyContainerNodeRuntime(containerName: string): void {
  try {
    execFileSync("docker", ["exec", containerName, "node", "-v"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    throw new Error(
      `Container "${containerName}" has no usable Node.js runtime (shared-runtime POC prerequisite)`,
    );
  }
}

/** ADR-007 POC 3 — 컨테이ner에 @cursor/sdk 패키지 존재 확인 (SDK_IN_CONTAINER) */
export function verifyContainerSdkPackage(containerName: string): void {
  try {
    execFileSync(
      "docker",
      [
        "exec",
        "-w",
        "/opt/cursor-sdk",
        containerName,
        "node",
        "-e",
        "require.resolve('@cursor/sdk')",
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
  } catch {
    throw new Error(
      `Container "${containerName}" is missing @cursor/sdk — set SANDBOX_DOCKER_IMAGE to an image with SDK installed (shared-runtime POC 3)`,
    );
  }
}

/** bind mount 워크스페이스 → 컨테이ner 내부 cwd (/workspace) */
export function containerWorkspacePath(): string {
  return "/workspace";
}
