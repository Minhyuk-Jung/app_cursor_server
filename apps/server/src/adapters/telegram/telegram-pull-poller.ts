import type { ServerConfig } from "../../config.js";
import type { CommandHandler } from "../../core/command/command-handler.js";
import {
  deleteTelegramWebhook,
  fetchTelegramUpdates,
  TelegramApiError,
} from "./telegram-adapter.js";
import { handleTelegramUpdate } from "./telegram-inbound-handler.js";
import {
  offsetAfterUpdate,
  readTelegramOffset,
  writeTelegramOffset,
} from "./telegram-offset-store.js";

export interface TelegramPullPollerOptions {
  config: Pick<
    ServerConfig,
    | "telegramBotToken"
    | "telegramPullMode"
    | "telegramPollIntervalMs"
    | "telegramLongPollTimeoutSec"
    | "telegramPollMaxBackoffMs"
    | "workspaceRoot"
  >;
  commandHandler: CommandHandler;
  fetchImpl?: typeof fetch;
  dataDir?: string;
}

export interface TelegramPullPollerHandle {
  stop: () => Promise<void>;
  getMetrics: () => {
    running: boolean;
    lastPollAt: string | null;
    lastError: string | null;
    offset: number;
    polls: number;
    updatesProcessed: number;
    consecutiveErrors: number;
  };
}

async function processUpdatesOneByOne(
  updates: Awaited<ReturnType<typeof fetchTelegramUpdates>>,
  options: {
    commandHandler: CommandHandler;
    config: TelegramPullPollerOptions["config"];
    dataDir: string;
    offset: number;
    onProcessed: () => void;
  },
): Promise<number> {
  let currentOffset = options.offset;

  for (const update of updates) {
    if (typeof update.update_id !== "number") continue;

    await handleTelegramUpdate(update, {
      commandHandler: options.commandHandler,
      config: options.config,
    });

    currentOffset = offsetAfterUpdate(update.update_id);
    await writeTelegramOffset(options.dataDir, currentOffset);
    options.onProcessed();
  }

  return currentOffset;
}

export function startTelegramPullPoller(
  options: TelegramPullPollerOptions,
): TelegramPullPollerHandle | null {
  const { config, commandHandler } = options;
  if (!config.telegramPullMode || !config.telegramBotToken) {
    return null;
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const dataDir =
    options.dataDir ?? `${config.workspaceRoot}/.server-state`;
  let stopped = false;
  let offset = 0;
  let polls = 0;
  let updatesProcessed = 0;
  let consecutiveErrors = 0;
  let lastPollAt: string | null = null;
  let lastError: string | null = null;
  const abortController = new AbortController();

  const metrics = () => ({
    running: !stopped,
    lastPollAt,
    lastError,
    offset,
    polls,
    updatesProcessed,
    consecutiveErrors,
  });

  const pollOnce = async (): Promise<void> => {
    if (stopped) return;
    lastPollAt = new Date().toISOString();
    polls += 1;

    const updates = await fetchTelegramUpdates(
      config.telegramBotToken!,
      offset,
      config.telegramLongPollTimeoutSec,
      fetchImpl,
      abortController.signal,
    );

    offset = await processUpdatesOneByOne(updates, {
      commandHandler,
      config,
      dataDir,
      offset,
      onProcessed: () => {
        updatesProcessed += 1;
      },
    });

    lastError = null;
    consecutiveErrors = 0;
  };

  const loop = async (): Promise<void> => {
    try {
      await deleteTelegramWebhook(
        config.telegramBotToken!,
        fetchImpl,
        abortController.signal,
      );
    } catch (err) {
      if (stopped || abortController.signal.aborted) return;
      lastError =
        err instanceof Error ? err.message : "deleteWebhook failed";
      console.error("[telegram-pull] deleteWebhook:", lastError);
    }

    offset = await readTelegramOffset(dataDir);

    while (!stopped) {
      try {
        await pollOnce();
      } catch (err) {
        if (stopped || abortController.signal.aborted) return;
        consecutiveErrors += 1;
        lastError = err instanceof Error ? err.message : "poll failed";
        console.error("[telegram-pull] poll error:", lastError);
        const delay = pollBackoffMs(
          err,
          consecutiveErrors,
          config.telegramPollIntervalMs,
          config.telegramPollMaxBackoffMs,
        );
        await sleep(delay);
      }
    }
  };

  const loopPromise = loop();

  return {
    stop: async () => {
      if (stopped) return;
      stopped = true;
      abortController.abort();
      await loopPromise.catch(() => undefined);
    },
    getMetrics: metrics,
  };
}

function pollBackoffMs(
  err: unknown,
  consecutiveErrors: number,
  baseMs: number,
  maxMs: number,
): number {
  if (err instanceof TelegramApiError && err.retryAfterSec) {
    return err.retryAfterSec * 1000;
  }
  return Math.min(baseMs * 2 ** Math.min(consecutiveErrors, 6), maxMs);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 단일 tick — 테스트·E2E용 */
export async function runTelegramPullTick(
  options: TelegramPullPollerOptions & { offset: number },
): Promise<{ offset: number; processed: number }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const token = options.config.telegramBotToken;
  if (!token) {
    throw new Error("telegramBotToken required");
  }
  const dataDir =
    options.dataDir ?? `${options.config.workspaceRoot}/.server-state`;

  const updates = await fetchTelegramUpdates(
    token,
    options.offset,
    options.config.telegramLongPollTimeoutSec,
    fetchImpl,
  );

  let processed = 0;
  const offset = await processUpdatesOneByOne(updates, {
    commandHandler: options.commandHandler,
    config: options.config,
    dataDir,
    offset: options.offset,
    onProcessed: () => {
      processed += 1;
    },
  });

  return { offset, processed };
}
