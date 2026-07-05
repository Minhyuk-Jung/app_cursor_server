import type { ServerConfig } from "../../config.js";

export type ChannelInboundMode = "push" | "pull";

/** 10 §4 — 채널별 인바운드 연결 방식 (레지스트리 스켈레톤) */
export function resolveChannelInboundMode(
  channel: string,
  config: ServerConfig,
): ChannelInboundMode | null {
  if (channel === "telegram") {
    return config.telegramPullMode ? "pull" : "push";
  }
  if (channel === "intranet") {
    return config.intranetMessengerPollUrl ? "pull" : null;
  }
  if (channel === "custom") {
    return "push";
  }
  return null;
}

export function isTelegramPushInboundEnabled(config: ServerConfig): boolean {
  return Boolean(config.telegramBotToken) && !config.telegramPullMode;
}

export function isTelegramPullInboundEnabled(config: ServerConfig): boolean {
  return Boolean(config.telegramBotToken) && config.telegramPullMode;
}

export function isIntranetPullInboundEnabled(config: ServerConfig): boolean {
  return Boolean(config.intranetMessengerPollUrl);
}
