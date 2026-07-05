import type { AppError } from "./schemas.js";
import type { ParsedApiError } from "./api-http.js";

/** P7 mobile 15차 — web/mobile 공통 REST 클라이언트 에러 */
export class ClientApiError extends Error {
  constructor(
    public readonly appError: AppError,
    public readonly status: number,
  ) {
    super(appError.message);
    this.name = "ClientApiError";
  }

  get code(): string {
    return this.appError.code;
  }

  get retryable(): boolean {
    return this.appError.retryable;
  }

  static fromParsed(err: ParsedApiError): ClientApiError {
    return new ClientApiError(
      {
        code: err.code,
        message: err.message,
        retryable: err.retryable ?? false,
      },
      err.status,
    );
  }

  static adhoc(
    message: string,
    status: number,
    code = "unknown",
    retryable = false,
  ): ClientApiError {
    return new ClientApiError({ code, message, retryable }, status);
  }
}

export function throwClientApiError(err: ParsedApiError): never {
  throw ClientApiError.fromParsed(err);
}
