/** GFM task list line: `- [ ] text` or `- [x] text` */
export type TaskListItem = {
  checked: boolean;
  text: string;
};

export type OrderedListItem = {
  index: number;
  text: string;
};

const TASK_LIST_RE = /^[-*]\s+\[([ xX])\]\s+(.+)$/;
const ORDERED_LIST_RE = /^(\d+)\.\s+(.+)$/;

export function parseTaskListLine(line: string): TaskListItem | null {
  const trimmed = line.trim();
  const match = trimmed.match(TASK_LIST_RE);
  if (!match) return null;
  return {
    checked: match[1]!.toLowerCase() === "x",
    text: match[2]!.trim(),
  };
}

export function parseOrderedListLine(line: string): OrderedListItem | null {
  const trimmed = line.trim();
  const match = trimmed.match(ORDERED_LIST_RE);
  if (!match) return null;
  return {
    index: Number.parseInt(match[1]!, 10),
    text: match[2]!.trim(),
  };
}

export function isTaskListLine(line: string): boolean {
  return TASK_LIST_RE.test(line.trim());
}

export const STRIKETHROUGH_RE = /^~~(.+)~~$/;

export function matchStrikethrough(token: string): string | null {
  const match = token.match(STRIKETHROUGH_RE);
  return match?.[1] ?? null;
}

/** markdown link/image href — http(s)·mailto만 허용 */
export function sanitizeMarkdownLinkHref(href: string): string | null {
  const trimmed = href.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^mailto:/i.test(trimmed)) return trimmed;
  return null;
}

const FOOTNOTE_DEF_RE = /^\[\^([^\]]+)\]:\s*(.+)$/;

/** GFM footnote 정의 `[^id]: text` 추출 — 본문에서 제거 */
export function extractFootnoteDefinitions(content: string): {
  body: string;
  footnotes: Record<string, string>;
} {
  const footnotes: Record<string, string> = {};
  const bodyLines: string[] = [];
  for (const line of content.split("\n")) {
    const match = line.match(FOOTNOTE_DEF_RE);
    if (match) {
      footnotes[match[1]!] = match[2]!.trim();
    } else {
      bodyLines.push(line);
    }
  }
  return { body: bodyLines.join("\n"), footnotes };
}

export function hasFootnoteDefinition(line: string): boolean {
  return FOOTNOTE_DEF_RE.test(line.trim());
}

export const FOOTNOTE_REF_RE = /\[\^([^\]]+)\]/g;
