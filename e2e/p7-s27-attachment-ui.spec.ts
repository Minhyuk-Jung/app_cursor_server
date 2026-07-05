import { test, expect } from "@playwright/test";
import { P7_E2E_AUTH, seedE2eSession } from "./p7-e2e-helpers.js";

const API = process.env.E2E_API_URL ?? "http://127.0.0.1:3101";
const WEB = process.env.E2E_WEB_URL ?? "http://127.0.0.1:5201";
const AUTH = P7_E2E_AUTH;

/** P7 S27 — screenshot attach → send_prompt (18-scenarios) */
test.describe("P7 S27 — attachment prompt UI", () => {
  test("이미지 첨부 후 전송하면 attachmentsJson이 기록된다", async ({
    page,
    request,
  }) => {
    const projectName = `s27-${Date.now()}`;
    const sessionTitle = "s27-session";
    const promptText = "analyze this screenshot";

    const projRes = await request.post(`${API}/api/v1/projects`, {
      headers: AUTH,
      data: { name: projectName },
    });
    expect(projRes.ok()).toBeTruthy();
    const { projectId } = (await projRes.json()) as { projectId: string };

    const sessionId = await seedE2eSession(request, API, {
      projectId,
      title: sessionTitle,
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
    await page.getByRole("button", { name: sessionTitle }).click();

    await page.locator('input[type="file"]').setInputFiles({
      name: "shot.png",
      mimeType: "image/png",
      buffer: Buffer.from("s27-screenshot-bytes"),
    });
    await expect(page.locator(".pending-attachments")).toBeVisible({
      timeout: 10_000,
    });

    await page.getByPlaceholder("지시를 입력…").fill(promptText);
    await page.getByRole("button", { name: "전송" }).click();

    const deadline = Date.now() + 15_000;
    let found = false;
    while (Date.now() < deadline) {
      const msgRes = await request.get(
        `${API}/api/v1/sessions/${sessionId}/messages`,
        { headers: AUTH },
      );
      const body = (await msgRes.json()) as {
        messages: Array<{ role: string; content: string; attachmentsJson?: string }>;
      };
      const user = body.messages.find((m) => m.role === "user" && m.content === promptText);
      if (user?.attachmentsJson) {
        const atts = JSON.parse(user.attachmentsJson) as Array<{ kind: string; ref: string }>;
        expect(atts.length).toBeGreaterThan(0);
        expect(atts[0]!.kind).toBe("image");
        found = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    expect(found).toBe(true);
  });
});
