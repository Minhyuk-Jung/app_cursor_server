import { DEFAULT_MODEL } from "@app/shared";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDockerAvailable } from "./services/exec/docker-sandbox-manager.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface ServerConfig {
  port: number;
  host: string;
  cursorApiKey: string;
  devApiKey: string;
  workspaceRoot: string;
  defaultModel: string;
  databaseUrl: string;
  maxConcurrentRuns: number;
  perProjectMaxRuns: number;
  agentCacheMax: number;
  queueLimit: number;
  customWebhookUrl?: string;
  notificationGroupWindowMs: number;
  usageDailyLimit: number;
  usageWarningRatio: number;
  quietHoursStart?: number;
  quietHoursEnd?: number;
  gitUserName: string;
  gitUserEmail: string;
  autoSnapshot: boolean;
  githubToken?: string;
  vapidPublicKey?: string;
  vapidPrivateKey?: string;
  vapidSubject: string;
  perUserMaxRuns: number;
  maxRetryAttempts: number;
  retryBackoffMs: number;
  telegramBotToken?: string;
  telegramWebhookSecret?: string;
  /** P7 S31 — 인바운드 웹훅 대신 getUpdates long polling */
  telegramPullMode: boolean;
  telegramPollIntervalMs: number;
  telegramLongPollTimeoutSec: number;
  telegramPollMaxBackoffMs: number;
  /** S31 UR-13 — 사내 메신저 pull API (GET JSON) */
  intranetMessengerPollUrl?: string;
  intranetMessengerPollIntervalMs: number;
  intranetMessengerPollMaxBackoffMs: number;
  intranetMessengerAuthHeader?: string;
  /** 사내 메신저 아웃바운드 reply URL (POST { chatId, text }) */
  intranetMessengerNotifyUrl?: string;
  gitRemoteWhitelist: string[];
  webhookSecret?: string;
  jwtSecret?: string;
  jwtAccessTtlSec: number;
  jwtRefreshTtlSec: number;
  rateLimitMax: number;
  rateLimitWindowMs: number;
  authRateLimitMax: number;
  authRateLimitWindowMs: number;
  runEventRetentionDays: number;
  sandboxMode: "subprocess" | "docker";
  execTimeoutMs: number;
  maxConcurrentExec: number;
  perProjectMaxExec: number;
  sandboxDockerImage: string;
  sandboxIdleMs: number;
  previewTokenTtlSec: number;
  previewPortMin: number;
  previewPortMax: number;
  sandboxMemoryMb: number;
  sandboxCpus: number;
  /** ADR-007 shared-runtime POC — 미구현 시 sdkRunsOnHost=true 유지 */
  sdkSharedRuntime: boolean;
  /** 13 §10 — docker 네트워크 외부 이그레스 차단 (--internal) */
  sandboxNetworkInternal: boolean;
  /** ADR-007 POC 3 — SDK in-container (컨테이ner에 @cursor/sdk 필요) */
  sdkInContainer: boolean;
  /** P7 — MCP Streamable HTTP (/api/v1/mcp) */
  mcpEnabled: boolean;
  /** UR-16 — LLM 세션 요약 opt-in (process.env.SESSION_SUMMARY_LLM === "true") */
  sessionSummaryLlm: boolean;
  /** UR-15 — 외부 STT API URL (multipart forward) */
  sttApiUrl?: string;
  sttApiKey?: string;
}

/** 16 / R-01 — sandbox 모드 (production + Docker → docker 기본) */
export function resolveSandboxMode(
  env: NodeJS.ProcessEnv = process.env,
  dockerAvailable: boolean = isDockerAvailable(),
): "subprocess" | "docker" {
  if (env.SANDBOX_MODE === "docker") return "docker";
  if (env.SANDBOX_MODE === "subprocess") return "subprocess";
  if (env.NODE_ENV === "production" && dockerAvailable) return "docker";
  return "subprocess";
}

