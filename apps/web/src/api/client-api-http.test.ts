import { describe, expect, it, vi } from "vitest";
import { ApiError, listProjects } from "./client.js";
import type { AppSettings } from "../config.js";

const settings: AppSettings = {
  apiBaseUrl: "http://test.local",
  apiKey: "test-key",
};

describe("web api client parseResponse (13차 api-http)", () => {
  it("listProjects throws ApiError with AppError on 403", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          error: {
            code: "forbidden",
            message: "Insufficient scope",
            retryable: false,
          },
        }),
        { status: 403, statusText: "Forbidden" },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(listProjects(settings)).rejects.toSatisfy((e: unknown) => {
      expect(e).toBeInstanceOf(ApiError);
      const err = e as ApiError;
      expect(err.status).toBe(403);
      expect(err.appError.code).toBe("forbidden");
      expect(err.appError.message).toBe("Insufficient scope");
      expect(err.appError.retryable).toBe(false);
      return true;
    });

    vi.unstubAllGlobals();
  });

  it("listProjects returns projects on success", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ projects: [{ id: "p1", name: "demo", status: "active" }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const projects = await listProjects(settings);
    expect(projects).toHaveLength(1);
    expect(projects[0]!.id).toBe("p1");

    vi.unstubAllGlobals();
  });

  it("listApiKeys sends settings to apiFetch path", async () => {
    const fetchMock = vi.fn(async () => Response.json({ keys: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const { listApiKeys } = await import("./client.js");
    await listApiKeys(settings);
    expect(fetchMock.mock.calls[0]![0]).toBe(
      "http://test.local/api/v1/api-keys",
    );
    expect(fetchMock.mock.calls[0]![1]?.headers).toMatchObject({
      Authorization: "Bearer test-key",
    });

    vi.unstubAllGlobals();
  });
});
