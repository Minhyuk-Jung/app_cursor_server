import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const CURSOR_FILE = "intranet-poll-cursor.json";

interface CursorState {
  cursor: string;
  updatedAt: string;
}

function cursorPath(dataDir: string): string {
  return path.join(dataDir, CURSOR_FILE);
}

export async function readIntranetCursor(dataDir: string): Promise<string> {
  try {
    const raw = await readFile(cursorPath(dataDir), "utf8");
    const parsed = JSON.parse(raw) as CursorState;
    if (typeof parsed.cursor === "string") return parsed.cursor;
  } catch {
    // empty cursor
  }
  return "";
}

export async function writeIntranetCursor(
  dataDir: string,
  cursor: string,
): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  const state: CursorState = {
    cursor,
    updatedAt: new Date().toISOString(),
  };
  const target = cursorPath(dataDir);
  const tmp = `${target}.tmp.${process.pid}`;
  await writeFile(tmp, JSON.stringify(state, null, 2), "utf8");
  await rename(tmp, target);
}
