import { defineConfig } from "@playwright/test";

const API_PORT = process.env.E2E_PORT ?? "3098";

/** S17 API E2E — docker sandbox (P6 gate, 21-test-strategy) */
export default defineConfig({
  testDir: ".",
  timeout: 120_000,
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
    },
  },
});
