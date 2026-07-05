import type { ServerConfig } from "../../config.js";
import type { CommandHandler } from "../../core/command/command-handler.js";
import {
  readIntranetCursor,
  writeIntranetCursor,
} from "./intranet-cursor-store.js";
import { handleIntranetMessage } from "./intranet-inbound-handler.js";
import { fetchIntranetMessages } from "./intranet-messenger-adapter.js";

export interface IntranetPullPollerOptions {
  config: Pick<
    ServerConfig,
    | "intranetMessengerPollUrl"
    | "intranetMessengerPollIntervalMs"
    | "intranetMessengerPollMaxBackoffMs"
    | "intranetMessengerAuthHeader"
    | "workspaceRoot"
  >;
  commandHandler: CommandHandler;
  fetchImpl?: typeof fetch;
  dataDir?: string;
  notify?: (chatId: string, text: string) => Promise<void>;
}

export interface IntranetPullPollerHandle {
  stop: () => Promise<void>;
  getMetrics: () => {
    running: boolean;
    lastPollAt: string | null;
    lastError: string | null;
    cursor: string;
    polls: number;
    messagesProcessed: number;
    consecutiveErrors: number;
  };
}

export function startIntranetPullPoller(
  options: IntranetPullPollerOptions,
): IntranetPullPollerHandle | null {
  const { config, commandHandler } = options;
  if (!config.intranetMessengerPollUrl) return null;

  const fetchImpl = options.fetchImpl ?? fetch;
  const dataDir =
    options.dataDir ?? `${config.workspaceRoot}/.server-state`;
  let stopped = false;
  let cursor = "";
  let polls = 0;
  let messagesProcessed = 0;
  let consecutiveErrors = 0;
  let lastPollAt: string | null = null;
  let lastError: string | null = null;
  const abortController = new AbortController();

  const metrics = () => ({
    running: !stopped,
    lastPollAt,
    lastError,
    cursor,
    polls,
    messagesProcessed,
    consecutiveErrors,
  });

  const pollOnce = async (): Promise<void> => {
    if (stopped) return;
    lastPollAt = new Date().toISOString();
    polls += 1;

    const batch = await fetchIntranetMessages(
      config.intranetMessengerPollUrl!,
      cursor,
      config.intranetMessengerAuthHeader,
      fetchImpl,
      abortController.signal,
    );

    for (const message of batch.messages) {
      await handleIntranetMessage(message, {
        commandHandler,
        notify: options.notify,
      });
      messagesProcessed += 1;
    }

    if (batch.cursor && batch.cursor !== cursor) {
      cursor = batch.cursor;
      await writeIntranetCursor(dataDir, cursor);
    } else if (batch.messages.length > 0) {
      const lastId = batch.messages[batch.messages.length - 1]?.id;
      if (lastId) {
        cursor = lastId;
        await writeIntranetCursor(dataDir, cursor);
      }
    }

    lastError = null;
    consecutiveErrors = 0;
  };

  const loop = async (): Promise<void> => {
    cursor = await readIntranetCursor(dataDir);

    while (!stopped) {
      try {
        await pollOnce();
        await sleep(config.intranetMessengerPollIntervalMs);
      } catch (err) {
        if (stopped || abortController.signal.aborted) return;
        consecutiveErrors += 1;
        lastError = err instanceof Error ? err.message : "poll failed";
        console.error("[intranet-pull] poll error:", lastError);
        const delay = Math.min(
          config.intranetMessengerPollIntervalMs *
            2 ** Math.min(consecutiveErrors, 6),
          config.intranetMessengerPollMaxBackoffMs,
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 단일 tick — 테스트·E2E용 */
export async function runIntranetPullTick(
  options: IntranetPullPollerOptions & { cursor: string },
): Promise<{ cursor: string; processed: number }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  let cursor = options.cursor;
  let processed = 0;

  const batch = await fetchIntranetMessages(
    options.config.intranetMessengerPollUrl!,
    cursor,
    options.config.intranetMessengerAuthHeader,
    fetchImpl,
  );

  for (const message of batch.messages) {
    await handleIntranetMessage(message, {
      commandHandler: options.commandHandler,
      notify: options.notify,
    });
    processed += 1;
  }

  if (batch.cursor && batch.cursor !== cursor) {
    cursor = batch.cursor;
  } else if (batch.messages.length > 0) {
    const lastId = batch.messages[batch.messages.length - 1]?.id;
    if (lastId) cursor = lastId;
  }

  return { cursor, processed };
}
