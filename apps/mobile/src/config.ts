import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";

export interface MobileSettings {
  apiBaseUrl: string;
  apiKey: string;
}

const STORAGE_KEY = "remote-dev-mobile-settings";

export const DEFAULT_SETTINGS: MobileSettings = {
  apiBaseUrl: "http://127.0.0.1:3000",
  apiKey: "dev-local-key",
};

/** Maestro device CI — EXPO_PUBLIC_MAESTRO_E2E=1 빌드에서 알림 등록 skip */
export function isMaestroE2eMode(): boolean {
  return Constants.expoConfig?.extra?.maestroE2e === true;
}

/** UR-15 — 웹 config.ts 와 동일 */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export async function loadSettings(): Promise<MobileSettings | null> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as MobileSettings;
    if (!parsed.apiBaseUrl?.trim() || !parsed.apiKey?.trim()) return null;
    return {
      apiBaseUrl: parsed.apiBaseUrl.trim().replace(/\/$/, ""),
      apiKey: parsed.apiKey.trim(),
    };
  } catch {
    return null;
  }
}

export async function saveSettings(settings: MobileSettings): Promise<void> {
  await AsyncStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      apiBaseUrl: settings.apiBaseUrl.trim().replace(/\/$/, ""),
      apiKey: settings.apiKey.trim(),
    }),
  );
}
