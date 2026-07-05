import { defineConfig } from "@playwright/test";

const API_PORT = process.env.E2E_PORT ?? "3096";
const WEB_PORT = process.env.E2E_WEB_PORT ?? "5198";

/** exec_timeout 인박스 → 터미널 deeplink UI E2E (09→15) */
export default defineConfig({
  testDir: ".",
  timeout: 90_000,
  use: {
    baseURL: process.env.E2E_WEB_URL ?? `http://127.0.0.1:${WEB_PORT}`,
  },
  webServer: [
    {
      command: "npm run e2e:server -w @app/server",
      url: `http://127.0.0.1:${API_PORT}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        E2E_PORT: API_PORT,
        E2E_EXEC_TIMEOUT_MS: "800",
        DATABASE_URL: "file:./e2e-exec-notif-ui.db",
        WORKSPACE_ROOT: "./e2e-exec-notif-ui-workspaces",
      },
    },
    {
      command: "npm run dev:e2e -w @app/web -- --port 5198",
      url: `http://127.0.0.1:${WEB_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        E2E_API_URL: `http://127.0.0.1:${API_PORT}`,
      },
    },
  ],
});
