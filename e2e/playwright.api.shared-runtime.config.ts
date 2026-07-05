import { defineConfig } from "@playwright/test";

const API_PORT = process.env.E2E_PORT ?? "3098";

/** P6→P7 shared-runtime API E2E — SessionManager + SDK in-container */
export default defineConfig({
  testDir: ".",
  timeout: 300_000,
  use: {
    baseURL: process.env.E2E_API_URL ?? `http://127.0.0.1:${API_PORT}`,
  },
  webServer: {
    command: "npm run e2e:server -w @app/server",
    url: `http://127.0.0.1:${API_PORT}/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    env: {
      E2E_PORT: API_PORT,
      E2E_SANDBOX_MODE: "docker",
      SDK_IN_CONTAINER: "true",
      SANDBOX_DOCKER_IMAGE: process.env.SANDBOX_DOCKER_IMAGE ?? "cursor-sandbox-sdk:ci",
      DATABASE_URL: "file:./e2e-shared-runtime-api.db",
      WORKSPACE_ROOT: "./e2e-shared-runtime-workspaces",
    },
  },
});
