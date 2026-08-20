import { toSafeApiError } from "@/lib/api/errors";
import { REQUEST_ID_HEADER } from "@/lib/api/request-id";

/** Standard success envelope: { "data": ... } */
export interface ApiSuccessBody<T> {
  data: T;
}

/** Standard error envelope with a stable machine-readable code. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details: unknown;
    request_id: string;
  };
}

function baseHeaders(requestId?: string): HeadersInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (requestId !== undefined) {
    headers[REQUEST_ID_HEADER] = requestId;
  }
  return headers;
}

export function apiSuccess<T>(
  data: T,
  options?: { status?: number; requestId?: string },
): Response {
  const body: ApiSuccessBody<T> = { data };
  return Response.json(body, {
    status: options?.status ?? 200,
    headers: baseHeaders(options?.requestId),
  });
}

/**
 * Serializes any error into the standard error envelope. Non-ApiError
 * values are collapsed into a generic INTERNAL_ERROR so internal
 * details never reach clients.
 */
export function apiFailure(error: unknown, requestId: string): Response {
  const safe = toSafeApiError(error);
  const body: ApiErrorBody = {
    error: {
      code: safe.code,
      message: safe.message,
      details: safe.details,
      request_id: requestId,
    },
  };
  return Response.json(body, {
    status: safe.status,
    headers: baseHeaders(requestId),
  });
}
