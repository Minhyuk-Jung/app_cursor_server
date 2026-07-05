/** Maestro device E2E 시드·flow assert 공유 상수 (24차) */
export const MAESTRO_E2E_PROJECT_NAME = "maestro-e2e";

export const MAESTRO_E2E_INBOX_GIT_TITLE = "Maestro Git";

export const MAESTRO_E2E_README_MD = [
  "# Maestro preview",
  "",
  "- [ ] todo item",
  "",
  "Footnote[^note]",
  "",
  "[^note]: GFM footnote body",
].join("\n");

/** flow assert에 필요한 GFM 마커 */
export const MAESTRO_E2E_MARKDOWN_ASSERTS = [
  "Maestro preview",
  "todo item",
  "GFM footnote body",
] as const;
