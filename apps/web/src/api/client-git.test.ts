import { describe, expect, it, vi } from "vitest";
import { getProjectGit } from "./client.js";
import type { AppSettings } from "../config.js";

const settings: AppSettings = {
  apiBaseUrl: "http://test.local",
  apiKey: "test-key",
};

describe("web getProjectGit (17차)", () => {
  it("fetches git status from shared projectGitPath", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        branch: "main",
        dirty: true,
        changedCount: 2,
        stagedCount: 1,
        unstagedCount: 1,
        lastCommitMessage: "init",
        ahead: null,
        behind: null,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const status = await getProjectGit(settings, "p1");
    expect(status.branch).toBe("main");
    expect(status.stagedCount).toBe(1);
    expect(fetchMock.mock.calls[0]![0]).toBe(
      "http://test.local/api/v1/projects/p1/git",
    );

    vi.unstubAllGlobals();
  });
});
