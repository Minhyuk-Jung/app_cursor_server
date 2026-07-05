import { test, expect } from "@playwright/test";

const API = process.env.E2E_API_URL ?? "http://127.0.0.1:3099";
const AUTH = { authorization: "Bearer dev-local-key" };

test.describe("S9 — 인박스·JWT (P4 E2E smoke)", () => {
  test("JWT 발급 후 인박스 API 접근", async ({ request }) => {
    const tokenRes = await request.post(`${API}/api/v1/auth/token`, {
      data: { apiKey: "dev-local-key" },
    });
    expect(tokenRes.ok()).toBeTruthy();
    const { accessToken } = (await tokenRes.json()) as { accessToken: string };

    const inboxRes = await request.get(`${API}/api/v1/inbox`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(inboxRes.ok()).toBeTruthy();
    const body = (await inboxRes.json()) as { items: unknown[] };
    expect(Array.isArray(body.items)).toBe(true);
  });
});

test.describe("S29 — Telegram (P4 E2E)", () => {
  test("연결된 chat에서 /dev status", async ({ request }) => {
    await request.post(`${API}/api/v1/channel-links`, {
      headers: AUTH,
      data: { channel: "telegram", externalUserId: "888001" },
    });

    const hookRes = await request.post(`${API}/api/v1/webhooks/telegram`, {
      headers: { "x-telegram-secret": "e2e-tg-secret" },
      data: {
        message: { text: "/dev status", chat: { id: 888001 } },
      },
    });
    expect([200, 202]).toContain(hookRes.status());
  });
});

test.describe("P5 — diff API (E2E smoke)", () => {
  test("파일 생성 후 diff 조회", async ({ request }) => {
    const projectRes = await request.post(`${API}/api/v1/projects`, {
      headers: AUTH,
      data: { name: `e2e-git-${Date.now()}` },
    });
    const { projectId } = (await projectRes.json()) as { projectId: string };

    await request.put(`${API}/api/v1/projects/${projectId}/file`, {
      headers: AUTH,
      data: { path: "e2e.txt", content: "hello e2e" },
    });

    const diffRes = await request.get(`${API}/api/v1/projects/${projectId}/diff`, {
      headers: AUTH,
    });
    expect(diffRes.ok()).toBeTruthy();
    const diff = (await diffRes.json()) as { changes: Array<{ path: string }> };
    expect(diff.changes.some((c) => c.path === "e2e.txt")).toBe(true);
  });
});

test.describe("Health (ops)", () => {
  test("scheduler metrics in health", async ({ request }) => {
    const res = await request.get(`${API}/health`);
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as {
      scheduler: { maxConcurrent: number };
      exec: { sandboxMode: string };
    };
    expect(body.scheduler.maxConcurrent).toBe(3);
    expect(body.exec.sandboxMode).toBeTruthy();
  });
});

test.describe("P5 — diff review (E2E smoke)", () => {
  test("commit clears diff", async ({ request }) => {
    const projectRes = await request.post(`${API}/api/v1/projects`, {
      headers: AUTH,
      data: { name: `e2e-commit-${Date.now()}` },
    });
    const { projectId } = (await projectRes.json()) as { projectId: string };

    await request.put(`${API}/api/v1/projects/${projectId}/file`, {
      headers: AUTH,
      data: { path: "review.txt", content: "review me" },
    });

    const diffBefore = await request.get(
      `${API}/api/v1/projects/${projectId}/diff`,
      { headers: AUTH },
    );
    const before = (await diffBefore.json()) as { changes: unknown[] };
    expect(before.changes.length).toBeGreaterThan(0);

    const commitRes = await request.post(
      `${API}/api/v1/projects/${projectId}/commit`,
      {
        headers: AUTH,
        data: { message: "e2e commit", paths: ["review.txt"] },
      },
    );
    expect(commitRes.ok()).toBeTruthy();

    const diffAfter = await request.get(
      `${API}/api/v1/projects/${projectId}/diff`,
      { headers: AUTH },
    );
    const after = (await diffAfter.json()) as { changes: Array<{ path: string }> };
    expect(after.changes.filter((c) => c.path === "review.txt")).toHaveLength(0);
  });
});
