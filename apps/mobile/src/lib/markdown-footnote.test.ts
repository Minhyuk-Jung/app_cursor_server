import { extractFootnoteDefinitions } from "@app/shared";
import { describe, expect, it } from "vitest";
import { footnoteRefLabel, isFootnoteRefActive } from "./markdown-footnote";

describe("markdown-footnote (22차 — mobile GFM parity)", () => {
  it("uses footnote id as superscript label", () => {
    expect(footnoteRefLabel("note")).toBe("note");
    expect(footnoteRefLabel("1")).toBe("1");
  });

  it("detects active footnote refs from shared extract", () => {
    const { body, footnotes } = extractFootnoteDefinitions(
      "Hello[^note]\n\n[^note]: GFM footnote body",
    );
    expect(body).toContain("[^note]");
    expect(isFootnoteRefActive("note", footnotes)).toBe(true);
    expect(isFootnoteRefActive("missing", footnotes)).toBe(false);
    expect(footnotes.note).toBe("GFM footnote body");
  });
});
