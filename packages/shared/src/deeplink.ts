/** 09→16 인박스·푸시 deeplink (web/mobile 공유) */
export type DeeplinkView = "diff" | "session" | "terminal" | "git";

export interface ParsedDeeplink {
  projectId?: string;
  sessionId?: string;
  view?: DeeplinkView;
}

export function parseDeeplink(deeplink: string): ParsedDeeplink {
  const diffMatch = deeplink.match(/^\/project\/([^/]+)\/diff$/);
  if (diffMatch) {
    return { projectId: diffMatch[1], view: "diff" };
  }
  const gitMatch = deeplink.match(/^\/project\/([^/]+)\/git$/);
  if (gitMatch) {
    return { projectId: gitMatch[1], view: "git" };
  }
  const terminalMatch = deeplink.match(/^\/project\/([^/]+)\/terminal$/);
  if (terminalMatch) {
    return { projectId: terminalMatch[1], view: "terminal" };
  }
  const m = deeplink.match(/^\/project\/([^/]+)(?:\/session\/([^/]+))?/);
  if (!m) return {};
  return {
    projectId: m[1],
    sessionId: m[2],
    view: m[2] ? "session" : undefined,
  };
}

/** 09→16 인박스 항목 → 프로젝트·뷰 네비게이션 */
export function resolveInboxNavigation(item: {
  deeplink?: string | null;
  projectId?: string | null;
  kind: string;
}): ParsedDeeplink {
  const parsed = parseDeeplink(item.deeplink ?? "");
  const projectId = parsed.projectId ?? item.projectId ?? undefined;
  const view =
    parsed.view ??
    (item.kind === "exec_timeout" || item.kind === "exec_memory_limit"
      ? "terminal"
      : undefined);
  return {
    projectId,
    sessionId: parsed.sessionId,
    view:
      view === "diff" || view === "terminal" || view === "git"
        ? view
        : undefined,
  };
}
