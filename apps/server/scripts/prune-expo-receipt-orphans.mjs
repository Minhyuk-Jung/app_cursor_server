#!/usr/bin/env node
/**
 * P7 mobile 16차 — FK 추가 전 orphan ExpoReceiptPending 일괄 삭제
 * Usage: npm run db:prune-receipt-orphans -w @app/server
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const pending = await prisma.expoReceiptPending.findMany({
    select: { id: true, tokenRowId: true },
  });
  if (pending.length === 0) {
    console.log("No ExpoReceiptPending rows — nothing to prune");
    return;
  }
  const tokens = await prisma.expoPushToken.findMany({ select: { id: true } });
  const valid = new Set(tokens.map((row) => row.id));
  const orphanIds = pending
    .filter((row) => !valid.has(row.tokenRowId))
    .map((row) => row.id);
  if (orphanIds.length === 0) {
    console.log("No orphan ExpoReceiptPending rows");
    return;
  }
  const result = await prisma.expoReceiptPending.deleteMany({
    where: { id: { in: orphanIds } },
  });
  console.log(`Pruned ${result.count} orphan ExpoReceiptPending row(s)`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
