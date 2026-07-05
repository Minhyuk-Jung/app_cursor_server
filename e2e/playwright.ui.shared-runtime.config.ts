import { defineConfig } from "@playwright/test";

const API_PORT = process.env.E2E_PORT ?? "3098";
const WEB_PORT = process.env.E2E_WEB_PORT ?? "5196";

/** P6→P7 shared-runtime UI E2E — web chat + in-container SDK */
export default defineConfig({
  testDir: ".",
  timeout: 300_000,
  use: {
    baseURL: process.env.E2E_WEB_URL ?? `http://127.0.0.1:${WEB_PORT}`,
  },
  webServer: [
    {
      command: "npm run e2e:server -w @app/server",
      url: `http://127.0.0.1:${API_PORT}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 240_000,
      env: {
        E2E_PORT: API_PORT,
        E2E_SANDBOX_MODE: "docker",
        SDK_IN_CONTAINER: "true",
        SANDBOX_DOCKER_IMAGE:
          process.env.SANDBOX_DOCKER_IMAGE ?? "cursor-sandbox-sdk:ci",
        DATABASE_URL: "file:./e2e-shared-runtime-ui.db",
        WORKSPACE_ROOT: "./e2e-shared-runtime-ui-workspaces",
        CURSOR_API_KEY: process.env.CURSOR_API_KEY ?? "",
      },
    },
    {
      command: "npm run dev:e2e -w @app/web -- --port 5196",
      url: `http://127.0.0.1:${WEB_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        E2E_API_URL: `http://127.0.0.1:${API_PORT}`,
      },
    },
  ],
});
