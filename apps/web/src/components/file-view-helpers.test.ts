import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./file-view-helpers";

describe("renderMarkdown (20차 — mobile parity)", () => {
  it("renders bold with inner italic", () => {
    const html = renderMarkdown("**bold *inner* text**");
    expect(html).toContain("<strong>bold <em>inner</em> text</strong>");
  });

  it("renders links, autolink, and sanitizes unsafe href", () => {
    const html = renderMarkdown(
      "see [docs](https://x.test) and www.example.com and [bad](javascript:alert(1))",
    );
    expect(html).toContain('<a href="https://x.test"');
    expect(html).toContain('href="https://www.example.com"');
    expect(html).not.toMatch(/href="javascript:/);
  });

  it("renders GFM task, ordered list, strikethrough", () => {
    const html = renderMarkdown("- [ ] todo\n- [x] done\n1. first\n~~removed~~");
    expect(html).toContain('class="md-task"');
    expect(html).toContain("☐ todo");
    expect(html).toContain('class="md-ordered"');
    expect(html).toContain("<del>removed</del>");
  });

  it("renders code blocks, tables, blockquote, preserves blank lines", () => {
    const md = [
      "> quote line",
      "",
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 |",
      "",
      "```ts",
      "const x = 1;",
      "```",
    ].join("\n");
    const html = renderMarkdown(md);
    expect(html).toContain('class="md-blockquote"');
    expect(html).toContain('class="md-table"');
    expect(html).toContain('class="md-code-block"');
    expect(html).toContain("const x = 1;");
    expect(html).toContain('class="md-spacer"');
  });

  it("renders markdown images with safe href only", () => {
    const html = renderMarkdown("![logo](https://img.test/x.png)");
    expect(html).toContain('class="md-image"');
    expect(html).toContain('src="https://img.test/x.png"');
  });

  it("renders GFM footnotes (21차)", () => {
    const html = renderMarkdown("Text[^1]\n\n[^1]: note body");
    expect(html).toContain('class="md-fn-ref"');
    expect(html).toContain('class="md-footnotes"');
    expect(html).toContain("note body");
  });
});
