import { test, expect } from "@playwright/test";

const API = process.env.E2E_API_URL ?? "http://127.0.0.1:3101";
const WEB = process.env.E2E_WEB_URL ?? "http://127.0.0.1:5201";
const AUTH = { authorization: "Bearer dev-local-key" };

async function seedInbox(
  request: import("@playwright/test").APIRequestContext,
  input: {
    projectId: string;
    kind: string;
    deeplink: string;
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

test.describe("P7 mobile 18차 — web Git 탭·인박스 git deeplink", () => {
  test("git_status 알림 → Git 탭", async ({ page, request }) => {
    const projectName = `e2e-git-tab-${Date.now()}`;
    const projectRes = await request.post(`${API}/api/v1/projects`, {
      headers: AUTH,
      data: { name: projectName },
    });
    const { projectId } = (await projectRes.json()) as { projectId: string };

    const noteId = await seedInbox(request, {
      projectId,
      kind: "git_status",
      deeplink: `/project/${projectId}/git`,
      title: "Git 상태",
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
    await page.getByRole("button", { name: projectName }).click();
    await page.getByRole("button", { name: /^인박스/ }).click();
    await page.getByTestId(`inbox-item-${noteId}`).click();

    await expect(page.getByRole("dialog", { name: "전역 인박스" })).toBeHidden();
    await expect(page.getByTestId("project-tab-git")).toHaveClass(/active/);
    await expect(page.getByTestId("git-status-panel")).toBeVisible();
  });

  test("프로젝트 Git 탭 직접 선택", async ({ page, request }) => {
    const projectName = `e2e-git-direct-${Date.now()}`;
    const projectRes = await request.post(`${API}/api/v1/projects`, {
      headers: AUTH,
      data: { name: projectName },
    });
    expect(projectRes.ok()).toBeTruthy();

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
    await page.getByRole("button", { name: projectName }).click();
    await page.getByTestId("project-tab-git").click();
    await expect(page.getByTestId("git-status-panel")).toBeVisible();
    await expect(page.getByTestId("git-upstream-sync")).toContainText("upstream 미설정");
  });
});
