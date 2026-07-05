import { test, expect } from "@playwright/test";
import { seedE2eSession } from "./p7-e2e-helpers.js";

const API = process.env.E2E_API_URL ?? "http://127.0.0.1:3094";
const WEB = process.env.E2E_WEB_URL ?? "http://127.0.0.1:5197";
const AUTH = { authorization: "Bearer dev-local-key" };

async function seedInbox(
  request: import("@playwright/test").APIRequestContext,
  input: {
    projectId: string;
    kind: string;
    deeplink: string;
    sessionId?: string;
    title?: string;
  },
): Promise<string> {
  const res = await request.post(`${API}/api/v1/e2e/inbox/seed`, {
    headers: AUTH,
    data: input,
  });
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { id: string };
  return body.id;
}

test.describe("15 §6.4 — 인박스 deeplink UI (09)", () => {
  test.beforeAll(async ({ request }) => {
    const res = await request.get(`${API}/health`);
    const body = (await res.json()) as {
      sandbox?: { dockerAvailable?: boolean; mode?: string };
    };
    const dockerReady =
      body.sandbox?.dockerAvailable === true &&
      body.sandbox.mode === "docker";
    if (!dockerReady) {
      if (process.env.CI === "1") {
        throw new Error("Docker sandbox required for inbox deeplink UI E2E");
      }
      test.skip(true, "Docker sandbox not available locally");
    }
  });

  test("review_ready 알림 → 변경 리뷰 탭", async ({ page, request }) => {
    const projectName = `e2e-inbox-diff-${Date.now()}`;
    const projectRes = await request.post(`${API}/api/v1/projects`, {
      headers: AUTH,
      data: { name: projectName },
    });
    const { projectId } = (await projectRes.json()) as { projectId: string };

    const noteId = await seedInbox(request, {
      projectId,
      kind: "review_ready",
      deeplink: `/project/${projectId}/diff`,
      title: "변경 리뷰 준비",
    });

    await page.addInitScript(
      ({ apiUrl, apiKey }) => {
        localStorage.setItem(
          "remote-dev-settings",
          JSON.stringify({ apiBaseUrl: apiUrl, apiKey }),
        );
      },
      { apiUrl: API, apiKey: "dev-local-key" },
    );

    await page.goto(WEB);
    await page.getByRole("button", { name: /^인박스/ }).click();
    await page.getByTestId(`inbox-item-${noteId}`).click();

    await expect(page.getByRole("dialog", { name: "전역 인박스" })).toBeHidden();
    await expect(page.getByRole("button", { name: "변경 리뷰" })).toHaveClass(
      /active/,
    );
  });

  test("run_done 알림 → 세션 선택", async ({ page, request }) => {
    const projectName = `e2e-inbox-sess-${Date.now()}`;
    const projectRes = await request.post(`${API}/api/v1/projects`, {
      headers: AUTH,
      data: { name: projectName },
    });
    const { projectId } = (await projectRes.json()) as { projectId: string };

    const sessionId = await seedE2eSession(request, API, {
      projectId,
      title: "e2e-inbox-session",
    });

    const noteId = await seedInbox(request, {
      projectId,
      sessionId,
      kind: "run_done",
      deeplink: `/project/${projectId}/session/${sessionId}`,
      title: "실행 완료",
    });

    await page.addInitScript(
      ({ apiUrl, apiKey }) => {
        localStorage.setItem(
          "remote-dev-settings",
          JSON.stringify({ apiBaseUrl: apiUrl, apiKey }),
        );
      },
      { apiUrl: API, apiKey: "dev-local-key" },
    );

    await page.goto(WEB);
    await page.getByRole("button", { name: /^인박스/ }).click();
    await page.getByTestId(`inbox-item-${noteId}`).click();

    await expect(page.getByRole("dialog", { name: "전역 인박스" })).toBeHidden();
    await expect(page.getByRole("button", { name: projectName })).toHaveClass(
      /active/,
    );
    await expect(page.getByText("e2e-inbox-session")).toBeVisible();
  });
});
