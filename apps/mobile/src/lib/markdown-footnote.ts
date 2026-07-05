/** GFM footnote ref 표시 라벨 (web md-fn-ref parity) */
export function footnoteRefLabel(id: string): string {
  return id;
}

/** footnote ref testID (Maestro·E2E) */
export function footnoteRefTestId(id: string): string {
  return `footnote-ref-${id}`;
}

/** 정의된 footnote ref인지 — 터치·스크롤 대상 여부 */
export function isFootnoteRefActive(
  id: string,
  footnotes: Record<string, string>,
): boolean {
  return Boolean(footnotes[id]);
}

/** measureLayout y → ScrollView scrollTo offset */
export function clampFootnoteScrollY(y: number, padding = 8): number {
  return Math.max(0, y - padding);
}
