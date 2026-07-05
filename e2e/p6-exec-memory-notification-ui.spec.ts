import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";

const API = process.env.E2E_API_URL ?? "http://127.0.0.1:3097";
const WEB = process.env.E2E_WEB_URL ?? "http://127.0.0.1:5199";
const AUTH = { authorization: "Bearer dev-local-key" };

const memoryBombCmd =
  'node -e "const b=[];for(;;)b.push(Buffer.alloc(1024*1024))"';

test.describe("S9+15 — exec_memory_limit 인박스 deeplink (13 §9 docker)", () => {
  test.beforeAll(async ({ request }) => {
    const res = await request.get(`${API}/health`);
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as {
      sandbox?: { dockerAvailable?: boolean; mode?: string };
    };
    const dockerReady =
      body.sandbox?.dockerAvailable === true &&
      body.sandbox.mode === "docker";
    if (!dockerReady) {
      if (process.env.CI === "1") {
        throw new Error(
          "Docker sandbox required for exec_memory_limit UI E2E (P6 gate)",
        );
      }
      test.skip(true, "Docker sandbox not available locally");
    }
  });

  test("인박스 exec_memory_limit 클릭 시 터미널 탭으로 이동", async ({
    page,
    request,
  }) => {
    const projectRes = await request.post(`${API}/api/v1/projects`, {
      headers: AUTH,
      data: { name: `e2e-mem-ui-${Date.now()}` },
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
        command: memoryBombCmd,
      },
      timeout: 180_000,
    });
    if (!execRes.ok()) {
      const errBody = await execRes.text();
      throw new Error(`exec_command failed (${execRes.status()}): ${errBody}`);
    }
    const execBody = (await execRes.json()) as { errorCode?: string };
    expect(execBody.errorCode).toBe("exec_memory_limit");

    const deadline = Date.now() + 30_000;
    let noteId: string | undefined;
    while (Date.now() < deadline) {
      const inboxRes = await request.get(`${API}/api/v1/inbox`, {
        headers: AUTH,
      });
      const body = (await inboxRes.json()) as {
        items: Array<{ id: string; kind: string; projectId?: string }>;
      };
      const note = body.items.find(
        (i) => i.kind === "exec_memory_limit" && i.projectId === projectId,
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
