import { describe, expect, it, vi } from "vitest";
import type { PromptAttachment } from "../api/client.js";
import {
  appendSpeechTranscript,
  buildVoiceSendPayload,
} from "./speech-input.js";

/** P7 S26 — 음성 청크 → send_prompt 텍스트 계약 */
describe("S26 speech → send_prompt flow", () => {
  it("buildVoiceSendPayload merges finals for send", () => {
    const payload = buildVoiceSendPayload([
      "implement",
      " user auth",
      " with JWT",
    ]);
    expect(payload.ready).toBe(true);
    expect(payload.text).toBe("implement user auth with JWT");

    const onSend = vi.fn();
    if (payload.ready) onSend(payload.text);
    expect(onSend).toHaveBeenCalledWith("implement user auth with JWT");
  });

  it("voice text + attachments match send_prompt payload shape", () => {
    const { text: voiceText } = buildVoiceSendPayload(["screenshot 분석"]);
    const attachments: PromptAttachment[] = [
      { kind: "image", ref: "abc123", mime: "image/png" },
    ];
    expect(voiceText).toBe("screenshot 분석");
    expect({ text: voiceText, attachments }).toEqual({
      text: "screenshot 분석",
      attachments: [{ kind: "image", ref: "abc123", mime: "image/png" }],
    });
  });

  it("appendSpeechTranscript remains compatible", () => {
    expect(appendSpeechTranscript("fix", " bug")).toBe("fix bug");
  });
});
