import { defineConfig } from "@playwright/test";

const API_PORT = process.env.E2E_PORT ?? "3099";
const WEB_PORT = process.env.E2E_WEB_PORT ?? "5199";

/** UI E2E — API + web dev server (S17 TerminalPanel, 15+13) */
export default defineConfig({
  testDir: ".",
  timeout: 60_000,
  use: {
    baseURL: process.env.E2E_WEB_URL ?? `http://127.0.0.1:${WEB_PORT}`,
  },
  webServer: [
    {
      command: "npm run e2e:server -w @app/server",
      url: `http://127.0.0.1:${API_PORT}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: { E2E_PORT: API_PORT },
    },
    {
      command: "npm run dev:e2e -w @app/web",
      url: `http://127.0.0.1:${WEB_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
