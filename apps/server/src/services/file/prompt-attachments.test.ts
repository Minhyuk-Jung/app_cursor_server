import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileService } from "./file-service.js";
import { resolvePromptWithAttachments, userMessageContent } from "./prompt-attachments.js";

describe("resolvePromptWithAttachments (UR-15/S27)", () => {
  let root: string;
  const svc = new FileService();

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "prompt-att-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("passes plain text when no attachments", async () => {
    const r = await resolvePromptWithAttachments(svc, root, "hello", []);
    expect(r.displayText).toBe("hello");
    expect(r.sdkInput).toBe("hello");
  });

  it("userMessageContent strips attachment meta for DB", () => {
    expect(userMessageContent("hello", [])).toBe("hello");
    expect(userMessageContent("", [{ kind: "image", ref: "x" }])).toBe("(첨부)");
    expect(userMessageContent("check", [{ kind: "image", ref: "x" }])).toBe(
      "check",
    );
  });

  it("builds SDKUserMessage with base64 image", async () => {
    const saved = await svc.saveAttachment(root, Buffer.from("fake-png"), "image/png");
    const r = await resolvePromptWithAttachments(svc, root, "check this", [
      { kind: "image", ref: saved.ref, mime: "image/png" },
    ]);
    expect(r.displayText).toContain("check this");
    expect(r.displayText).toContain("image");
    expect(typeof r.sdkInput).toBe("object");
    if (typeof r.sdkInput === "object") {
      expect(r.sdkInput.text).toBe("check this");
      expect(r.sdkInput.images?.[0]?.mimeType).toBe("image/png");
      expect(r.sdkInput.images?.[0]?.data).toBe(
        Buffer.from("fake-png").toString("base64"),
      );
    }
  });
});
