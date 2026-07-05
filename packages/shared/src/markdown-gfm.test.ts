import { describe, expect, it } from "vitest";
import {
  extractFootnoteDefinitions,
  isTaskListLine,
  matchStrikethrough,
  parseOrderedListLine,
  parseTaskListLine,
  sanitizeMarkdownLinkHref,
} from "./markdown-gfm.js";

describe("markdown-gfm", () => {
  it("parses unchecked and checked task list lines", () => {
    expect(parseTaskListLine("- [ ] todo item")).toEqual({
      checked: false,
      text: "todo item",
    });
    expect(parseTaskListLine("* [X] done item")).toEqual({
      checked: true,
      text: "done item",
    });
    expect(parseTaskListLine("- plain bullet")).toBeNull();
  });

  it("detects task list lines", () => {
    expect(isTaskListLine("- [ ] x")).toBe(true);
    expect(isTaskListLine("not a task")).toBe(false);
  });

  it("matches strikethrough tokens", () => {
    expect(matchStrikethrough("~~removed~~")).toBe("removed");
    expect(matchStrikethrough("plain")).toBeNull();
  });

  it("parses ordered list lines", () => {
    expect(parseOrderedListLine("1. first")).toEqual({ index: 1, text: "first" });
    expect(parseOrderedListLine("  2. second")).toEqual({ index: 2, text: "second" });
  });

  it("sanitizes markdown link hrefs", () => {
    expect(sanitizeMarkdownLinkHref("https://x.test/a")).toBe("https://x.test/a");
    expect(sanitizeMarkdownLinkHref("javascript:alert(1)")).toBeNull();
  });

  it("extracts footnote definitions", () => {
    const { body, footnotes } = extractFootnoteDefinitions(
      "Hello[^1]\n\n[^1]: footnote text",
    );
    expect(body.trimEnd()).toBe("Hello[^1]");
    expect(footnotes).toEqual({ "1": "footnote text" });
  });
});
