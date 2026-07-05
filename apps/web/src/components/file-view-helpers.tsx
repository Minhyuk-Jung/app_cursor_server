import {
  extractFootnoteDefinitions,
  hasFootnoteDefinition,
  isBlockquoteLine,
  isHorizontalRule,
  parseMarkdownTable,
  parseOrderedListLine,
  parseTaskListLine,
  sanitizeMarkdownLinkHref,
  splitMarkdownBlocks,
  stripBlockquote,
} from "@app/shared";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function linkHtml(label: string, href: string): string {
  const safe = sanitizeMarkdownLinkHref(href);
  if (!safe) {
    return escapeHtml(label);
  }
  return `<a href="${escapeHtml(safe)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`;
}

function renderFootnoteRef(id: string, footnotes: Record<string, string>): string {
  if (!footnotes[id]) {
    return escapeHtml(`[^${id}]`);
  }
  return `<sup class="md-fn-ref"><a href="#fn-${escapeHtml(id)}">${escapeHtml(id)}</a></sup>`;
}

function renderInlineSpans(
  text: string,
  footnotes: Record<string, string> = {},
): string {
  const placeholders: string[] = [];
  const ph = (html: string) => {
    placeholders.push(html);
    return `\x00PH${placeholders.length - 1}\x00`;
  };

  let working = escapeHtml(text);

  working = working
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt: string, url: string) => {
      const safe = sanitizeMarkdownLinkHref(url);
      if (!safe) return escapeHtml(`![${alt}](${url})`);
      return ph(
        `<img class="md-image" src="${escapeHtml(safe)}" alt="${escapeHtml(alt)}" loading="lazy"/>`,
      );
    })
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label: string, url: string) =>
      ph(linkHtml(label, url)),
    )
    .replace(
      /((?:https?:\/\/|www\.)[^\s<]+[^\s<.,;:!?)}\]])/g,
      (url) => {
        const href = url.startsWith("www.") ? `https://${url}` : url;
        const safe = sanitizeMarkdownLinkHref(href);
        if (!safe) return escapeHtml(url);
        return ph(
          `<a href="${escapeHtml(safe)}" target="_blank" rel="noreferrer">${escapeHtml(url)}</a>`,
        );
      },
    )
    .replace(/\[\^([^\]]+)\]/g, (_m, id: string) =>
      ph(renderFootnoteRef(id, footnotes)),
    )
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/~~(.+?)~~/g, "<del>$1</del>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/_(.+?)_/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");

  return working.replace(/\x00PH(\d+)\x00/g, (_m, index: string) => {
    return placeholders[Number(index)] ?? "";
  });
}

function renderMarkdownLine(
  line: string,
  footnotes: Record<string, string>,
): string {
  if (hasFootnoteDefinition(line)) {
    return "";
  }
  const task = parseTaskListLine(line);
  if (task) {
    const mark = task.checked ? "☑" : "☐";
    const itemClass = task.checked ? "md-task md-task-done" : "md-task";
    return `<div class="${itemClass}">${mark} ${renderInlineSpans(task.text, footnotes)}</div>`;
  }
  const ordered = parseOrderedListLine(line);
  if (ordered) {
    return `<div class="md-ordered"><span class="md-ordered-index">${ordered.index}.</span> ${renderInlineSpans(ordered.text, footnotes)}</div>`;
  }
  if (line.startsWith("### ")) {
    return `<h3>${renderInlineSpans(line.slice(4), footnotes)}</h3>`;
  }
  if (line.startsWith("## ")) {
    return `<h2>${renderInlineSpans(line.slice(3), footnotes)}</h2>`;
  }
  if (line.startsWith("# ")) {
    return `<h1>${renderInlineSpans(line.slice(2), footnotes)}</h1>`;
  }
  if (isBlockquoteLine(line)) {
    return `<blockquote class="md-blockquote">${renderInlineSpans(stripBlockquote(line), footnotes)}</blockquote>`;
  }
  if (isHorizontalRule(line)) {
    return '<hr class="md-hr"/>';
  }
  if (line.startsWith("- ") || line.startsWith("* ")) {
    return `<div class="md-bullet">• ${renderInlineSpans(line.slice(2), footnotes)}</div>`;
  }
  if (!line.trim()) {
    return '<div class="md-spacer"></div>';
  }
  return `<p class="md-paragraph">${renderInlineSpans(line, footnotes)}</p>`;
}

function renderTextBlock(
  content: string,
  footnotes: Record<string, string>,
): string {
  const lines = content.split("\n");
  const parts: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const tableParsed = parseMarkdownTable(lines, index);
    if (tableParsed) {
      const { table } = tableParsed;
      const head = table.headers
        .map((cell) => `<th>${renderInlineSpans(cell, footnotes)}</th>`)
        .join("");
      const body = table.rows
        .map(
          (row) =>
            `<tr>${row.map((cell) => `<td>${renderInlineSpans(cell, footnotes)}</td>`).join("")}</tr>`,
        )
        .join("");
      parts.push(
        `<table class="md-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`,
      );
      index = tableParsed.nextIndex;
      continue;
    }
    parts.push(renderMarkdownLine(lines[index] ?? "", footnotes));
    index += 1;
  }
  return parts.join("");
}

function renderFootnotesSection(footnotes: Record<string, string>): string {
  const entries = Object.entries(footnotes);
  if (!entries.length) return "";
  const items = entries
    .map(
      ([id, note]) =>
        `<li id="fn-${escapeHtml(id)}"><strong>${escapeHtml(id)}.</strong> ${renderInlineSpans(note, footnotes)}</li>`,
    )
    .join("");
  return `<ol class="md-footnotes">${items}</ol>`;
}

/** 마크다운 → HTML (mobile SimpleMarkdownView block parity) */
export function renderMarkdown(text: string): string {
  const { body, footnotes } = extractFootnoteDefinitions(text);
  const html = splitMarkdownBlocks(body)
    .map((block) => {
      if (block.kind === "code") {
        const lang = block.lang
          ? `<span class="md-code-lang">${escapeHtml(block.lang)}</span>`
          : "";
        return `<pre class="md-code-block">${lang}<code>${escapeHtml(block.content)}</code></pre>`;
      }
      return renderTextBlock(block.content, footnotes);
    })
    .join("");
  return html + renderFootnotesSection(footnotes);
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    rows.push(line.split(",").map((c) => c.trim()));
  }
  return rows;
}

export function formatJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

export function jsonToTree(value: unknown, depth = 0): string {
  const pad = "  ".repeat(depth);
  if (value === null) return `${pad}null`;
  if (typeof value === "object" && !Array.isArray(value)) {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return `${pad}{}`;
    return entries
      .map(
        ([k, v]) =>
          `${pad}${k}:\n${jsonToTree(v, depth + 1)}`,
      )
      .join("\n");
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return `${pad}[]`;
    return value.map((v, i) => `${pad}[${i}]\n${jsonToTree(v, depth + 1)}`).join("\n");
  }
  return `${pad}${JSON.stringify(value)}`;
}
