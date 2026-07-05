import AsyncStorage from "@react-native-async-storage/async-storage";

const prefix = "remote-dev-cursor";

export async function loadCursor(
  scope: "session",
  scopeId: string,
): Promise<number> {
  const raw = await AsyncStorage.getItem(`${prefix}:${scope}:${scopeId}`);
  const n = Number(raw ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export async function saveCursor(
  scope: "session",
  scopeId: string,
  seq: number,
): Promise<void> {
  await AsyncStorage.setItem(`${prefix}:${scope}:${scopeId}`, String(seq));
}
