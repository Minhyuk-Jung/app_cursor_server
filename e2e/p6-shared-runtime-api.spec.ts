import { test, expect } from "@playwright/test";
import {
  assertSharedRuntimeSandbox,
  createProjectSession,
  requireCursorApiKey,
  sendPrompt,
  SHARED_RUNTIME_API,
  SHARED_RUNTIME_AUTH,
  waitForRunTerminal,
} from "./p6-shared-runtime-helpers.js";

test.describe("P6→P7 — shared-runtime SessionManager API (04+05)", () => {
  test.beforeAll(async ({ request }) => {
    await assertSharedRuntimeSandbox(request);
  });

  test("create_session + send_prompt → run_done 1회 (RunEventLog replay)", async ({
    request,
  }) => {
    requireCursorApiKey();
    const { sessionId } = await createProjectSession(request);
    const runId = await sendPrompt(
      request,
      sessionId,
      "Reply with exactly: e2e-poc3-ok",
    );
    const { runDoneCount, hasAssistant } = await waitForRunTerminal(
      request,
      sessionId,
      runId,
    );
    expect(hasAssistant).toBe(true);
    expect(runDoneCount).toBe(1);
  });

  test("2nd send reuses session agent cache (resume+cache, 05 §12)", async ({
    request,
  }) => {
    requireCursorApiKey();
    const { sessionId } = await createProjectSession(request);
    const run1 = await sendPrompt(request, sessionId, "Say hello in one word.");
    await waitForRunTerminal(request, sessionId, run1);

    const run2 = await sendPrompt(
      request,
      sessionId,
      "Say goodbye in one word.",
    );
    const { runDoneCount, hasAssistant } = await waitForRunTerminal(
      request,
      sessionId,
      run2,
    );
    expect(hasAssistant).toBe(true);
    expect(runDoneCount).toBe(1);
  });

  test("cancel run → run_done cancelled (04 §6.6, 05 §12)", async ({
    request,
  }) => {
    requireCursorApiKey();
    const { sessionId } = await createProjectSession(request);
    const runId = await sendPrompt(
      request,
      sessionId,
      "Write a very long essay about software architecture with at least 5000 words. Do not stop early.",
    );

    await new Promise((r) => setTimeout(r, 500));
    const cancelRes = await request.post(
      `${SHARED_RUNTIME_API}/api/v1/runs/${runId}/cancel`,
      { headers: SHARED_RUNTIME_AUTH },
    );
    expect(cancelRes.status()).toBeLessThan(300);

    const { runDoneCount } = await waitForRunTerminal(
      request,
      sessionId,
      runId,
      "cancelled",
    );
    expect(runDoneCount).toBe(1);
  });
});
