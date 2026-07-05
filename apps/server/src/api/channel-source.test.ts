import { describe, expect, it } from "vitest";
import { resolveCommandSource } from "./channel-source.js";

function req(header?: string) {
  return {
    headers: header === undefined ? {} : { "x-channel-source": header },
  } as Parameters<typeof resolveCommandSource>[0];
}

describe("resolveCommandSource", () => {
  it("returns mobile when X-Channel-Source is mobile", () => {
    expect(resolveCommandSource(req("mobile"))).toBe("mobile");
  });

  it("defaults to web for unknown or missing header", () => {
    expect(resolveCommandSource(req())).toBe("web");
    expect(resolveCommandSource(req("desktop"))).toBe("web");
  });

  it("trims whitespace", () => {
    expect(resolveCommandSource(req("  mobile  "))).toBe("mobile");
  });
});
