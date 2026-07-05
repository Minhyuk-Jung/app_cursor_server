import { defineConfig } from "@playwright/test";

const API_PORT = process.env.E2E_PORT ?? "3098";
const API_URL = process.env.E2E_API_URL ?? `http://127.0.0.1:${API_PORT}`;
process.env.E2E_API_URL = API_URL;

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
    location: "playwright.api.docker.config.ts:boot",
    message: "docker api playwright config ports",
    data: {
      API_PORT,
      API_URL,
      E2E_SANDBOX_MODE: "docker",
      SANDBOX_DOCKER_IMAGE: process.env.SANDBOX_DOCKER_IMAGE ?? null,
    },
    timestamp: Date.now(),
  }),
}).catch(() => {});
// #endregion

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
      ...(process.env.SANDBOX_DOCKER_IMAGE
        ? { SANDBOX_DOCKER_IMAGE: process.env.SANDBOX_DOCKER_IMAGE }
        : {}),
    },
  },
});
