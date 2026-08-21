/**
 * Machine-readable API error codes. Phase 4.1 only needs generic codes;
 * the business error catalog is added in later phases.
 */
export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "INTERNAL_ERROR"
  | "CATALOG_INVALID_CATEGORY"
  | "CATALOG_INVALID_BRAND"
  | "CATALOG_INVALID_GROUP"
  | "AUTH_REQUIRED"
  | "AUTH_INVALID_PHONE"
  | "OTP_INVALID"
  | "OTP_EXPIRED"
  | "OTP_LOCKED"
  | "OTP_RESEND_TOO_SOON"
  | "OTP_RATE_LIMITED"
  | "FORBIDDEN_ORIGIN"
  | "USER_BLOCKED"
  | "LISTING_NOT_FOUND"
  | "LISTING_NOT_EDITABLE"
  | "LISTING_REVISION_CONFLICT"
  | "LISTING_INVALID_CATALOG_SELECTION"
  | "LISTING_IMAGE_LIMIT_REACHED"
  | "IMAGE_UPLOAD_RATE_LIMITED"
  | "IMAGE_UPLOAD_NOT_FOUND"
  | "IMAGE_UPLOAD_EXPIRED"
  | "IMAGE_INVALID_FORMAT"
  | "IMAGE_TOO_LARGE"
  | "IMAGE_PROCESSING_FAILED"
  | "LISTING_INCOMPLETE"
  | "LISTING_INSUFFICIENT_IMAGES"
  | "LISTING_PAYMENT_CONFIGURATION_ERROR"
  | "LISTING_CONFIGURATION_ERROR"
  | "STAFF_ROLE_REQUIRED"
  | "MODERATION_INVALID_STATE"
  | "MODERATION_CLAIM_REQUIRED"
  | "MODERATION_CLAIMED_BY_OTHER";

const DEFAULT_STATUS: Record<ApiErrorCode, number> = {
  VALIDATION_ERROR: 400,
  INTERNAL_ERROR: 500,
  CATALOG_INVALID_CATEGORY: 400,
  CATALOG_INVALID_BRAND: 400,
  CATALOG_INVALID_GROUP: 400,
  AUTH_REQUIRED: 401,
  AUTH_INVALID_PHONE: 400,
  OTP_INVALID: 400,
  OTP_EXPIRED: 400,
  OTP_LOCKED: 400,
  OTP_RESEND_TOO_SOON: 429,
  OTP_RATE_LIMITED: 429,
  FORBIDDEN_ORIGIN: 403,
  USER_BLOCKED: 403,
  LISTING_NOT_FOUND: 404,
  LISTING_NOT_EDITABLE: 409,
  LISTING_REVISION_CONFLICT: 409,
  LISTING_INVALID_CATALOG_SELECTION: 400,
  LISTING_IMAGE_LIMIT_REACHED: 409,
  IMAGE_UPLOAD_RATE_LIMITED: 429,
  IMAGE_UPLOAD_NOT_FOUND: 404,
  IMAGE_UPLOAD_EXPIRED: 410,
  IMAGE_INVALID_FORMAT: 400,
  IMAGE_TOO_LARGE: 413,
  IMAGE_PROCESSING_FAILED: 422,
  LISTING_INCOMPLETE: 400,
  LISTING_INSUFFICIENT_IMAGES: 400,
  LISTING_PAYMENT_CONFIGURATION_ERROR: 500,
  LISTING_CONFIGURATION_ERROR: 500,
  STAFF_ROLE_REQUIRED: 403,
  MODERATION_INVALID_STATE: 409,
  MODERATION_CLAIM_REQUIRED: 409,
  MODERATION_CLAIMED_BY_OTHER: 409,
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
