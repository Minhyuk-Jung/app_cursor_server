import { describe, expect, it } from "vitest";
import { RateLimiter } from "./rate-limit.js";

describe("RateLimiter (02 §11)", () => {
  it("allows requests under limit", () => {
    const limiter = new RateLimiter(3, 60_000);
    expect(limiter.check("k").allowed).toBe(true);
    expect(limiter.check("k").allowed).toBe(true);
    expect(limiter.check("k").allowed).toBe(true);
  });

  it("blocks requests over limit", () => {
    const limiter = new RateLimiter(2, 60_000);
    limiter.check("k");
    limiter.check("k");
    const blocked = limiter.check("k");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });
});
