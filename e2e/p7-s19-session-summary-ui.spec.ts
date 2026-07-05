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

/** P7 S19 — 세션 목록 summary 카드 (UR-16) */
test.describe("P7 S19 — session summary in sidebar", () => {
  test("세션 목록에 rule-based summary가 표시된다", async ({
    page,
    request,
  }) => {
    const projectName = `s19-${Date.now()}`;
    const sessionTitle = "s19-summary-session";
    const userMsg = "add dashboard widget";
    const assistantMsg = "Created DashboardWidget.tsx";

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
        title: sessionTitle,
        messages: [
          { role: "user", content: userMsg },
          { role: "assistant", content: assistantMsg },
        ],
        refreshSummary: true,
      },
    });
    expect(seedRes.ok()).toBeTruthy();
    const seedBody = (await seedRes.json()) as { summary: string };
    expect(seedBody.summary).toContain(userMsg);

    await seedSettings(page);
    await page.goto(WEB);
    await page.getByRole("button", { name: projectName }).click();
    await expect(page.locator(".session-summary")).toContainText(userMsg);
    await expect(page.locator(".session-summary")).toContainText(
      assistantMsg,
    );
  });
});
