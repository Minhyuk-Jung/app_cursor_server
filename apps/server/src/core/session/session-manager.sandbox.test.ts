import { describe, expect, it, vi, beforeEach } from "vitest";
import { SessionManager } from "./session-manager.js";
import type { RunEventLog } from "../eventlog/types.js";
import type { SdkAdapter, SdkAgentHandle } from "../sdk/sdk-adapter.js";

const mockAgent: SdkAgentHandle = {
  agentId: "agent-test-1",
  send: vi.fn(),
  dispose: vi.fn(),
};

vi.mock("../../db/client.js", () => ({
  prisma: {
    session: {
      create: vi.fn().mockResolvedValue({
        id: "sess-1",
        projectId: "proj-1",
        model: "composer-2.5",
        status: "idle",
        agentId: "agent-test-1",
      }),
    },
  },
}));

describe("SessionManager sandbox (ADR-007 shared-path)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("prepareProjectSandbox before SDK Agent.create on createSession", async () => {
    const prepareProjectSandbox = vi.fn();
    const createAgent = vi.fn().mockResolvedValue(mockAgent);
    const sdk = { createAgent } as unknown as SdkAdapter;
    const eventLog = { append: vi.fn() } as unknown as RunEventLog;

    const mgr = new SessionManager({
      eventLog,
      sdk,
      apiKey: "test-key",
      agentCacheMax: 4,
      prepareProjectSandbox,
    });

    await mgr.createSession(
      "proj-1",
      "composer-2.5",
      "/tmp/ws-proj-1",
      "web",
      "test",
    );

    expect(prepareProjectSandbox).toHaveBeenCalledWith(
      "proj-1",
      "/tmp/ws-proj-1",
    );
    expect(createAgent).toHaveBeenCalled();
  });
});
