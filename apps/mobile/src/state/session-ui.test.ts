import { describe, expect, it } from "vitest";
import {
  canSteerRun,
  dbMessagesToChat,
  parseMessageAttachments,
  userMessageDisplayContent,
} from "./session-ui";

describe("canSteerRun", () => {
  it("allows steer during streaming", () => {
    expect(canSteerRun("run-1", "streaming")).toBe(true);
  });

  it("blocks steer during waiting_approval", () => {
    expect(canSteerRun("run-1", "waiting_approval")).toBe(false);
  });

  it("blocks steer without active run", () => {
    expect(canSteerRun(null, "streaming")).toBe(false);
  });

  it("blocks steer after run finished", () => {
    expect(canSteerRun(null, "finished")).toBe(false);
  });
});

describe("attachments (UR-15 8차)", () => {
  it("parseMessageAttachments parses JSON array", () => {
    const att = parseMessageAttachments(
      JSON.stringify([{ kind: "image", ref: "ref-1", mime: "image/png" }]),
    );
    expect(att).toHaveLength(1);
    expect(att![0]!.ref).toBe("ref-1");
  });

  it("dbMessagesToChat maps attachmentsJson", () => {
    const chat = dbMessagesToChat([
      {
        id: "m1",
        role: "user",
        content: "analyze",
        runId: null,
        attachmentsJson: JSON.stringify([
          { kind: "image", ref: "ref-abc", mime: "image/png" },
        ]),
      },
    ]);
    expect(chat[0]!.attachments).toHaveLength(1);
    expect(chat[0]!.attachments![0]!.ref).toBe("ref-abc");
  });

  it("userMessageDisplayContent strips legacy attachment meta lines", () => {
    expect(
      userMessageDisplayContent("analyze\n\n📷 image (png, ref abc…)", [
        { kind: "image", ref: "abc" },
      ]),
    ).toBe("analyze");
    expect(userMessageDisplayContent("plain", undefined)).toBe("plain");
  });
});
