import { defineConfig } from "@playwright/test";

const API_PORT = process.env.E2E_PORT ?? "3094";
const WEB_PORT = process.env.E2E_WEB_PORT ?? "5197";
const API_URL = process.env.E2E_API_URL ?? `http://127.0.0.1:${API_PORT}`;
const WEB_URL = process.env.E2E_WEB_URL ?? `http://127.0.0.1:${WEB_PORT}`;
process.env.E2E_API_URL = API_URL;
process.env.E2E_WEB_URL = WEB_URL;

// #region agent log
fetch("http://127.0.0.1:7382/ingest/303537a0-5c93-4719-98b8-81fc4995f26d", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Debug-Session-Id": "0c6964",
  },
  body: JSON.stringify({
    sessionId: "0c6964",
    hypothesisId: "H1",
    location: "playwright.ui.docker.config.ts:boot",
    message: "docker ui playwright config ports",
    data: {
      API_PORT,
      WEB_PORT,
      API_URL,
      WEB_URL,
      SANDBOX_DOCKER_IMAGE: process.env.SANDBOX_DOCKER_IMAGE ?? null,
    },
    timestamp: Date.now(),
  }),
}).catch(() => {});
// #endregion

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
        ...(process.env.SANDBOX_DOCKER_IMAGE
          ? { SANDBOX_DOCKER_IMAGE: process.env.SANDBOX_DOCKER_IMAGE }
          : {}),
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
