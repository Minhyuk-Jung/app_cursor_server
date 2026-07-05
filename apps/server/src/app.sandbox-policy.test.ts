import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { disconnectDb } from "./db/client.js";

describe("createApp sandbox policy (R-01)", () => {
  afterEach(async () => {
    vi.unstubAllEnvs();
    await disconnectDb();
  });

  it("rejects subprocess override in production", async () => {
    vi.stubEnv("NODE_ENV", "production");

    await expect(createApp({ sandboxMode: "subprocess" })).rejects.toThrow(
      /subprocess mode is not allowed|requires Docker/,
    );
  });
});
