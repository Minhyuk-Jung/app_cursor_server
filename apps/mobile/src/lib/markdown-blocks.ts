export type { MarkdownBlock, MarkdownTable } from "@app/shared";
export {
  isBlockquoteLine,
  isHorizontalRule,
  isTableSeparator,
  parseMarkdownTable,
  parseTableRow,
  splitMarkdownBlocks,
  stripBlockquote,
} from "@app/shared";

export const INLINE_RE =
  /(`[^`]+`|~~.+?~~|\[\^[^\]]+\]|\*\*.+?\*\*|\*.+?\*|_.+?_|\[[^\]]+\]\([^)]+\)|!\[[^\]]*\]\([^)]+\))/g;

export const ITALIC_RE = /^\*(.+)\*$/;
export const UNDERSCORE_ITALIC_RE = /^_(.+)_$/;
export const BOLD_RE = /^\*\*(.+)\*\*$/;
export const STRIKETHROUGH_TOKEN_RE = /^~~(.+)~~$/;
export const AUTOLINK_RE =
  /((?:https?:\/\/|www\.)[^\s<]+[^\s<.,;:!?)}\]])/g;

export const LINK_RE = /^\[([^\]]+)\]\(([^)]+)\)$/;
export const IMAGE_RE = /^!\[([^\]]*)\]\(([^)]+)\)$/;
