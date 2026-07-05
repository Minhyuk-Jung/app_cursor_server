import { describe, expect, it, vi } from "vitest";
import { createApiFetch } from "./api-fetch.js";

describe("createApiFetch", () => {
  it("merges auth headers and retries once on 401", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 401 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const refresh = vi.fn(async (s: { token: string }) => ({
      token: `${s.token}-refreshed`,
    }));
    const apiFetch = createApiFetch({
      buildHeaders: (s) => ({ Authorization: `Bearer ${s.token}` }),
      shouldRetryAuth: (_url, res) => res.status === 401,
      refreshSettings: refresh,
    });

    const res = await apiFetch({ token: "a" }, "http://test/api");
    expect(res.status).toBe(200);
    expect(refresh).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[1]![1]?.headers).toMatchObject({
      Authorization: "Bearer a-refreshed",
    });

    vi.unstubAllGlobals();
  });
});
