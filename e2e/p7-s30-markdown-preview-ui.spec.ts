import { test, expect } from "@playwright/test";

const API = process.env.E2E_API_URL ?? "http://127.0.0.1:3102";
const WEB = process.env.E2E_WEB_URL ?? "http://127.0.0.1:5202";
const AUTH = { authorization: "Bearer dev-local-key" };

const SAMPLE_MD = [
  "# Preview doc",
  "",
  "```js",
  "const e2e = true;",
  "```",
  "",
  "- [ ] todo item",
  "1. ordered item",
  "",
  "Footnote here[^note]",
  "",
  "[^note]: GFM footnote body",
].join("\n");

test.describe("P7 mobile 22차 — web Markdown preview (UR-02)", () => {
  test("markdown file 미리보기 GFM 렌더·원문 토글", async ({ page, request }) => {
    const projectName = `e2e-md-preview-${Date.now()}`;
    const projectRes = await request.post(`${API}/api/v1/projects`, {
      headers: AUTH,
      data: { name: projectName },
    });
    expect(projectRes.ok()).toBeTruthy();
    const { projectId } = (await projectRes.json()) as { projectId: string };

    await request.put(`${API}/api/v1/projects/${projectId}/file`, {
      headers: AUTH,
      data: { path: "docs/preview.md", content: SAMPLE_MD },
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
    await page.getByRole("button", { name: "preview.md" }).click();
    await page.getByRole("button", { name: "미리보기" }).click();

    const preview = page.getByTestId("markdown-preview");
    await expect(preview).toBeVisible();
    await expect(preview.locator("h1")).toContainText("Preview doc");
    await expect(preview.locator(".md-code-block")).toContainText("const e2e = true");
    await expect(preview.locator(".md-task")).toContainText("todo item");
    await expect(preview.locator(".md-ordered")).toContainText("ordered item");
    await expect(preview.locator(".md-fn-ref")).toBeVisible();
    await expect(preview.locator(".md-footnotes")).toContainText("GFM footnote body");

    await page.getByRole("button", { name: "원문" }).click();
    await expect(page.locator("textarea.file-editor")).toContainText("Preview doc");
    await expect(page.locator("textarea.file-editor")).toContainText("[^note]: GFM footnote body");

    await page.getByRole("button", { name: "미리보기" }).click();
    await expect(preview).toBeVisible();
    await expect(preview.locator(".md-fn-ref")).toBeVisible();
  });
});
