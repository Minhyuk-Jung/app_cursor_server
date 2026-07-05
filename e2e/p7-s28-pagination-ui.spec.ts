import { test, expect } from "@playwright/test";
import { P7_E2E_AUTH } from "./p7-e2e-helpers.js";

const API = process.env.E2E_API_URL ?? "http://127.0.0.1:3100";
const WEB = process.env.E2E_WEB_URL ?? "http://127.0.0.1:5200";
const AUTH = P7_E2E_AUTH;

async function seedSettings(page: import("@playwright/test").Page) {
  await page.addInitScript(
    ({ apiUrl, apiKey }) => {
      localStorage.setItem(
        "remote-dev-settings",
        JSON.stringify({ apiBaseUrl: apiUrl, apiKey }),
      );
    },
    { apiUrl: API, apiKey: "dev-local-key" },
  );
}

/** P7 UR-16 — messages pagination UI */
test.describe("P7 — messages pagination UI", () => {
  test("이전 메시지 더 보기로 과거 메시지를 불러온다", async ({
    page,
    request,
  }) => {
    const projectName = `pag-${Date.now()}`;

    const projRes = await request.post(`${API}/api/v1/projects`, {
      headers: AUTH,
      data: { name: projectName },
    });
    expect(projRes.ok()).toBeTruthy();
    const { projectId } = (await projRes.json()) as { projectId: string };

    const seedRes = await request.post(`${API}/api/v1/e2e/session/seed`, {
      headers: AUTH,
      data: {
        projectId,
        title: "pagination-session",
        messageCount: 55,
        refreshSummary: true,
      },
    });
    expect(seedRes.ok()).toBeTruthy();
    const { sessionId } = (await seedRes.json()) as { sessionId: string };

    await seedSettings(page);
    await page.goto(WEB);
    await page.getByRole("button", { name: projectName }).click();
    await page.getByRole("button", { name: /pagination-session/ }).click();

    await expect(page.getByText("msg-54", { exact: true })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("msg-0", { exact: true })).not.toBeVisible();

    await page.getByRole("button", { name: "이전 메시지 더 보기" }).click();
    await expect(page.getByText("msg-0", { exact: true })).toBeVisible({
      timeout: 10_000,
    });
  });
});
