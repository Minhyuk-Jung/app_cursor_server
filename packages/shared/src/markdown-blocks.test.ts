import { describe, expect, it } from "vitest";
import {
  isHorizontalRule,
  parseMarkdownTable,
  splitMarkdownBlocks,
} from "./markdown-blocks.js";

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

  it("parses markdown tables", () => {
    const lines = ["| A | B |", "| --- | --- |", "| 1 | 2 |"];
    const parsed = parseMarkdownTable(lines, 0);
    expect(parsed?.table.headers).toEqual(["A", "B"]);
    expect(parsed?.table.rows).toEqual([["1", "2"]]);
  });

  it("detects horizontal rules", () => {
    expect(isHorizontalRule("---")).toBe(true);
    expect(isHorizontalRule("text")).toBe(false);
  });
});
