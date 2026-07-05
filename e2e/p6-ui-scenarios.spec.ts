import { test, expect } from "@playwright/test";

const API = process.env.E2E_API_URL ?? "http://127.0.0.1:3099";
const WEB = process.env.E2E_WEB_URL ?? "http://127.0.0.1:5199";
const AUTH = { authorization: "Bearer dev-local-key" };

test.describe("S17 — 터미널 UI (P6 E2E, 15+13)", () => {
  test("터미널 탭에서 npm test 출력 확인", async ({ page, request }) => {
    const projectName = `e2e-s17-ui-${Date.now()}`;
    const projectRes = await request.post(`${API}/api/v1/projects`, {
      headers: AUTH,
      data: { name: projectName },
    });
    expect(projectRes.ok()).toBeTruthy();
    const { projectId } = (await projectRes.json()) as { projectId: string };

    await request.put(`${API}/api/v1/projects/${projectId}/file`, {
      headers: AUTH,
      data: {
        path: "package.json",
        content: JSON.stringify({
          name: "e2e-s17-ui",
          scripts: { test: 'node -e "console.log(\'s17-ui-npm-ok\')"' },
        }),
      },
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
    await page.getByTestId("project-tab-terminal").click();

    await expect(page.getByTestId("terminal-status")).toContainText("준비됨", {
      timeout: 15_000,
    });

    await page.getByTestId("terminal-command-input").fill("npm test");
    await page.getByTestId("terminal-run-button").click();

    await expect(page.getByTestId("terminal-output")).toContainText(
      "s17-ui-npm-ok",
      { timeout: 30_000 },
    );
    await expect(page.getByTestId("terminal-output")).toContainText("[exit 0]");
  });

  test("프리뷰 iframe에 upstream HTML 표시 (UR-10)", async ({ page, request }) => {
    const { createServer } = await import("node:http");
    const stub = await new Promise<{
      server: import("node:http").Server;
      port: number;
    }>((resolve, reject) => {
      const server = createServer((_req, res) => {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<html><body>s17-ui-preview-ok</body></html>");
      });
      server.listen(9877, "127.0.0.1", () => {
        const addr = server.address();
        const port = typeof addr === "object" && addr ? addr.port : 9877;
        resolve({ server, port });
      });
      server.on("error", reject);
    });

    try {
      const projectName = `e2e-preview-ui-${Date.now()}`;
      const projectRes = await request.post(`${API}/api/v1/projects`, {
        headers: AUTH,
        data: { name: projectName },
      });
      const { projectId } = (await projectRes.json()) as { projectId: string };

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
      await page.getByTestId("project-tab-terminal").click();
      await expect(page.getByTestId("terminal-status")).toContainText("준비됨", {
        timeout: 15_000,
      });

      await page.locator(".preview-port-input").fill(String(stub.port));
      await page.getByRole("button", { name: "프리뷰 URL" }).click();

      const frame = page.frameLocator(".preview-frame");
      await expect(frame.locator("body")).toContainText("s17-ui-preview-ok", {
        timeout: 15_000,
      });
    } finally {
      await new Promise<void>((resolve) => stub.server.close(() => resolve()));
    }
  });
});
