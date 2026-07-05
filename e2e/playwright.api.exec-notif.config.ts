import { defineConfig } from "@playwright/test";

const API_PORT = process.env.E2E_PORT ?? "3097";

/** 13 §9 exec_timeout 인박스 E2E — 짧은 exec 상한 (21-test-strategy) */
export default defineConfig({
  testDir: ".",
  timeout: 90_000,
  use: {
    baseURL: process.env.E2E_API_URL ?? `http://127.0.0.1:${API_PORT}`,
  },
  webServer: {
    command: "npm run e2e:server -w @app/server",
    url: `http://127.0.0.1:${API_PORT}/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      E2E_PORT: API_PORT,
      E2E_EXEC_TIMEOUT_MS: "800",
      DATABASE_URL: "file:./e2e-exec-notif-api.db",
      WORKSPACE_ROOT: "./e2e-exec-notif-api-workspaces",
    },
  },
});
