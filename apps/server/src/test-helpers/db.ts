import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prisma, switchDatabaseUrl } from "../db/client.js";

const SERVER_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/** 테스트 DB 스키마 동기화 (attachmentsJson 등 schema 변경 후) */
export function ensureTestDbSchema(): void {
  execSync("npx prisma db push --skip-generate", {
    cwd: SERVER_ROOT,
    env: process.env,
    stdio: "pipe",
  });
}

/** Vitest 병렬 실행 시 Prisma singleton DB 전환 */
export async function useTestDatabase(databaseUrl: string): Promise<void> {
  await switchDatabaseUrl(databaseUrl);
  ensureTestDbSchema();
}

export async function truncateIntegrationTables(): Promise<void> {
  await prisma.runEvent.deleteMany();
  await prisma.message.deleteMany();
  await prisma.run.deleteMany();
  await prisma.idempotencyRecord.deleteMany();
  await prisma.notification.deleteMany();
}
