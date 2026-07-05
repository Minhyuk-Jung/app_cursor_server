import { test, expect } from "@playwright/test";

export const SHARED_RUNTIME_API =
  process.env.E2E_API_URL ?? "http://127.0.0.1:3098";
export const SHARED_RUNTIME_AUTH = { authorization: "Bearer dev-local-key" };

export async function assertSharedRuntimeSandbox(
  request: import("@playwright/test").APIRequestContext,
): Promise<void> {
  const res = await request.get(`${SHARED_RUNTIME_API}/health`);
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as {
    sandbox?: {
      dockerAvailable?: boolean;
      mode?: string;
      adr007Phase?: string;
      sdkRunsOnHost?: boolean;
    };
  };
  const ready =
    body.sandbox?.dockerAvailable === true &&
    body.sandbox.mode === "docker" &&
    body.sandbox.adr007Phase === "shared-runtime" &&
    body.sandbox.sdkRunsOnHost === false;
  if (!ready) {
    if (process.env.CI === "1") {
      throw new Error("shared-runtime sandbox required (P6→P7 gate)");
    }
    test.skip(true, "shared-runtime sandbox not available");
  }
}

export function requireCursorApiKey(): void {
  if (!process.env.CURSOR_API_KEY) {
    test.skip(true, "CURSOR_API_KEY not set");
  }
}

export async function createProjectSession(
  request: import("@playwright/test").APIRequestContext,
  options?: { projectName?: string; sessionTitle?: string },
): Promise<{ projectId: string; sessionId: string; projectName: string }> {
  const projectName = options?.projectName ?? `e2e-rt-${Date.now()}`;
  const sessionTitle = options?.sessionTitle ?? "e2e-shared-runtime";

  const projectRes = await request.post(`${SHARED_RUNTIME_API}/api/v1/projects`, {
    headers: SHARED_RUNTIME_AUTH,
    data: { name: projectName },
  });
  expect(projectRes.ok()).toBeTruthy();
  const { projectId } = (await projectRes.json()) as { projectId: string };

  const sessionRes = await request.post(
    `${SHARED_RUNTIME_API}/api/v1/projects/${projectId}/sessions`,
    {
      headers: SHARED_RUNTIME_AUTH,
      data: { model: "composer-2.5", title: sessionTitle },
    },
  );
  expect(sessionRes.ok()).toBeTruthy();
  const { sessionId } = (await sessionRes.json()) as { sessionId: string };
  return { projectId, sessionId, projectName };
}

export async function sendPrompt(
  request: import("@playwright/test").APIRequestContext,
  sessionId: string,
  text: string,
): Promise<string> {
  const msgRes = await request.post(
    `${SHARED_RUNTIME_API}/api/v1/sessions/${sessionId}/messages`,
    {
      headers: SHARED_RUNTIME_AUTH,
      data: { text },
      timeout: 240_000,
    },
  );
  expect([200, 202]).toContain(msgRes.status());
  const { runId } = (await msgRes.json()) as { runId: string };
  expect(runId).toBeTruthy();
  return runId;
}

export async function waitForRunTerminal(
  request: import("@playwright/test").APIRequestContext,
  sessionId: string,
  runId: string,
  expectStatus?: "finished" | "error" | "cancelled",
): Promise<{ runDoneCount: number; hasAssistant: boolean }> {
  const deadline = Date.now() + 240_000;
  let runDoneCount = 0;
  let hasAssistant = false;
  let lastStatus: string | undefined;

  while (Date.now() < deadline) {
    const replayRes = await request.get(
      `${SHARED_RUNTIME_API}/api/v1/events/replay?scope=session&scopeId=${sessionId}&cursor=0`,
      { headers: SHARED_RUNTIME_AUTH },
    );
    expect(replayRes.ok()).toBeTruthy();
    const body = (await replayRes.json()) as {
      events: Array<{
        event: { type: string; runId?: string; status?: string };
      }>;
    };
    const forRun = body.events.filter((e) => e.event.runId === runId);
    runDoneCount = forRun.filter((e) => e.event.type === "run_done").length;
    hasAssistant = forRun.some((e) => e.event.type === "assistant");
    const done = forRun.find((e) => e.event.type === "run_done");
    lastStatus = done?.event.status;
    if (runDoneCount >= 1) {
      if (!expectStatus || lastStatus === expectStatus) break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  if (expectStatus) {
    expect(lastStatus).toBe(expectStatus);
  }
  return { runDoneCount, hasAssistant };
}
