export interface MaestroConnectSettings {
  apiBaseUrl: string;
  apiKey: string;
}

export interface MaestroAutoConnectDeps {
  checkHealth: (settings: MaestroConnectSettings) => Promise<boolean>;
  verifyApiAccess: (settings: MaestroConnectSettings) => Promise<void>;
  saveSettings: (settings: MaestroConnectSettings) => Promise<void>;
  sleepMs: (ms: number) => Promise<void>;
}

/** Maestro E2E 빌드 — clearState 후 DEFAULT_SETTINGS 자동 연결 (CI 안정화) */
export async function tryMaestroAutoConnect(
  enabled: boolean,
  settings: MaestroConnectSettings,
  deps: MaestroAutoConnectDeps,
): Promise<MaestroConnectSettings | null> {
  if (!enabled) return null;

  for (let attempt = 0; attempt < 45; attempt += 1) {
    if (await deps.checkHealth(settings)) {
      try {
        await deps.verifyApiAccess(settings);
        await deps.saveSettings(settings);
        return settings;
      } catch {
        // API 준비 전·일시 오류 — 재시도
      }
    }
    await deps.sleepMs(1000);
  }
  return null;
}
