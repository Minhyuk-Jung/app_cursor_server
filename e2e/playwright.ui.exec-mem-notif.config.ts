import { defineConfig } from "@playwright/test";

const API_PORT = process.env.E2E_PORT ?? "3097";
const WEB_PORT = process.env.E2E_WEB_PORT ?? "5199";

/** exec_memory_limit 인박스 → 터미널 deeplink UI E2E (docker + 64MB) */
export default defineConfig({
  testDir: ".",
  timeout: 240_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: process.env.E2E_WEB_URL ?? `http://127.0.0.1:${WEB_PORT}`,
  },
  webServer: [
    {
      command: "npm run e2e:server -w @app/server",
      url: `http://127.0.0.1:${API_PORT}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: {
        E2E_PORT: API_PORT,
        E2E_SANDBOX_MODE: "docker",
        SANDBOX_MEMORY_MB: "64",
        DATABASE_URL: "file:./e2e-exec-mem-notif-ui.db",
        WORKSPACE_ROOT: "./e2e-exec-mem-notif-ui-workspaces",
      },
    },
    {
      command: "npm run dev:e2e -w @app/web -- --port 5199",
      url: `http://127.0.0.1:${WEB_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        E2E_API_URL: `http://127.0.0.1:${API_PORT}`,
      },
    },
  ],
});
