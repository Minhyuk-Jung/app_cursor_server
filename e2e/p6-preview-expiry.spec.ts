import { test, expect } from "@playwright/test";

const API = process.env.E2E_API_URL ?? "http://127.0.0.1:3093";
const AUTH = { authorization: "Bearer dev-local-key" };

test.describe("UR-10 — 프리뷰 토큰 만료 (13 §6.3)", () => {
  test("TTL 경과 후 preview HTTP 프록시 403", async ({ request }) => {
    const { createServer } = await import("node:http");
    const stub = await new Promise<{ server: import("node:http").Server; port: number }>(
      (resolve, reject) => {
        const server = createServer((_req, res) => {
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end("preview-expiry-stub");
        });
        server.listen(9875, "127.0.0.1", () => {
          const addr = server.address();
          const port = typeof addr === "object" && addr ? addr.port : 9875;
          resolve({ server, port });
        });
        server.on("error", reject);
      },
    );

    try {
      const projectRes = await request.post(`${API}/api/v1/projects`, {
        headers: AUTH,
        data: { name: `e2e-preview-exp-${Date.now()}` },
      });
      const { projectId } = (await projectRes.json()) as { projectId: string };

      const previewRes = await request.post(
        `${API}/api/v1/projects/${projectId}/preview`,
        { headers: AUTH, data: { port: stub.port } },
      );
      expect(previewRes.ok()).toBeTruthy();
      const { previewPath } = (await previewRes.json()) as { previewPath: string };

      await new Promise((r) => setTimeout(r, 1500));

      const proxyRes = await request.get(`${API}${previewPath}`);
      expect(proxyRes.status()).toBe(403);
    } finally {
      await new Promise<void>((resolve) => stub.server.close(() => resolve()));
    }
  });
});
