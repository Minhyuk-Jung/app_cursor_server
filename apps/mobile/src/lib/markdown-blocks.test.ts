import { describe, expect, it } from "vitest";
import {
  AUTOLINK_RE,
  BOLD_RE,
  IMAGE_RE,
  INLINE_RE,
  ITALIC_RE,
  LINK_RE,
  UNDERSCORE_ITALIC_RE,
  isBlockquoteLine,
  isHorizontalRule,
  parseMarkdownTable,
  splitMarkdownBlocks,
  STRIKETHROUGH_TOKEN_RE,
  stripBlockquote,
} from "./markdown-blocks";

describe("markdown-blocks", () => {
  it("splits fenced code blocks", () => {
    const blocks = splitMarkdownBlocks("hello\n```ts\nconst x = 1;\n```\nworld");
    expect(blocks).toHaveLength(3);
    expect(blocks[1]).toMatchObject({
      kind: "code",
      lang: "ts",
      content: "const x = 1;\n",
    });
  });

  it("matches markdown links and images in inline pattern", () => {
    expect("[docs](https://example.com)".match(LINK_RE)?.[1]).toBe("docs");
    expect("![logo](https://img.test/x.png)".match(IMAGE_RE)?.[2]).toBe(
      "https://img.test/x.png",
    );
    const parts = "text ![img](u) end".split(INLINE_RE);
    expect(parts.some((p) => IMAGE_RE.test(p))).toBe(true);
  });

  it("detects blockquote and horizontal rule", () => {
    expect(isBlockquoteLine("> quote")).toBe(true);
    expect(stripBlockquote("> quote")).toBe("quote");
    expect(isHorizontalRule("---")).toBe(true);
  });

  it("matches italic in inline pattern", () => {
    expect("*emphasis*".match(ITALIC_RE)?.[1]).toBe("emphasis");
    expect("_underscore_".match(UNDERSCORE_ITALIC_RE)?.[1]).toBe("underscore");
    const nested = "**bold *inner* text**";
    expect(nested.split(INLINE_RE)).toEqual(["", "**bold *inner* text**", ""]);
    expect(nested.match(BOLD_RE)?.[1]).toBe("bold *inner* text");
    expect("*inner*".match(ITALIC_RE)?.[1]).toBe("inner");
    expect("~~removed~~".split(INLINE_RE)).toEqual(["", "~~removed~~", ""]);
    expect("~~removed~~".match(STRIKETHROUGH_TOKEN_RE)?.[1]).toBe("removed");
  });

  it("splits autolink URLs including www", () => {
    const parts = "visit https://example.com/docs ok".split(AUTOLINK_RE);
    expect(parts).toEqual(["visit ", "https://example.com/docs", " ok"]);
    expect("www.example.com/page".split(AUTOLINK_RE)).toEqual([
      "",
      "www.example.com/page",
      "",
    ]);
  });

  it("parses markdown table rows", () => {
    const lines = [
      "| Name | Score |",
      "| --- | --- |",
      "| Alice | 10 |",
      "| Bob | 8 |",
    ];
    const parsed = parseMarkdownTable(lines, 0);
    expect(parsed?.table.headers).toEqual(["Name", "Score"]);
    expect(parsed?.table.rows).toEqual([
      ["Alice", "10"],
      ["Bob", "8"],
    ]);
    expect(parsed?.nextIndex).toBe(4);
  });
});
