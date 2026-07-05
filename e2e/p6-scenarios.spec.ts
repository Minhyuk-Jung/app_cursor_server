import { test, expect } from "@playwright/test";
import WebSocket from "ws";

function apiUrl(): string {
  return process.env.E2E_API_URL ?? "http://127.0.0.1:3099";
}

function wsBase(): string {
  return apiUrl().replace(/^http/, "ws");
}

const AUTH = { authorization: "Bearer dev-local-key" };

async function issueWsToken(
  request: import("@playwright/test").APIRequestContext,
): Promise<string> {
  const res = await request.post(`${apiUrl()}/api/v1/ws-token`, { headers: AUTH });
  expect(res.ok()).toBeTruthy();
  const { token } = (await res.json()) as { token: string };
  return token;
}

async function waitTerminalReady(messages: string[]): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (messages.join("").includes('"type":"ready"')) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("terminal ready timeout");
}

test.describe("S17 — 터미널·프리뷰 (P6 E2E smoke)", () => {
  test("프리뷰 토큰 발급", async ({ request }) => {
    const projectRes = await request.post(`${apiUrl()}/api/v1/projects`, {
      headers: AUTH,
      data: { name: `e2e-term-${Date.now()}` },
    });
    expect(projectRes.ok()).toBeTruthy();
    const { projectId } = (await projectRes.json()) as { projectId: string };

    const previewRes = await request.post(
      `${apiUrl()}/api/v1/projects/${projectId}/preview`,
      {
        headers: AUTH,
        data: { port: 5173 },
      },
    );
    expect(previewRes.ok()).toBeTruthy();
    const body = (await previewRes.json()) as {
      token: string;
      previewPath: string;
    };
    expect(body.token.length).toBeGreaterThan(8);
    expect(body.previewPath).toContain(body.token);
  });

  test("프리뷰 포트 범위 밖 거부", async ({ request }) => {
    const projectRes = await request.post(`${apiUrl()}/api/v1/projects`, {
      headers: AUTH,
      data: { name: `e2e-port-${Date.now()}` },
    });
    const { projectId } = (await projectRes.json()) as { projectId: string };

    const previewRes = await request.post(
      `${apiUrl()}/api/v1/projects/${projectId}/preview`,
      {
        headers: AUTH,
        data: { port: 22 },
      },
    );
    expect(previewRes.status()).toBe(400);
  });

  test("터미널 WebSocket에서 명령 출력 스트림", async ({ request }) => {
    const projectRes = await request.post(`${apiUrl()}/api/v1/projects`, {
      headers: AUTH,
      data: { name: `e2e-ws-${Date.now()}` },
    });
    const { projectId } = (await projectRes.json()) as { projectId: string };

    const wsToken = await issueWsToken(request);
    const ws = new WebSocket(
      `${wsBase()}/api/v1/projects/${projectId}/terminal?token=${encodeURIComponent(wsToken)}`,
    );
    const messages: string[] = [];
    ws.on("message", (d) => messages.push(String(d)));

    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    await waitTerminalReady(messages);

    ws.send(JSON.stringify({ type: "exec", command: "echo e2e-term-ok" }));

    const deadline = Date.now() + 10_000;
    let joined = "";
    while (Date.now() < deadline) {
      joined = messages.join("");
      if (joined.includes("e2e-term-ok") && joined.includes('"type":"exit"')) {
        break;
      }
      await new Promise((r) => setTimeout(r, 30));
    }

    expect(joined).toContain("e2e-term-ok");
    ws.close();
  });

  test("S17 npm test 출력 스트림", async ({ request }) => {
    const projectRes = await request.post(`${apiUrl()}/api/v1/projects`, {
      headers: AUTH,
      data: { name: `e2e-npm-${Date.now()}` },
    });
    const { projectId } = (await projectRes.json()) as { projectId: string };

    await request.put(`${apiUrl()}/api/v1/projects/${projectId}/file`, {
      headers: AUTH,
      data: {
        path: "package.json",
        content: JSON.stringify({
          name: "e2e-s17",
          scripts: { test: 'node -e "console.log(\'s17-npm-ok\')"' },
        }),
      },
    });

    const wsToken = await issueWsToken(request);
    const ws = new WebSocket(
      `${wsBase()}/api/v1/projects/${projectId}/terminal?token=${encodeURIComponent(wsToken)}`,
    );
    const messages: string[] = [];
    ws.on("message", (d) => messages.push(String(d)));

    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    await waitTerminalReady(messages);

    ws.send(JSON.stringify({ type: "exec", command: "npm test" }));

    const deadline = Date.now() + 30_000;
    let joined = "";
    while (Date.now() < deadline) {
      joined = messages.join("");
      if (joined.includes("s17-npm-ok") && joined.includes('"type":"exit"')) {
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }

    expect(joined).toContain("s17-npm-ok");
    ws.close();
  });

  test("프리뷰 WebSocket HMR 프록시", async ({ request }) => {
    test.skip(
      process.env.E2E_SANDBOX_MODE === "docker",
      "docker preview upstream must listen inside container bridge network",
    );
    const { WebSocketServer } = await import("ws");
    const upstream = await new Promise<{
      server: import("ws").WebSocketServer;
      port: number;
    }>((resolve, reject) => {
      let bound = false;
      const tryPort = (port: number) => {
        const wss = new WebSocketServer({ port, host: "127.0.0.1" });
        wss.on("listening", () => {
          bound = true;
          resolve({ server: wss, port });
        });
        wss.on("error", (err) => {
          if (!bound && port > 3000) tryPort(port - 1);
          else reject(err);
        });
        wss.on("connection", (ws) => {
          ws.send("e2e-preview-ws-ok");
        });
      };
      tryPort(9876);
    });

    try {
      const projectRes = await request.post(`${apiUrl()}/api/v1/projects`, {
        headers: AUTH,
        data: { name: `e2e-preview-ws-${Date.now()}` },
      });
      const { projectId } = (await projectRes.json()) as { projectId: string };

      const previewRes = await request.post(
        `${apiUrl()}/api/v1/projects/${projectId}/preview`,
        { headers: AUTH, data: { port: upstream.port } },
      );
      const { previewPath } = (await previewRes.json()) as { previewPath: string };

      const ws = new WebSocket(`${wsBase()}${previewPath}`);
      const msg = await new Promise<string>((resolve, reject) => {
        ws.once("message", (d) => resolve(String(d)));
        ws.once("error", reject);
        setTimeout(() => reject(new Error("ws timeout")), 5000);
      });
      expect(msg).toBe("e2e-preview-ws-ok");
      ws.close();
    } finally {
      await new Promise<void>((resolve) => upstream.server.close(() => resolve()));
    }
  });

  test("프리뷰 HTTP 프록시 GET", async ({ request }) => {
    test.skip(
      process.env.E2E_SANDBOX_MODE === "docker",
      "docker preview upstream must listen inside container bridge network",
    );
    const { createServer } = await import("node:http");
    const stub = await new Promise<{ server: import("node:http").Server; port: number }>(
      (resolve, reject) => {
        const server = createServer((_req, res) => {
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end("e2e-preview-proxy");
        });
        server.listen(9876, "127.0.0.1", () => {
          const addr = server.address();
          const port = typeof addr === "object" && addr ? addr.port : 9876;
          resolve({ server, port });
        });
        server.on("error", reject);
      },
    );

    try {
      const projectRes = await request.post(`${apiUrl()}/api/v1/projects`, {
        headers: AUTH,
        data: { name: `e2e-preview-${Date.now()}` },
      });
      const { projectId } = (await projectRes.json()) as { projectId: string };

      const previewRes = await request.post(
        `${apiUrl()}/api/v1/projects/${projectId}/preview`,
        { headers: AUTH, data: { port: stub.port } },
      );
      expect(previewRes.ok()).toBeTruthy();
      const { previewPath } = (await previewRes.json()) as { previewPath: string };

      const proxyRes = await request.get(`${apiUrl()}${previewPath}`);
      expect(proxyRes.ok()).toBeTruthy();
      expect(await proxyRes.text()).toContain("e2e-preview-proxy");
    } finally {
      await new Promise<void>((resolve) => stub.server.close(() => resolve()));
    }
  });
});

test.describe("Health (P6 exec)", () => {
  test("sandbox mode in health", async ({ request }) => {
    const res = await request.get(`${apiUrl()}/health`);
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as {
      exec: {
        sandboxMode: string;
        maxConcurrent: number;
        perProjectMax: number;
        previewPortRange: [number, number];
      };
      sandbox: { validatedWorkspacePath: boolean; mode: string; reusableContainers?: boolean };
    };
    expect(["subprocess", "docker"]).toContain(body.exec.sandboxMode);
    expect(body.exec.maxConcurrent).toBeGreaterThan(0);
    expect(body.exec.perProjectMax).toBeGreaterThan(0);
    expect(body.exec.previewPortRange[0]).toBeLessThanOrEqual(5173);
    expect(body.sandbox.validatedWorkspacePath).toBe(true);
    expect(typeof body.sandbox.activeSessions).toBe("number");
  });
});
