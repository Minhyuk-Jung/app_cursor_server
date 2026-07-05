import { defineConfig } from "@playwright/test";

const API_PORT = process.env.E2E_PORT ?? "3102";
const WEB_PORT = process.env.E2E_WEB_PORT ?? "5202";
const API_URL = process.env.E2E_API_URL ?? `http://127.0.0.1:${API_PORT}`;

process.env.E2E_API_URL = API_URL;
process.env.E2E_WEB_URL =
  process.env.E2E_WEB_URL ?? `http://127.0.0.1:${WEB_PORT}`;

/** P7 mobile 21차 — S30 web Markdown preview UI E2E */
export default defineConfig({
  testDir: ".",
  testMatch: "p7-s30-markdown-preview-ui.spec.ts",
  timeout: 60_000,
  use: {
    baseURL: process.env.E2E_WEB_URL,
  },
  webServer: [
    {
      command: "npm run e2e:server -w @app/server",
      url: `${API_URL}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        E2E_PORT: API_PORT,
        DATABASE_URL: "file:./e2e-s30.db",
        WORKSPACE_ROOT: "./e2e-s30-workspaces",
      },
    },
    {
      command: `npm run dev:e2e -w @app/web -- --port ${WEB_PORT}`,
      url: `http://127.0.0.1:${WEB_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        E2E_API_URL: API_URL,
      },
    },
  ],
});