export function validateSandboxModeEnv(
  env: NodeJS.ProcessEnv = process.env,
): void {
  const raw = env.SANDBOX_MODE?.trim();
  if (raw && raw !== "docker" && raw !== "subprocess") {
    throw new Error(
      `Invalid SANDBOX_MODE="${raw}". Must be "docker" or "subprocess".`,
    );
  }
}

/** ops/r01-mitigation-mode — production subprocess 금지 (escape: ALLOW_SUBPROCESS_IN_PRODUCTION) */
export function assertProductionSandboxPolicy(
  sandboxMode: "subprocess" | "docker",
  env: NodeJS.ProcessEnv = process.env,
  dockerAvailable: boolean = isDockerAvailable(),
): void {
  assertSharedRuntimeEnvPolicy(env);

  if (env.NODE_ENV !== "production") return;
  if (env.ALLOW_SUBPROCESS_IN_PRODUCTION === "true") return;

  if (sandboxMode === "docker" && !dockerAvailable) {
    throw new Error(
      "[sandbox] production requires SANDBOX_MODE=docker but Docker is not available. " +
        "Install Docker or see devplan/ops/r01-mitigation-mode.md",
    );
  }

  if (sandboxMode !== "subprocess") return;

  const explicitSubprocess = env.SANDBOX_MODE === "subprocess";
  if (!dockerAvailable && !explicitSubprocess) {
    throw new Error(
      "[sandbox] R-01: production requires Docker for sandbox isolation (auto SANDBOX_MODE=docker). " +
        "Docker is not available. Install Docker or set ALLOW_SUBPROCESS_IN_PRODUCTION=true (not recommended). " +
        "See devplan/ops/r01-mitigation-mode.md",
    );
  }

  throw new Error(
    "[sandbox] R-01: subprocess mode is not allowed in production. " +
      "Set SANDBOX_MODE=docker (Docker required) or see devplan/ops/r01-mitigation-mode.md",
  );
}

/** ADR-007 POC 3 — in-container SDK needs Cursor API egress */
export function assertSharedRuntimeEnvPolicy(
  env: NodeJS.ProcessEnv = process.env,
): void {
  const sdkInContainer = env.SDK_IN_CONTAINER === "true";
  const networkInternal = env.SANDBOX_NETWORK_INTERNAL === "true";
  if (sdkInContainer && networkInternal) {
    throw new Error(
      "[sandbox] SDK_IN_CONTAINER requires outbound access to Cursor API and is incompatible with SANDBOX_NETWORK_INTERNAL=true. " +
        "See devplan/ops/r01-mitigation-mode.md §6 and components/16-infra-deployment.md §12.1",
    );
  }
  if (sdkInContainer && env.SANDBOX_MODE === "subprocess") {
    throw new Error(
      "[sandbox] SDK_IN_CONTAINER requires SANDBOX_MODE=docker",
    );
  }
}

/** P7 MCP — production은 opt-in (`MCP_ENABLED=true`), dev/test는 기본 ON */
export function resolveMcpEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.MCP_ENABLED?.trim();
  if (raw === "true") return true;
  if (raw === "false") return false;
  return env.NODE_ENV !== "production";
}

/** 10 §6.3 — Telegram push/pull 상호 배타 (운영 혼선 방지) */
export function assertTelegramConnectionModePolicy(
  env: NodeJS.ProcessEnv = process.env,
): void {
  const pull = env.TELEGRAM_PULL_MODE === "true";
  if (!pull) return;

  if (env.TELEGRAM_WEBHOOK_SECRET?.trim()) {
    console.warn(
      "[telegram] TELEGRAM_PULL_MODE=true: inbound push webhook is disabled; " +
        "TELEGRAM_WEBHOOK_SECRET is ignored. See devplan/ops/telegram-pull-mode.md",
    );
  }
}

