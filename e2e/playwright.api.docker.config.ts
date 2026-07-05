import { defineConfig } from "@playwright/test";

const API_PORT = process.env.E2E_PORT ?? "3098";
const API_URL = process.env.E2E_API_URL ?? `http://127.0.0.1:${API_PORT}`;
process.env.E2E_API_URL = API_URL;

/** S17 API E2E — docker sandbox (P6 gate, 21-test-strategy) */
export default defineConfig({
  testDir: ".",
  timeout: 120_000,
  use: {
    baseURL: API_URL,
  },
  webServer: {
    command: "npm run e2e:server -w @app/server",
    url: `${API_URL}/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      E2E_PORT: API_PORT,
      E2E_SANDBOX_MODE: "docker",
      DATABASE_URL: "file:./e2e-docker-api.db",
      WORKSPACE_ROOT: "./e2e-docker-api-workspaces",
    },
  },
});
