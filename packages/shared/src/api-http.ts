/** UR-02 / P7 mobile 12차 — web/mobile 공통 JSON 응답 파싱 */

export interface ApiErrorBody {
  message: string;
  code: string;
  retryable?: boolean;
}

export type ApiErrorResponse = { error: ApiErrorBody };

export interface ParsedApiError extends ApiErrorBody {
  status: number;
}

export class JsonParseError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly rawPreview: string,
  ) {
    super(message);
  }
}

export function parseJsonBody<T>(
  raw: string,
): T | ApiErrorResponse | Record<string, never> {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as T | ApiErrorResponse;
  } catch {
    const preview = raw.slice(0, 120).replace(/\s+/g, " ").trim();
    throw new JsonParseError(
      `Invalid JSON response: ${preview || "(empty)"}`,
      0,
      preview,
    );
  }
}

export function extractApiError(body: unknown, statusText: string): ApiErrorBody {
  const err = (body as ApiErrorResponse)?.error;
  return {
    message: err?.message ?? statusText,
    code: err?.code ?? "unknown",
    retryable: err?.retryable,
  };
}

export async function parseJsonResponse<T>(
  res: Response,
  throwError: (err: ParsedApiError) => never,
): Promise<T> {
  const raw = await res.text();
  let body: T | ApiErrorResponse | Record<string, never>;
  try {
    body = raw ? parseJsonBody<T>(raw) : ({} as T);
  } catch (e) {
    if (e instanceof JsonParseError) {
      throwError({
        code: "invalid_response",
        message: e.message,
        retryable: false,
        status: res.status || 502,
      });
    }
    throw e;
  }
  if (!res.ok) {
    const apiErr = extractApiError(body, res.statusText);
    throwError({ ...apiErr, status: res.status });
  }
  return body as T;
}
