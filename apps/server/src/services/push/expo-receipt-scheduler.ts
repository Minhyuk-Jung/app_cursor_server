/** Expo recommends checking receipts after delivery; prune stale tokens. */
export const EXPO_RECEIPT_DELAYS_MS = [30_000, 120_000, 300_000] as const;
export const EXPO_RECEIPT_MAX_ATTEMPTS = EXPO_RECEIPT_DELAYS_MS.length;

export type ExpoReceiptPair = { tokenRowId: string; ticketId: string };

/** Receipt 처리 결과 — 재시도 대상 ticket 목록 */
export function partitionExpoReceipts(
  pairs: ExpoReceiptPair[],
  receipts: Record<
    string,
    { status: string; details?: { error?: string } } | undefined
  >,
): { pruneIds: string[]; pending: ExpoReceiptPair[] } {
  const pruneIds: string[] = [];
  const pending: ExpoReceiptPair[] = [];

  for (const pair of pairs) {
    const receipt = receipts[pair.ticketId];
    if (!receipt) {
      pending.push(pair);
      continue;
    }
    if (
      receipt.status === "error" &&
      receipt.details?.error === "DeviceNotRegistered"
    ) {
      pruneIds.push(pair.tokenRowId);
    }
  }

  return { pruneIds, pending };
}
