import { defineConfig } from "@playwright/test";

const API_PORT = process.env.E2E_PORT ?? "3094";
const WEB_PORT = process.env.E2E_WEB_PORT ?? "5197";
const API_URL = process.env.E2E_API_URL ?? `http://127.0.0.1:${API_PORT}`;
const WEB_URL = process.env.E2E_WEB_URL ?? `http://127.0.0.1:${WEB_PORT}`;
process.env.E2E_API_URL = API_URL;
process.env.E2E_WEB_URL = WEB_URL;
process.env.E2E_SANDBOX_MODE = "docker";

/** S17 UI E2E — docker sandbox (13 §10, 21-test-strategy P6) */
export default defineConfig({
  testDir: ".",
  timeout: 120_000,
  use: {
    baseURL: WEB_URL,
  },
  webServer: [
    {
      command: "npm run e2e:server -w @app/server",
      url: `${API_URL}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: {
        E2E_PORT: API_PORT,
        E2E_SANDBOX_MODE: "docker",
        DATABASE_URL: "file:./e2e-ui-docker.db",
        WORKSPACE_ROOT: "./e2e-ui-docker-workspaces",
        E2E_INBOX_SEED: "true",
      },
    },
    {
      command: `npm run dev:e2e -w @app/web -- --port ${WEB_PORT}`,
      url: WEB_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        E2E_API_URL: API_URL,
      },
    },
  ],
});