export function loadConfig(): ServerConfig {
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? "0.0.0.0";
  const cursorApiKey = process.env.CURSOR_API_KEY ?? "";
  const devApiKey = process.env.DEV_API_KEY ?? "dev-local-key";
  const workspaceRoot = path.resolve(
    process.env.WORKSPACE_ROOT ??
      path.join(__dirname, "..", "..", "workspaces"),
  );
  const defaultModel = process.env.DEFAULT_MODEL ?? DEFAULT_MODEL;
  const databaseUrl = process.env.DATABASE_URL ?? "file:./dev.db";
  const maxConcurrentRuns = Number(process.env.MAX_CONCURRENT_RUNS ?? 3);
  const perProjectMaxRuns = Number(process.env.PER_PROJECT_MAX_RUNS ?? 1);
  const agentCacheMax = Number(process.env.AGENT_CACHE_MAX ?? 10);
  const queueLimit = Number(process.env.QUEUE_LIMIT ?? 100);
  const customWebhookUrl = process.env.CUSTOM_WEBHOOK_URL;
  const notificationGroupWindowMs = Number(
    process.env.NOTIFICATION_GROUP_WINDOW_MS ?? 60_000,
  );
  const usageDailyLimit = Number(process.env.USAGE_DAILY_LIMIT ?? 500);
  const usageWarningRatio = Number(process.env.USAGE_WARNING_RATIO ?? 0.8);
  const quietHoursStart = process.env.QUIET_HOURS_START
    ? Number(process.env.QUIET_HOURS_START)
    : undefined;
  const quietHoursEnd = process.env.QUIET_HOURS_END
    ? Number(process.env.QUIET_HOURS_END)
    : undefined;
  const gitUserName = process.env.GIT_USER_NAME ?? "Cursor Remote";
  const gitUserEmail = process.env.GIT_USER_EMAIL ?? "cursor-remote@local";
  const autoSnapshot = process.env.AUTO_SNAPSHOT !== "false";
  const githubToken = process.env.GITHUB_TOKEN;
  const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
  const vapidSubject = process.env.VAPID_SUBJECT ?? "mailto:cursor-remote@local";
  const perUserMaxRuns = Number(process.env.PER_USER_MAX_RUNS ?? 999);
  const maxRetryAttempts = Number(process.env.MAX_RETRY_ATTEMPTS ?? 3);
  const retryBackoffMs = Number(process.env.RETRY_BACKOFF_MS ?? 1000);
  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
  const telegramWebhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const telegramPullMode = process.env.TELEGRAM_PULL_MODE === "true";
  const telegramPollIntervalMs = Number(
    process.env.TELEGRAM_POLL_INTERVAL_MS ?? 1000,
  );
  const telegramLongPollTimeoutSec = Number(
    process.env.TELEGRAM_LONG_POLL_TIMEOUT_SEC ?? 25,
  );
  const telegramPollMaxBackoffMs = Number(
    process.env.TELEGRAM_POLL_MAX_BACKOFF_MS ?? 60_000,
  );
  const intranetMessengerPollUrl = process.env.INTRANET_MESSENGER_POLL_URL?.trim() ||
    undefined;
  const intranetMessengerPollIntervalMs = Number(
    process.env.INTRANET_MESSENGER_POLL_INTERVAL_MS ?? 3000,
  );
  const intranetMessengerPollMaxBackoffMs = Number(
    process.env.INTRANET_MESSENGER_POLL_MAX_BACKOFF_MS ?? 60_000,
  );
  const intranetMessengerAuthHeader =
    process.env.INTRANET_MESSENGER_AUTH_HEADER?.trim() || undefined;
  const intranetMessengerNotifyUrl =
    process.env.INTRANET_MESSENGER_NOTIFY_URL?.trim() || undefined;
  const gitRemoteWhitelist = (process.env.GIT_REMOTE_WHITELIST ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const webhookSecret = process.env.WEBHOOK_SECRET;
  const jwtSecret = process.env.JWT_SECRET;
  const jwtAccessTtlSec = Number(process.env.JWT_ACCESS_TTL_SEC ?? 3600);
  const jwtRefreshTtlSec = Number(process.env.JWT_REFRESH_TTL_SEC ?? 604_800);
  const rateLimitMax = Number(process.env.RATE_LIMIT_MAX ?? 120);
  const rateLimitWindowMs = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000);
  const authRateLimitMax = Number(process.env.AUTH_RATE_LIMIT_MAX ?? 10);
  const authRateLimitWindowMs = Number(
    process.env.AUTH_RATE_LIMIT_WINDOW_MS ?? 60_000,
  );
  const runEventRetentionDays = Number(
    process.env.RUN_EVENT_RETENTION_DAYS ?? 30,
  );
  validateSandboxModeEnv();
  const sandboxMode = resolveSandboxMode();
  assertSharedRuntimeEnvPolicy();
  assertTelegramConnectionModePolicy();
  assertProductionSandboxPolicy(sandboxMode);
  const execTimeoutMs = Number(process.env.EXEC_TIMEOUT_MS ?? 300_000);
  const maxConcurrentExec = Number(process.env.MAX_CONCURRENT_EXEC ?? 3);
  const perProjectMaxExec = Number(process.env.PER_PROJECT_MAX_EXEC ?? 2);
  const sandboxDockerImage =
    process.env.SANDBOX_DOCKER_IMAGE ?? "node:22-alpine";
  const sandboxIdleMs = Number(process.env.SANDBOX_IDLE_MS ?? 600_000);
  const previewTokenTtlSec = Number(process.env.PREVIEW_TOKEN_TTL_SEC ?? 3600);
  const previewPortMin = Number(process.env.PREVIEW_PORT_MIN ?? 3000);
  const previewPortMax = Number(process.env.PREVIEW_PORT_MAX ?? 9999);
  const sandboxMemoryMb = Number(process.env.SANDBOX_MEMORY_MB ?? 512);
  const sandboxCpus = Number(process.env.SANDBOX_CPUS ?? 1);
  const sdkSharedRuntime = process.env.SDK_SHARED_RUNTIME === "true";
  const sandboxNetworkInternal =
    process.env.SANDBOX_NETWORK_INTERNAL === "true";
  const sdkInContainer = process.env.SDK_IN_CONTAINER === "true";
  const mcpEnabled = resolveMcpEnabled(process.env);
  const sessionSummaryLlm = process.env.SESSION_SUMMARY_LLM === "true";
  const sttApiUrl = process.env.STT_API_URL?.trim() || undefined;
  const sttApiKey = process.env.STT_API_KEY?.trim() || undefined;

  return {
    port,
    host,
    cursorApiKey,
    devApiKey,
    workspaceRoot,
    defaultModel,
    databaseUrl,
    maxConcurrentRuns,
    perProjectMaxRuns,
    agentCacheMax,
    queueLimit,
    customWebhookUrl,
    notificationGroupWindowMs,
    usageDailyLimit,
    usageWarningRatio,
    quietHoursStart,
    quietHoursEnd,
    gitUserName,
    gitUserEmail,
    autoSnapshot,
    githubToken,
    vapidPublicKey,
    vapidPrivateKey,
    vapidSubject,
    perUserMaxRuns,
    maxRetryAttempts,
    retryBackoffMs,
    telegramBotToken,
    telegramWebhookSecret,
    telegramPullMode,
    telegramPollIntervalMs,
    telegramLongPollTimeoutSec,
    telegramPollMaxBackoffMs,
    intranetMessengerPollUrl,
    intranetMessengerPollIntervalMs,
    intranetMessengerPollMaxBackoffMs,
    intranetMessengerAuthHeader,
    intranetMessengerNotifyUrl,
    gitRemoteWhitelist,
    webhookSecret,
    jwtSecret,
    jwtAccessTtlSec,
    jwtRefreshTtlSec,
    rateLimitMax,
    rateLimitWindowMs,
    authRateLimitMax,
    authRateLimitWindowMs,
    runEventRetentionDays,
    sandboxMode,
    execTimeoutMs,
    maxConcurrentExec,
    perProjectMaxExec,
    sandboxDockerImage,
    sandboxIdleMs,
    previewTokenTtlSec,
    previewPortMin,
    previewPortMax,
    sandboxMemoryMb,
    sandboxCpus,
    sdkSharedRuntime,
    sandboxNetworkInternal,
    sdkInContainer,
    mcpEnabled,
    sessionSummaryLlm,
    sttApiUrl,
    sttApiKey,
  };
}
