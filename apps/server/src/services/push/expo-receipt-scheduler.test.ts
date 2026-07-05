import { describe, expect, it } from "vitest";
import { partitionExpoReceipts } from "./expo-receipt-scheduler.js";

describe("partitionExpoReceipts", () => {
  it("prunes DeviceNotRegistered and keeps missing receipts for retry", () => {
    const pairs = [
      { tokenRowId: "row-1", ticketId: "t1" },
      { tokenRowId: "row-2", ticketId: "t2" },
      { tokenRowId: "row-3", ticketId: "t3" },
    ];
    const { pruneIds, pending } = partitionExpoReceipts(pairs, {
      t1: { status: "ok" },
      t2: {
        status: "error",
        details: { error: "DeviceNotRegistered" },
      },
    });
    expect(pruneIds).toEqual(["row-2"]);
    expect(pending).toEqual([{ tokenRowId: "row-3", ticketId: "t3" }]);
  });
});
