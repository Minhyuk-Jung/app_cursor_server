import { describe, expect, it } from "vitest";
import { msUntilQuietHoursEnd } from "./quiet-hours.js";

describe("quiet hours timing", () => {
  it("returns positive ms when inside daytime quiet window", () => {
    const now = new Date("2026-07-04T14:00:00");
    const ms = msUntilQuietHoursEnd(9, 18, now);
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThanOrEqual(4 * 60 * 60 * 1000);
  });

  it("returns 0 outside quiet window", () => {
    const now = new Date("2026-07-04T20:00:00");
    expect(msUntilQuietHoursEnd(9, 18, now)).toBe(0);
  });
});
