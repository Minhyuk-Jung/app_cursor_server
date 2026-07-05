import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";

const API = process.env.E2E_API_URL ?? "http://127.0.0.1:3095";
const AUTH = { authorization: "Bearer dev-local-key" };

const memoryBombCmd =
  'node -e "const b=[];for(;;)b.push(Buffer.alloc(1024*1024))"';

test.describe("S17+S9 — exec_memory_limit 인박스 (13 §9, docker)", () => {
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
          "Docker sandbox required for exec_memory_limit E2E (P6 gate)",
        );
      }
      test.skip(true, "Docker sandbox not available locally");
    }
  });

  test("exec_command 메모리 상한 초과 시 인박스에 exec_memory_limit 알림", async ({
    request,
  }) => {
    const projectRes = await request.post(`${API}/api/v1/projects`, {
      headers: AUTH,
      data: { name: `e2e-exec-mem-${Date.now()}` },
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
      timeout: 90_000,
    });
    if (!execRes.ok()) {
      const errBody = await execRes.text();
      throw new Error(`exec_command failed (${execRes.status()}): ${errBody}`);
    }
    const execBody = (await execRes.json()) as {
      exitCode: number;
      errorCode?: string;
    };
    expect(execBody.exitCode).not.toBe(0);
    expect(execBody.errorCode).toBe("exec_memory_limit");

    const deadline = Date.now() + 15_000;
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
        (i) => i.kind === "exec_memory_limit" && i.projectId === projectId,
      );
      if (note) break;
      await new Promise((r) => setTimeout(r, 200));
    }

    expect(note).toBeTruthy();
    expect(note!.deeplink).toBe(`/project/${projectId}/terminal`);
  });
});
