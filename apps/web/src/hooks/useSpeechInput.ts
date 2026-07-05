import { useCallback, useEffect, useRef, useState } from "react";
import {
  getSpeechRecognitionCtor,
  isSpeechRecognitionSupported,
} from "../lib/speech-input.js";

export interface UseSpeechInputOptions {
  lang?: string;
  onFinalTranscript: (text: string) => void;
}

export function useSpeechInput({
  lang = "ko-KR",
  onFinalTranscript,
}: UseSpeechInputOptions) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const supported = isSpeechRecognitionSupported();

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setListening(false);
  }, []);

  const start = useCallback(() => {
    if (!supported || listening) return;
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setError("음성 입력을 지원하지 않는 브라우저입니다");
      return;
    }

    setError(null);
    const recognition = new Ctor();
    recognition.lang = lang;
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const result = event.results.item(event.resultIndex);
      const transcript = result?.item(0)?.transcript ?? "";
      if (transcript.trim()) onFinalTranscript(transcript);
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === "aborted") return;
      setError(event.error === "not-allowed" ? "마이크 권한이 필요합니다" : event.error);
      setListening(false);
      recognitionRef.current = null;
    };

    recognition.onend = () => {
      setListening(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  }, [supported, listening, lang, onFinalTranscript]);

  const toggle = useCallback(() => {
    if (listening) stop();
    else start();
  }, [listening, start, stop]);

  useEffect(() => () => stop(), [stop]);

  return { supported, listening, error, start, stop, toggle };
}
