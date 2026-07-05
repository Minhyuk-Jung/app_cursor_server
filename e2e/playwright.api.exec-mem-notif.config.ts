import { defineConfig } from "@playwright/test";

const API_PORT = process.env.E2E_PORT ?? "3095";

/** 13 §9 exec_memory_limit 인박스 E2E — docker + 낮은 메모리 상한 */
export default defineConfig({
  testDir: ".",
  timeout: 240_000,
  use: {
    baseURL: process.env.E2E_API_URL ?? `http://127.0.0.1:${API_PORT}`,
  },
  webServer: {
    command: "npm run e2e:server -w @app/server",
    url: `http://127.0.0.1:${API_PORT}/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      E2E_PORT: API_PORT,
      E2E_SANDBOX_MODE: "docker",
      SANDBOX_MEMORY_MB: "64",
      DATABASE_URL: "file:./e2e-exec-mem-notif-api.db",
      WORKSPACE_ROOT: "./e2e-exec-mem-notif-workspaces",
    },
  },
});
