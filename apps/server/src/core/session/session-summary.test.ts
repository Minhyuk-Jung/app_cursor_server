import { describe, expect, it } from "vitest";
import {
  buildRuleBasedSessionSummary,
  formatSummaryTranscript,
  resolveSessionSummary,
} from "./session-summary.js";

describe("session-summary (UR-16 / S19)", () => {
  it("buildRuleBasedSessionSummary includes user and assistant", () => {
    const summary = buildRuleBasedSessionSummary([
      { role: "user", content: "fix auth bug" },
      { role: "assistant", content: "Updated login handler" },
    ]);
    expect(summary).toContain("요청: fix auth bug");
    expect(summary).toContain("결과: Updated login handler");
  });

  it("counts attachments in rule-based summary", () => {
    const summary = buildRuleBasedSessionSummary([
      {
        role: "user",
        content: "screenshot",
        attachmentsJson: JSON.stringify([{ ref: "a" }, { ref: "b" }]),
      },
    ]);
    expect(summary).toContain("첨부 2개");
  });

  it("formatSummaryTranscript orders chronologically", () => {
    const text = formatSummaryTranscript([
      { role: "assistant", content: "done" },
      { role: "user", content: "go" },
    ]);
    expect(text.indexOf("user:")).toBeLessThan(text.indexOf("assistant:"));
  });

  it("resolveSessionSummary prefers llm when enabled", async () => {
    const prev = process.env.SESSION_SUMMARY_LLM;
    process.env.SESSION_SUMMARY_LLM = "true";
    const summary = await resolveSessionSummary(
      [{ role: "user", content: "hello" }],
      {
        llm: {
          sdk: {} as never,
          apiKey: "key",
          session: {
            model: "composer-2.5",
            project: { id: "p1", rootPath: "/tmp" },
          },
          tryLlm: async () => "LLM 한 줄 요약",
        },
      },
    );
    process.env.SESSION_SUMMARY_LLM = prev;
    expect(summary).toBe("LLM 한 줄 요약");
  });

  it("resolveSessionSummary falls back to rule-based on llm failure", async () => {
    const prev = process.env.SESSION_SUMMARY_LLM;
    process.env.SESSION_SUMMARY_LLM = "true";
    const summary = await resolveSessionSummary(
      [{ role: "user", content: "fallback test" }],
      {
        llm: {
          sdk: {} as never,
          apiKey: "key",
          session: {
            model: "composer-2.5",
            project: { id: "p1", rootPath: "/tmp" },
          },
          tryLlm: async () => {
            throw new Error("sdk down");
          },
        },
      },
    );
    process.env.SESSION_SUMMARY_LLM = prev;
    expect(summary).toContain("fallback test");
  });
});
