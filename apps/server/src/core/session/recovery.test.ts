import { describe, expect, it, vi, beforeEach } from "vitest";
import { RunStatus as RunStatusEnum } from "@app/shared";

const appendMock = vi.fn();

vi.mock("../../db/client.js", () => ({
  prisma: {
    run: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: "run-stale",
          sessionId: "sess-1",
          status: RunStatusEnum.RUNNING,
          session: { projectId: "proj-1" },
        },
      ]),
    },
  },
}));

vi.mock("../sdk/sdk-adapter.js", () => ({
  runErrorEvent: (runId: string, message: string) => ({
    type: "error",
    runId,
    message,
    retryable: true,
  }),
  runDoneEvent: (runId: string, status: string) => ({
    type: "run_done",
    runId,
    status,
  }),
}));

import { recoverStaleRuns } from "./recovery.js";

describe("recoverStaleRuns (CH-03)", () => {
  beforeEach(() => {
    appendMock.mockClear();
  });

  it("marks stale runs as error on startup", async () => {
    const count = await recoverStaleRuns({ append: appendMock });
    expect(count).toBe(1);
    expect(appendMock).toHaveBeenCalledTimes(2);
  });
});
