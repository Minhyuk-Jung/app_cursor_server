import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";

const API = process.env.E2E_API_URL ?? "http://127.0.0.1:3096";
const WEB = process.env.E2E_WEB_URL ?? "http://127.0.0.1:5198";
const AUTH = { authorization: "Bearer dev-local-key" };

const slowCmd =
  process.platform === "win32"
    ? "powershell -Command Start-Sleep -Seconds 5"
    : "sleep 5";

test.describe("S9+15 — exec_timeout 인박스 deeplink (13 §9)", () => {
  test("인박스 알림 클릭 시 터미널 탭으로 이동", async ({ page, request }) => {
    const projectName = `e2e-inbox-term-${Date.now()}`;
    const projectRes = await request.post(`${API}/api/v1/projects`, {
      headers: AUTH,
      data: { name: projectName },
    });
    expect(projectRes.ok()).toBeTruthy();
    const { projectId } = (await projectRes.json()) as { projectId: string };

    const execRes = await request.post(`${API}/api/v1/commands`, {
      headers: AUTH,
      data: {
        kind: "exec_command",
        source: "web",
        requestId: randomUUID(),
        projectId,
        command: slowCmd,
      },
      timeout: 45_000,
    });
    expect(execRes.ok()).toBeTruthy();

    const deadline = Date.now() + 10_000;
    let noteId: string | undefined;
    while (Date.now() < deadline) {
      const inboxRes = await request.get(`${API}/api/v1/inbox`, {
        headers: AUTH,
      });
      const body = (await inboxRes.json()) as {
        items: Array<{ id: string; kind: string; projectId?: string }>;
      };
      const note = body.items.find(
        (i) => i.kind === "exec_timeout" && i.projectId === projectId,
      );
      if (note) {
        noteId = note.id;
        break;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(noteId).toBeTruthy();

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
    await expect(page.getByRole("dialog", { name: "전역 인박스" })).toBeVisible();

    const inboxItem = page.getByTestId(`inbox-item-${noteId}`);
    await expect(inboxItem).toBeVisible({ timeout: 15_000 });
    await inboxItem.click();

    await expect(page.getByRole("dialog", { name: "전역 인박스" })).toBeHidden();
    await expect(page.getByTestId("project-tab-terminal")).toHaveClass(/active/);
    await expect(page.getByTestId("terminal-panel")).toBeVisible();
  });
});
