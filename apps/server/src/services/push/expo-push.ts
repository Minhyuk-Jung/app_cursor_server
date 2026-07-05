const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_RECEIPT_URL = "https://exp.host/--/api/v2/push/getReceipts";

export function isValidExpoPushToken(token: string): boolean {
  return /^(ExponentPushToken|ExpoPushToken)\[[\w-]+\]$/.test(token.trim());
}

export interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}

export interface ExpoPushTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

export interface ExpoPushReceipt {
  status: "ok" | "error";
  message?: string;
  details?: { error?: string };
}

export async function getExpoPushReceipts(
  ids: string[],
): Promise<Record<string, ExpoPushReceipt>> {
  if (ids.length === 0) return {};

  const res = await fetch(EXPO_RECEIPT_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ids }),
  });

  if (!res.ok) {
    throw new Error(`Expo receipt HTTP ${res.status}`);
  }

  const body = (await res.json()) as {
    data?: Record<string, ExpoPushReceipt>;
  };
  return body.data ?? {};
}

export async function sendExpoPushMessages(
  messages: ExpoPushMessage[],
): Promise<ExpoPushTicket[]> {
  if (messages.length === 0) return [];

  const res = await fetch(EXPO_PUSH_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(messages.length === 1 ? messages[0] : messages),
  });

  if (!res.ok) {
    throw new Error(`Expo push HTTP ${res.status}`);
  }

  const body = (await res.json()) as { data?: ExpoPushTicket | ExpoPushTicket[] };
  const data = body.data;
  if (!data) return [];
  return Array.isArray(data) ? data : [data];
}
