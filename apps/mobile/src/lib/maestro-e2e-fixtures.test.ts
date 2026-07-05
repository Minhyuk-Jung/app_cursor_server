import { describe, expect, it } from "vitest";
import { sanitizeMarkdownLinkHref } from "@app/shared";
import {
  MAESTRO_E2E_INBOX_GIT_TITLE,
  MAESTRO_E2E_MARKDOWN_ASSERTS,
  MAESTRO_E2E_PROJECT_NAME,
  MAESTRO_E2E_README_MD,
} from "./maestro-e2e-fixtures";
import { clampFootnoteScrollY, footnoteRefTestId } from "./markdown-footnote";

describe("maestro-e2e-fixtures (24차)", () => {
  it("defines stable project name and markdown seed markers", () => {
    expect(MAESTRO_E2E_PROJECT_NAME).toBe("maestro-e2e");
    expect(MAESTRO_E2E_INBOX_GIT_TITLE).toBe("Maestro Git");
    for (const marker of MAESTRO_E2E_MARKDOWN_ASSERTS) {
      expect(MAESTRO_E2E_README_MD).toContain(marker);
    }
    expect(MAESTRO_E2E_README_MD).toContain("[^note]");
  });
});

describe("markdown-footnote helpers (25차)", () => {
  it("builds footnote ref testID and scroll offset", () => {
    expect(footnoteRefTestId("note")).toBe("footnote-ref-note");
    expect(clampFootnoteScrollY(120)).toBe(112);
    expect(clampFootnoteScrollY(4, 8)).toBe(0);
  });
});

describe("mobile markdown link sanitize (24차 — UR-02 parity)", () => {
  it("allows http(s) and blocks javascript:", () => {
    expect(sanitizeMarkdownLinkHref("https://example.com/x")).toBe(
      "https://example.com/x",
    );
    expect(sanitizeMarkdownLinkHref("javascript:alert(1)")).toBeNull();
    expect(sanitizeMarkdownLinkHref("mailto:a@b.c")).toBe("mailto:a@b.c");
  });
});
