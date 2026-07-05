import { describe, expect, it } from "vitest";
import { NotificationKind } from "./notification-engine.js";
import { NotificationEngine } from "./notification-engine.js";
import { InboxHub } from "./inbox-hub.js";

describe("NotificationEngine", () => {
  it("bypasses quiet hours push for error only (09 §6.3)", () => {
    const engine = new NotificationEngine(new InboxHub(), {
      quietHoursStart: 0,
      quietHoursEnd: 24,
    });
    expect(engine.shouldSuppressPush("error")).toBe(false);
    expect(engine.shouldSuppressPush("approval_required")).toBe(true);
  });

  it("suppresses run_done push during quiet hours", () => {
    const engine = new NotificationEngine(new InboxHub(), {
      quietHoursStart: 0,
      quietHoursEnd: 24,
    });
    expect(engine.shouldSuppressPush("run_done")).toBe(true);
  });

  it("allows run_done push outside quiet hours", () => {
    const hour = new Date().getHours();
    const engine = new NotificationEngine(new InboxHub(), {
      quietHoursStart: (hour + 2) % 24,
      quietHoursEnd: (hour + 4) % 24,
    });
    expect(engine.shouldSuppressPush("run_done")).toBe(false);
  });

  it("defines exec resource limit notifications (13 §9)", () => {
    expect(NotificationEngine.prototype.notifyExecResourceLimit).toBeTypeOf(
      "function",
    );
    expect(NotificationEngine.prototype.notifyExecTimeout).toBeTypeOf(
      "function",
    );
  });

  it("defines git_status kind for git deeplink (16차)", () => {
    expect(NotificationKind.GIT_STATUS).toBe("git_status");
  });
});
