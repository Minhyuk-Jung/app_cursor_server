import type { FastifyInstance } from "fastify";
import { Scope as ScopeEnum } from "@app/shared";
import { sendError } from "./errors.js";
import type { createAuthService } from "../auth/auth.js";

type AuthService = ReturnType<typeof createAuthService>;

async function readAudioMultipart(
  request: import("fastify").FastifyRequest,
): Promise<Buffer | null> {
  if (!request.isMultipart()) return null;
  const part = await request.file();
  if (!part) return null;
  return part.toBuffer();
}

/** P7 UR-15 — 서버 STT fallback (Web Speech 미지원 환경) */
export async function registerSttRoutes(
  app: FastifyInstance,
  auth: AuthService,
): Promise<void> {
  app.post("/api/v1/stt/transcribe", async (request, reply) => {
    if (!auth.requireScope(request.auth!, ScopeEnum.PROMPT_SEND)) {
      return sendError(reply, {
        code: "forbidden",
        message: "Insufficient scope",
        retryable: false,
      });
    }

    const audio = await readAudioMultipart(request);
    if (!audio) {
      return sendError(reply, {
        code: "validation_failed",
        message: "multipart audio field required",
        retryable: false,
      });
    }

    if (process.env.STT_STUB === "true") {
      const header = request.headers["x-stt-stub-transcript"];
      const transcript =
        (typeof header === "string" ? header : header?.[0]) ??
        "stub transcript";
      return reply.send({ transcript });
    }

    const sttApiUrl = process.env.STT_API_URL?.trim();
    if (sttApiUrl) {
      try {
        const form = new FormData();
        form.append(
          "file",
          new Blob([audio], { type: "audio/webm" }),
          "audio.webm",
        );
        const headers: Record<string, string> = {};
        const sttApiKey = process.env.STT_API_KEY?.trim();
        if (sttApiKey) {
          headers.Authorization = `Bearer ${sttApiKey}`;
        }
        const res = await fetch(sttApiUrl, {
          method: "POST",
          body: form,
          headers,
        });
        if (!res.ok) {
          return sendError(reply, {
            code: "internal_error",
            message: `STT upstream returned ${res.status}`,
            retryable: true,
          });
        }
        const body = (await res.json()) as {
          text?: string;
          transcript?: string;
        };
        const transcript = (body.text ?? body.transcript ?? "").trim();
        if (!transcript) {
          return sendError(reply, {
            code: "internal_error",
            message: "STT upstream returned empty transcript",
            retryable: true,
          });
        }
        return reply.send({ transcript });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return sendError(reply, {
          code: "internal_error",
          message: `STT request failed: ${message}`,
          retryable: true,
        });
      }
    }

    return sendError(reply, {
      code: "internal_error",
      message:
        "Server STT is not configured (set STT_STUB=true or STT_API_URL)",
      retryable: false,
    });
  });
}
