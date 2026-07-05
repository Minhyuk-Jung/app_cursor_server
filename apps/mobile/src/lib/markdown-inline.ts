/** P7 mobile 16차 — autolink URL 정규화 (www. → https://) */
export function normalizeAutolinkUrl(url: string): string {
  return url.startsWith("www.") ? `https://${url}` : url;
}

/** plain 텍스트에서 autolink 토큰 분리 (SimpleMarkdownView·테스트 공유) */
export function splitAutolinkTokens(text: string): string[] {
  const AUTOLINK_RE = /((?:https?:\/\/|www\.)[^\s<]+[^\s<.,;:!?)}\]])/g;
  return text.split(AUTOLINK_RE);
}

/** nested inline 감지 — bold/italic 내부에 추가 마크업 */
export function hasNestedInlineMarkup(text: string): boolean {
  return /(\*\*[^*]+\*[^*]+\*[^*]+\*\*|\*\*[^*]+\[[^\]]+\]\([^)]+\)[^*]+\*\*)/.test(
    text,
  );
}

export function isAutolinkToken(token: string): boolean {
  return /^(https?:\/\/|www\.)/.test(token);
}
