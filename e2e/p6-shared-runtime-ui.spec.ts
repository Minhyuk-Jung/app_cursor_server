import { test, expect } from "@playwright/test";
import {
  assertSharedRuntimeSandbox,
  createProjectSession,
  requireCursorApiKey,
  SHARED_RUNTIME_API,
  SHARED_RUNTIME_AUTH,
} from "./p6-shared-runtime-helpers.js";

const WEB = process.env.E2E_WEB_URL ?? "http://127.0.0.1:5196";

test.describe("P6→P7 — shared-runtime web chat UI (15+04+05)", () => {
  test.beforeAll(async ({ request }) => {
    await assertSharedRuntimeSandbox(request);
  });

  test("채팅 전송 후 assistant 메시지 표시", async ({ page, request }) => {
    requireCursorApiKey();

    const projectName = `e2e-rt-ui-${Date.now()}`;
    const sessionTitle = "e2e-ui-session";
    const { sessionId, projectName: name } = await createProjectSession(
      request,
      { projectName, sessionTitle },
    );

    await page.addInitScript(
      ({ apiUrl, apiKey }) => {
        localStorage.setItem(
          "remote-dev-settings",
          JSON.stringify({ apiBaseUrl: apiUrl, apiKey }),
        );
      },
      { apiUrl: SHARED_RUNTIME_API, apiKey: "dev-local-key" },
    );

    await page.goto(WEB);
    await page.getByRole("button", { name }).click();
    await page.getByRole("button", { name: sessionTitle }).click();

    await page.getByPlaceholder("지시를 입력…").fill("Reply with one short greeting.");
    await page.getByRole("button", { name: "전송" }).click();

    const deadline = Date.now() + 240_000;
    let hasAssistant = false;
    while (Date.now() < deadline) {
      const msgRes = await request.get(
        `${SHARED_RUNTIME_API}/api/v1/sessions/${sessionId}/messages`,
        { headers: SHARED_RUNTIME_AUTH },
      );
      expect(msgRes.ok()).toBeTruthy();
      const body = (await msgRes.json()) as {
        messages: Array<{ role: string }>;
      };
      hasAssistant = body.messages.some((m) => m.role === "assistant");
      if (hasAssistant) break;
      await new Promise((r) => setTimeout(r, 500));
    }

    expect(hasAssistant).toBe(true);
    await expect(page.locator(".messages")).not.toBeEmpty({ timeout: 5_000 });
  });
});
