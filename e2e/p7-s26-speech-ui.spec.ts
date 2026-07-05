import { test, expect } from "@playwright/test";
import { P7_E2E_AUTH, seedE2eSession } from "./p7-e2e-helpers.js";

const API = process.env.E2E_API_URL ?? "http://127.0.0.1:3100";
const WEB = process.env.E2E_WEB_URL ?? "http://127.0.0.1:5200";
const AUTH = P7_E2E_AUTH;

const VOICE_TRANSCRIPT = "hello from voice e2e";
const PREFIX_TEXT = "prefix ";

async function mockSpeechInit(page: import("@playwright/test").Page, transcript: string) {
  await page.addInitScript((t: string) => {
    class MockSpeechRecognition {
      lang = "ko-KR";
      continuous = false;
      interimResults = false;
      maxAlternatives = 1;
      onresult: ((event: SpeechRecognitionEvent) => void) | null = null;
      onerror: ((event: SpeechRecognitionErrorEvent) => void) | null = null;
      onend: (() => void) | null = null;

      start() {
        const alt = { transcript: t };
        const result = {
          0: alt,
          isFinal: true,
          length: 1,
          item: (index: number) => (index === 0 ? alt : null),
        };
        const results = {
          0: result,
          length: 1,
          item: (index: number) => (index === 0 ? result : null),
        } as unknown as SpeechRecognitionResultList;
        this.onresult?.({ resultIndex: 0, results } as SpeechRecognitionEvent);
        this.onend?.();
      }

      stop() {
        this.onend?.();
      }
    }

    (
      window as Window & {
        SpeechRecognition?: typeof MockSpeechRecognition;
        webkitSpeechRecognition?: typeof MockSpeechRecognition;
      }
    ).SpeechRecognition = MockSpeechRecognition;
    (
      window as Window & { webkitSpeechRecognition?: typeof MockSpeechRecognition }
    ).webkitSpeechRecognition = MockSpeechRecognition;
  }, transcript);
}

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

/** P7 S26 — mock SpeechRecognition → textarea → send_prompt */
test.describe("P7 S26 — speech prompt UI (15 §6.6)", () => {
  test("음성 입력 후 전송하면 user 메시지가 API에 기록된다", async ({
    page,
    request,
  }) => {
    const projectName = `s26-${Date.now()}`;
    const sessionTitle = "s26-session";

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

    await mockSpeechInit(page, VOICE_TRANSCRIPT);
    await seedSettings(page);

    await page.goto(WEB);
    await page.getByRole("button", { name: projectName }).click();
    await page.getByRole("button", { name: sessionTitle }).click();

    await page.getByRole("button", { name: "🎤 음성" }).click();
    await expect(page.getByPlaceholder("지시를 입력…")).toHaveValue(
      VOICE_TRANSCRIPT,
      { timeout: 5_000 },
    );

    const sendResPromise = page.waitForResponse(
      (r) =>
        r.url().includes(`/api/v1/sessions/${sessionId}/messages`) &&
        r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "전송" }).click();
    const sendRes = await sendResPromise;
    expect([200, 202]).toContain(sendRes.status());

    const deadline = Date.now() + 15_000;
    let found = false;
    while (Date.now() < deadline) {
      const msgRes = await request.get(
        `${API}/api/v1/sessions/${sessionId}/messages`,
        { headers: AUTH },
      );
      expect(msgRes.ok()).toBeTruthy();
      const body = (await msgRes.json()) as {
        messages: Array<{ role: string; content: string }>;
      };
      found = body.messages.some(
        (m) => m.role === "user" && m.content.includes(VOICE_TRANSCRIPT),
      );
      if (found) break;
      await new Promise((r) => setTimeout(r, 300));
    }

    expect(found).toBe(true);
    await expect(page.locator(".messages")).toContainText(VOICE_TRANSCRIPT, {
      timeout: 5_000,
    });
  });

  test("기존 텍스트에 음성 결과가 이어 붙는다", async ({ page, request }) => {
    const projectName = `s26-append-${Date.now()}`;
    const sessionTitle = "s26-append-session";

    const projRes = await request.post(`${API}/api/v1/projects`, {
      headers: AUTH,
      data: { name: projectName },
    });
    const { projectId } = (await projRes.json()) as { projectId: string };
    await seedE2eSession(request, API, {
      projectId,
      title: sessionTitle,
    });

    await mockSpeechInit(page, VOICE_TRANSCRIPT);
    await seedSettings(page);
    await page.goto(WEB);
    await page.getByRole("button", { name: projectName }).click();
    await page.getByRole("button", { name: sessionTitle }).click();

    await page.getByPlaceholder("지시를 입력…").fill(PREFIX_TEXT);
    await page.getByRole("button", { name: "🎤 음성" }).click();
    await expect(page.getByPlaceholder("지시를 입력…")).toHaveValue(
      `${PREFIX_TEXT}${VOICE_TRANSCRIPT}`,
      { timeout: 5_000 },
    );
  });
});
