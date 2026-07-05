import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import type { MobileSettings } from "../config";
import { subscribeExpoPush, unsubscribeExpoPush } from "../api/client";

const PUSH_TOKEN_KEY = "expo-push-token";

export type PushRegisterResult =
  | { ok: true; token: string }
  | { ok: false; reason: "denied" | "error"; message: string };

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

function expoProjectId(): string | undefined {
  return (
    Constants.expoConfig?.extra?.eas?.projectId ??
    (Constants as { easConfig?: { projectId?: string } }).easConfig?.projectId
  );
}

/** P7 mobile 3~4차 — Expo 토큰 획득 후 서버 등록 */
export async function registerMobilePushToken(
  settings: MobileSettings,
): Promise<PushRegisterResult> {
  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;
  if (existing !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== "granted") {
    return { ok: false, reason: "denied", message: "알림 권한이 거부되었습니다" };
  }

  const projectId = expoProjectId();
  if (!projectId) {
    return {
      ok: false,
      reason: "error",
      message: "app.json extra.eas.projectId가 필요합니다",
    };
  }

  try {
    const token = (
      await Notifications.getExpoPushTokenAsync({ projectId })
    ).data;
    await AsyncStorage.setItem(PUSH_TOKEN_KEY, token);
    await subscribeExpoPush(settings, token);
    return { ok: true, token };
  } catch (err) {
    const message = err instanceof Error ? err.message : "푸시 토큰 등록 실패";
    return { ok: false, reason: "error", message };
  }
}

export async function unregisterMobilePushToken(
  settings: MobileSettings,
): Promise<void> {
  const token = await getStoredPushToken();
  if (!token) return;
  try {
    await unsubscribeExpoPush(settings, token);
  } catch {
    // 서버 해제 실패해도 로컬 토큰은 제거
  }
  await AsyncStorage.removeItem(PUSH_TOKEN_KEY);
}

export async function getStoredPushToken(): Promise<string | null> {
  return AsyncStorage.getItem(PUSH_TOKEN_KEY);
}

/** 알림 탭·cold start deeplink */
export function addNotificationResponseListener(
  onDeeplink: (deeplink: string) => void,
): Notifications.Subscription {
  return Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data;
    const deeplink =
      typeof data?.deeplink === "string" ? data.deeplink : undefined;
    if (deeplink && deeplink.length > 0) {
      onDeeplink(deeplink);
    }
  });
}

export async function getInitialNotificationDeeplink(): Promise<string | null> {
  const response = await Notifications.getLastNotificationResponseAsync();
  if (!response) return null;
  const deeplink = response.notification.request.content.data?.deeplink;
  return typeof deeplink === "string" && deeplink.length > 0 ? deeplink : null;
}
