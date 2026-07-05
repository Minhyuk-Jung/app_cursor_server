/** 13 §9 — 샌드박스·docker 실패 코드 */
export type SandboxErrorCode =
  | "docker_unavailable"
  | "sandbox_not_ready"
  | "sandbox_create_failed";

export function sandboxError(
  code: SandboxErrorCode,
  message: string,
  retryable: boolean,
): Error & { code: SandboxErrorCode; retryable: boolean } {
  return Object.assign(new Error(message), { code, retryable });
}

export function isSandboxError(
  err: unknown,
): err is Error & { code: SandboxErrorCode; retryable: boolean } {
  return (
    err instanceof Error &&
    typeof (err as { code?: string }).code === "string" &&
    [
      "docker_unavailable",
      "sandbox_not_ready",
      "sandbox_create_failed",
    ].includes((err as { code: string }).code)
  );
}
