import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp, shutdownApp, type AppContext } from "../app.js";
import { disconnectDb } from "../db/client.js";
import { useTestDatabase } from "../test-helpers/db.js";

const AUTH = { authorization: "Bearer dev-local-key" };

describe("POST /stt/transcribe (UR-15 server fallback)", () => {
  let ctx: AppContext;

  beforeAll(async () => {
    await useTestDatabase("file:./test-stt-stub.db");
    process.env.STT_STUB = "true";
    ctx = await createApp({ port: 0, sandboxMode: "subprocess" });
  });

  afterAll(async () => {
    delete process.env.STT_STUB;
    await ctx.telegramPullPoller?.stop();
    await ctx.intranetPullPoller?.stop();
    await shutdownApp(ctx);
    await ctx.app.close();
    await disconnectDb();
  });

  it("returns stub transcript from header when STT_STUB=true", async () => {
    const boundary = "----sttAudio";
    const payload = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="voice.webm"',
      "Content-Type: audio/webm",
      "",
      "fake-audio",
      `--${boundary}--`,
      "",
    ].join("\r\n");

    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/stt/transcribe",
      headers: {
        ...AUTH,
        "content-type": `multipart/form-data; boundary=${boundary}`,
        "x-stt-stub-transcript": "hello from server stt",
      },
      payload,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { transcript: string };
    expect(body.transcript).toBe("hello from server stt");
  });

  it("returns error when STT is not configured", async () => {
    const prev = process.env.STT_STUB;
    delete process.env.STT_STUB;
    delete process.env.STT_API_URL;
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/stt/transcribe",
      headers: AUTH,
      payload: {},
    });
    if (prev) process.env.STT_STUB = prev;
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it("forwards audio to STT_API_URL when configured", async () => {
    const prevStub = process.env.STT_STUB;
    const prevUrl = process.env.STT_API_URL;
    delete process.env.STT_STUB;
    process.env.STT_API_URL = "https://stt.example/transcribe";

    const fetchMock = vi.fn(async () =>
      Response.json({ text: "transcribed hello" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const boundary = "----sttUpstream";
    const payload = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="voice.webm"',
      "Content-Type: audio/webm",
      "",
      "fake-audio",
      `--${boundary}--`,
      "",
    ].join("\r\n");

    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/stt/transcribe",
      headers: {
        ...AUTH,
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    });

    vi.unstubAllGlobals();
    if (prevStub) process.env.STT_STUB = prevStub;
    else delete process.env.STT_STUB;
    if (prevUrl) process.env.STT_API_URL = prevUrl;
    else delete process.env.STT_API_URL;

    expect(res.statusCode).toBe(200);
    const body = res.json() as { transcript: string };
    expect(body.transcript).toBe("transcribed hello");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://stt.example/transcribe",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
