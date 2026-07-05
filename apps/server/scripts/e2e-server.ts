import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../src/app.js";

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.E2E_PORT ?? 3099);

process.env.DATABASE_URL = process.env.DATABASE_URL ?? "file:./e2e.db";
process.env.WORKSPACE_ROOT = process.env.WORKSPACE_ROOT ?? "./e2e-workspaces";
process.env.JWT_SECRET = process.env.JWT_SECRET ?? "e2e-jwt-secret";
process.env.TELEGRAM_WEBHOOK_SECRET =
  process.env.TELEGRAM_WEBHOOK_SECRET ?? "e2e-tg-secret";
process.env.E2E_INBOX_SEED = process.env.E2E_INBOX_SEED ?? "true";

const dbFile = process.env.DATABASE_URL.startsWith("file:")
  ? path.resolve(serverRoot, process.env.DATABASE_URL.slice("file:".length))
  : null;
const needsDbPush =
  process.env.CI === "1" || (dbFile !== null && !existsSync(dbFile));
if (needsDbPush) {
  execSync("npx prisma db push --skip-generate", {
    cwd: serverRoot,
    env: process.env,
    stdio: "inherit",
  });
}

await mkdir(process.env.WORKSPACE_ROOT, { recursive: true });

const sandboxMode =
  process.env.E2E_SANDBOX_MODE === "docker" ? "docker" : "subprocess";

const execTimeoutMs = process.env.E2E_EXEC_TIMEOUT_MS
  ? Number(process.env.E2E_EXEC_TIMEOUT_MS)
  : undefined;

const sdkInContainer = process.env.SDK_IN_CONTAINER === "true";
const sandboxDockerImage = process.env.SANDBOX_DOCKER_IMAGE;
const cursorApiKey = process.env.CURSOR_API_KEY ?? "";

const ctx = await createApp({
  port,
  sandboxMode,
  ...(execTimeoutMs !== undefined && !Number.isNaN(execTimeoutMs)
    ? { execTimeoutMs }
    : {}),
  ...(sdkInContainer ? { sdkInContainer: true } : {}),
  ...(sandboxDockerImage ? { sandboxDockerImage } : {}),
  ...(cursorApiKey ? { cursorApiKey } : {}),
});
await ctx.app.listen({ port, host: "127.0.0.1" });
console.log(
  `E2E server listening on ${port} (sandbox=${sandboxMode}${execTimeoutMs ? `, execTimeoutMs=${execTimeoutMs}` : ""}${sdkInContainer ? ", sdkInContainer" : ""})`,
);
