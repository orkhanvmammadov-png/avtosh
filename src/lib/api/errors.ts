/**
 * Machine-readable API error codes. Phase 4.1 only needs generic codes;
 * the business error catalog is added in later phases.
 */
export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "INTERNAL_ERROR"
  | "CATALOG_INVALID_CATEGORY"
  | "CATALOG_INVALID_BRAND"
  | "CATALOG_INVALID_GROUP";

const DEFAULT_STATUS: Record<ApiErrorCode, number> = {
  VALIDATION_ERROR: 400,
  INTERNAL_ERROR: 500,
  CATALOG_INVALID_CATEGORY: 400,
  CATALOG_INVALID_BRAND: 400,
  CATALOG_INVALID_GROUP: 400,
};

/**
 * Typed application error safe to serialize into API responses.
 * `message` and `details` must never contain stack traces, database
 * errors, or secret/provider values.
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details: unknown;

  constructor(
    code: ApiErrorCode,
    message: string,
    options?: { status?: number; details?: unknown },
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = options?.status ?? DEFAULT_STATUS[code];
    this.details = options?.details ?? null;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/**
 * Converts any thrown value into an ApiError that is safe to expose.
 * Unknown errors are collapsed into a generic INTERNAL_ERROR so raw
 * messages and stack traces never leak through the API.
 */
export function toSafeApiError(error: unknown): ApiError {
  if (isApiError(error)) {
    return error;
  }
  return new ApiError("INTERNAL_ERROR", "An unexpected error occurred.");
}
