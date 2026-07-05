/** P7 S26 — Web Speech API helper (15 §6.6) */

export function isSpeechRecognitionSupported(
  win: Window & typeof globalThis = globalThis as Window & typeof globalThis,
): boolean {
  const w = win as Window & {
    SpeechRecognition?: unknown;
    webkitSpeechRecognition?: unknown;
  };
  return Boolean(w.SpeechRecognition ?? w.webkitSpeechRecognition);
}

/** 최종 음성 인식 결과를 기존 프롬프트 텍스트에 이어 붙인다 */
function mergeSpeechChunks(chunks: string[]): string {
  let text = "";
  for (const chunk of chunks) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;
    if (!text.trim()) {
      text = trimmed;
      continue;
    }
    const sep = text.endsWith(" ") ? "" : " ";
    text = `${text}${sep}${trimmed}`;
  }
  return text;
}

export function appendSpeechTranscript(current: string, transcript: string): string {
  const merged = mergeSpeechChunks([current, transcript]);
  return merged || current;
}

export type SpeechRecognitionCtor = new () => SpeechRecognition;

export function getSpeechRecognitionCtor(
  win: Window & typeof globalThis = globalThis as Window & typeof globalThis,
): SpeechRecognitionCtor | null {
  const w = win as Window & {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** S26 — 음성 final 청크 → send_prompt payload */
export function buildVoiceSendPayload(finalChunks: string[]): {
  text: string;
  ready: boolean;
} {
  const trimmed = mergeSpeechChunks(finalChunks);
  return { text: trimmed, ready: trimmed.length > 0 };
}
