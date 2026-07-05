import { describe, expect, it } from "vitest";
import {
  offsetAfterUpdate,
  readTelegramOffset,
  writeTelegramOffset,
} from "./telegram-offset-store.js";
import { telegramUpdateRequestId } from "./telegram-inbound-handler.js";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

describe("telegram pull reliability (P7)", () => {
  it("telegramUpdateRequestId is stable UUID v5 per update_id", () => {
    const id = telegramUpdateRequestId({
      update_id: 99,
      message: { text: "x", chat: { id: 1 } },
    });
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(
      telegramUpdateRequestId({
        update_id: 99,
        message: { text: "y", chat: { id: 2 } },
      }),
    ).toBe(id);
  });

  it("offsetAfterUpdate is update_id + 1", () => {
    expect(offsetAfterUpdate(41)).toBe(42);
  });

  it("atomic offset write persists", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "tg-offset-"));
    try {
      await writeTelegramOffset(dir, 7);
      const raw = await readFile(path.join(dir, "telegram-poll-offset.json"), "utf8");
      expect(JSON.parse(raw).offset).toBe(7);
      expect(await readTelegramOffset(dir)).toBe(7);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
