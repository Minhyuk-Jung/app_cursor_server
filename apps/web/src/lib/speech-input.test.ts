import { describe, expect, it } from "vitest";
import {
  appendSpeechTranscript,
  getSpeechRecognitionCtor,
  isSpeechRecognitionSupported,
} from "./speech-input.js";

describe("speech-input (P7 S26)", () => {
  it("appendSpeechTranscript merges final chunks", () => {
    expect(appendSpeechTranscript("", "hello")).toBe("hello");
    expect(appendSpeechTranscript("fix bug", "please")).toBe("fix bug please");
    expect(appendSpeechTranscript("already ", "next")).toBe("already next");
    expect(appendSpeechTranscript("x", "  ")).toBe("x");
  });

  it("detects SpeechRecognition support", () => {
    const supported = {
      SpeechRecognition: class {},
    } as Window & typeof globalThis;
    expect(isSpeechRecognitionSupported(supported)).toBe(true);
    expect(getSpeechRecognitionCtor(supported)).toBe(
      (supported as { SpeechRecognition: unknown }).SpeechRecognition,
    );

    const legacy = {
      webkitSpeechRecognition: class {},
    } as Window & typeof globalThis;
    expect(isSpeechRecognitionSupported(legacy)).toBe(true);

    expect(isSpeechRecognitionSupported({} as Window & typeof globalThis)).toBe(
      false,
    );
  });
});
