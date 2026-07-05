export type MarkdownBlock =
  | { kind: "code"; lang?: string; content: string }
  | { kind: "text"; content: string };

export type MarkdownTable = {
  headers: string[];
  rows: string[][];
};

export function splitMarkdownBlocks(content: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const re = /```(\w*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    if (match.index > lastIndex) {
      blocks.push({
        kind: "text",
        content: content.slice(lastIndex, match.index),
      });
    }
    blocks.push({
      kind: "code",
      lang: match[1] || undefined,
      content: match[2] ?? "",
    });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < content.length) {
    blocks.push({ kind: "text", content: content.slice(lastIndex) });
  }
  return blocks.length ? blocks : [{ kind: "text", content }];
}

export function isBlockquoteLine(line: string): boolean {
  return /^>\s?/.test(line);
}

export function stripBlockquote(line: string): string {
  return line.replace(/^>\s?/, "");
}

export function isHorizontalRule(line: string): boolean {
  return /^-{3,}$/.test(line.trim());
}

export function parseTableRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return null;
  return trimmed
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
}

export function isTableSeparator(line: string): boolean {
  const cells = parseTableRow(line);
  if (!cells?.length) return false;
  return cells.every((cell) => /^:?-+:?$/.test(cell));
}

export function parseMarkdownTable(
  lines: string[],
  startIndex: number,
): { table: MarkdownTable; nextIndex: number } | null {
  const headerCells = parseTableRow(lines[startIndex] ?? "");
  if (!headerCells?.length) return null;
  const separator = lines[startIndex + 1];
  if (!separator || !isTableSeparator(separator)) return null;

  const rows: string[][] = [];
  let i = startIndex + 2;
  while (i < lines.length) {
    const cells = parseTableRow(lines[i] ?? "");
    if (!cells?.length) break;
    rows.push(cells);
    i += 1;
  }
  if (rows.length === 0) return null;
  return { table: { headers: headerCells, rows }, nextIndex: i };
}
