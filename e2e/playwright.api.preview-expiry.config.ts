import { defineConfig } from "@playwright/test";

const API_PORT = process.env.E2E_PORT ?? "3093";

/** 프리뷰 토큰 만료 E2E — 짧은 PREVIEW_TOKEN_TTL_SEC (13 §6.3) */
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
      PREVIEW_TOKEN_TTL_SEC: "1",
      DATABASE_URL: "file:./e2e-preview-expiry.db",
      WORKSPACE_ROOT: "./e2e-preview-expiry-workspaces",
    },
  },
});
