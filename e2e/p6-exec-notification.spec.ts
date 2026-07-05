import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";

const API = process.env.E2E_API_URL ?? "http://127.0.0.1:3097";
const AUTH = { authorization: "Bearer dev-local-key" };

const slowCmd =
  process.platform === "win32"
    ? "powershell -Command Start-Sleep -Seconds 5"
    : "sleep 5";

test.describe("S17+S9 — exec_timeout 인박스 (13 §9, 21-test-strategy)", () => {
  test("exec_command 시간 초과 시 인박스에 exec_timeout 알림", async ({
    request,
  }) => {
    const projectRes = await request.post(`${API}/api/v1/projects`, {
      headers: AUTH,
      data: { name: `e2e-exec-notif-${Date.now()}` },
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
    const execBody = (await execRes.json()) as {
      exitCode: number;
      errorCode?: string;
    };
    expect(execBody.exitCode).toBe(124);
    expect(execBody.errorCode).toBe("exec_timeout");

    const deadline = Date.now() + 10_000;
    let note: {
      kind: string;
      projectId?: string;
      deeplink: string;
    } | undefined;
    while (Date.now() < deadline) {
      const inboxRes = await request.get(`${API}/api/v1/inbox`, {
        headers: AUTH,
      });
      expect(inboxRes.ok()).toBeTruthy();
      const body = (await inboxRes.json()) as {
        items: Array<{
          kind: string;
          projectId?: string;
          deeplink: string;
        }>;
      };
      note = body.items.find(
        (i) => i.kind === "exec_timeout" && i.projectId === projectId,
      );
      if (note) break;
      await new Promise((r) => setTimeout(r, 200));
    }

    expect(note).toBeTruthy();
    expect(note!.deeplink).toBe(`/project/${projectId}/terminal`);
  });

  test("동일 프로젝트 exec_timeout dedup — 5분 창에 알림 1건 (09 §6.2)", async ({
    request,
  }) => {
    const projectRes = await request.post(`${API}/api/v1/projects`, {
      headers: AUTH,
      data: { name: `e2e-exec-dedup-${Date.now()}` },
    });
    expect(projectRes.ok()).toBeTruthy();
    const { projectId } = (await projectRes.json()) as { projectId: string };

    for (let i = 0; i < 2; i++) {
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
    }

    const deadline = Date.now() + 12_000;
    let count = 0;
    while (Date.now() < deadline) {
      const inboxRes = await request.get(`${API}/api/v1/inbox`, {
        headers: AUTH,
      });
      const body = (await inboxRes.json()) as {
        items: Array<{ kind: string; projectId?: string }>;
      };
      count = body.items.filter(
        (i) => i.kind === "exec_timeout" && i.projectId === projectId,
      ).length;
      if (count >= 1) break;
      await new Promise((r) => setTimeout(r, 300));
    }

    expect(count).toBe(1);
  });
});
