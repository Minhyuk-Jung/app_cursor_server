export interface AppSettings {
  apiBaseUrl: string;
  apiKey: string;
  accessToken?: string;
  refreshToken?: string;
}

const STORAGE_KEY = "remote-dev-settings";

/** 20 NFR-33 — server FileService 와 동일 */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

const defaults: AppSettings = {
  apiBaseUrl: "",
  apiKey: "dev-local-key",
};

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...defaults, apiBaseUrl: window.location.origin };
    return { ...defaults, ...JSON.parse(raw) };
  } catch {
    return { ...defaults, apiBaseUrl: window.location.origin };
  }
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function cursorStorageKey(scope: "session", scopeId: string): string {
  return `cursor:${scope}:${scopeId}`;
}

export function loadCursor(scope: "session", scopeId: string): number {
  const raw = localStorage.getItem(cursorStorageKey(scope, scopeId));
  return raw ? Number(raw) : 0;
}

export function saveCursor(
  scope: "session",
  scopeId: string,
  cursor: number,
): void {
  localStorage.setItem(cursorStorageKey(scope, scopeId), String(cursor));
}
