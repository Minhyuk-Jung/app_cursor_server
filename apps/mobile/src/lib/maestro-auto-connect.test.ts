import { describe, expect, it, vi } from "vitest";
import { tryMaestroAutoConnect } from "./maestro-auto-connect";

const DEFAULT_SETTINGS = {
  apiBaseUrl: "http://127.0.0.1:3000",
  apiKey: "dev-local-key",
};

describe("tryMaestroAutoConnect", () => {
  it("returns null when disabled", async () => {
    const deps = {
      checkHealth: vi.fn(),
      verifyApiAccess: vi.fn(),
      saveSettings: vi.fn(),
      sleepMs: vi.fn(),
    };
    const result = await tryMaestroAutoConnect(false, DEFAULT_SETTINGS, deps);
    expect(result).toBeNull();
  });

  it("connects on first healthy attempt", async () => {
    const saveSettings = vi.fn(async () => {});
    const result = await tryMaestroAutoConnect(true, DEFAULT_SETTINGS, {
      checkHealth: vi.fn(async () => true),
      verifyApiAccess: vi.fn(async () => {}),
      saveSettings,
      sleepMs: vi.fn(async () => {}),
    });
    expect(result).toEqual(DEFAULT_SETTINGS);
    expect(saveSettings).toHaveBeenCalledWith(DEFAULT_SETTINGS);
  });

  it("retries until verify succeeds", async () => {
    let verifyCalls = 0;
    const sleepMs = vi.fn(async () => {});
    const result = await tryMaestroAutoConnect(true, DEFAULT_SETTINGS, {
      checkHealth: vi.fn(async () => true),
      verifyApiAccess: vi.fn(async () => {
        verifyCalls += 1;
        if (verifyCalls < 3) throw new Error("not ready");
      }),
      saveSettings: vi.fn(async () => {}),
      sleepMs,
    });
    expect(result).toEqual(DEFAULT_SETTINGS);
    expect(verifyCalls).toBe(3);
    expect(sleepMs).toHaveBeenCalled();
  });

  it("returns null after max attempts", async () => {
    const result = await tryMaestroAutoConnect(true, DEFAULT_SETTINGS, {
      checkHealth: vi.fn(async () => false),
      verifyApiAccess: vi.fn(async () => {}),
      saveSettings: vi.fn(async () => {}),
      sleepMs: vi.fn(async () => {}),
    });
    expect(result).toBeNull();
  });
});
