import { defineConfig } from "@playwright/test";

const API_PORT = process.env.E2E_PORT ?? "3099";

/** API-only E2E — web dev server 기동 없음 (21-test-strategy P6 API smoke) */
export default defineConfig({
  testDir: ".",
  timeout: 60_000,
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
    },
  },
});
