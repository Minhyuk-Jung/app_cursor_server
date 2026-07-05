import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const OFFSET_FILE = "telegram-poll-offset.json";

export interface TelegramOffsetState {
  offset: number;
  updatedAt: string;
}

export function telegramOffsetPath(dataDir: string): string {
  return path.join(dataDir, OFFSET_FILE);
}

export async function readTelegramOffset(dataDir: string): Promise<number> {
  try {
    const raw = await readFile(telegramOffsetPath(dataDir), "utf8");
    const parsed = JSON.parse(raw) as TelegramOffsetState;
    if (typeof parsed.offset === "number" && parsed.offset >= 0) {
      return parsed.offset;
    }
  } catch {
    // missing or corrupt — start from 0
  }
  return 0;
}

/** 원자적 offset 저장 (16 §9 백업·복구 정합) */
export async function writeTelegramOffset(
  dataDir: string,
  offset: number,
): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  const state: TelegramOffsetState = {
    offset,
    updatedAt: new Date().toISOString(),
  };
  const target = telegramOffsetPath(dataDir);
  const tmp = `${target}.tmp.${process.pid}`;
  await writeFile(tmp, JSON.stringify(state, null, 2), "utf8");
  await rename(tmp, target);
}

export function offsetAfterUpdate(updateId: number): number {
  return updateId + 1;
}
