/** UR-02 — web/mobile 공유 파일 REST 경로 (10차) */
export function projectTreePath(baseUrl: string, projectId: string): string {
  return `${baseUrl.replace(/\/$/, "")}/api/v1/projects/${projectId}/tree`;
}

export function projectFilePath(baseUrl: string, projectId: string): string {
  return `${baseUrl.replace(/\/$/, "")}/api/v1/projects/${projectId}/file`;
}

export function projectSearchPath(
  baseUrl: string,
  projectId: string,
  query: string,
): string {
  const url = new URL(
    `${baseUrl.replace(/\/$/, "")}/api/v1/projects/${projectId}/search`,
  );
  url.searchParams.set("q", query);
  return url.toString();
}

/** P7 mobile 12차 — git 상태 REST 경로 */
export function projectGitPath(baseUrl: string, projectId: string): string {
  return `${baseUrl.replace(/\/$/, "")}/api/v1/projects/${projectId}/git`;
}
