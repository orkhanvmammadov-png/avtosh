import { z } from "zod";
import { ApiError, isApiError } from "@/lib/api/errors";
import { apiFailure } from "@/lib/api/response";
import { resolveRequestId } from "@/lib/api/request-id";
import { isReadOnlyLaunch } from "@/lib/config/launch";
import {
  logTransientReadRecovered,
  logUnexpectedApiError,
  normalizeRoute,
  type RetryOutcome,
} from "@/lib/api/error-log";
import { isTransientConnectionError } from "@/lib/server/db/transient-error";

/** Thrown by the read-only launch gate; also reusable by wrappers
    that do not go through createApiHandler (jobs, webhooks). */
export function readOnlyLaunchError(): ApiError {
  return new ApiError(
    "SERVICE_READ_ONLY",
    "This function is not available yet — the marketplace is running in read-only launch mode.",
  );
}

export interface ApiHandlerContext {
  request: Request;
  requestId: string;
  /** Dynamic route params ({} for static routes). */
  params: Record<string, string>;
}

interface RouteContext {
  params: Promise<Record<string, string>>;
}

/**
 * Wraps a route handler with the standard request-ID resolution and
 * safe error envelope, so individual routes never duplicate the
 * try/catch or leak internal errors. Dynamic route params are awaited
 * and passed through.
 */
export function createApiHandler(
  handler: (context: ApiHandlerContext) => Promise<Response>,
): (request: Request, context?: RouteContext) => Promise<Response> {
  return async (request: Request, context?: RouteContext): Promise<Response> => {
    const requestId = resolveRequestId(request);
    const method = request.method.toUpperCase();
    let params: Record<string, string> = {};
    let retry: RetryOutcome = "not_eligible";
    try {
      // READ-ONLY launch gate: every non-read method fails closed at
      // the server for ALL routes built on this factory. Side-effecting
      // GET entry points (cron jobs, payment verification) carry their
      // own gate because they bypass this factory or read via GET.
      if (isReadOnlyLaunch()) {
        if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
          throw readOnlyLaunchError();
        }
      }
      params = context === undefined ? {} : await context.params;
      const handlerContext = { request, requestId, params };
      try {
        return await handler(handlerContext);
      } catch (error) {
        // Bounded transient-read retry: exactly ONE retry, only for
        // idempotent read methods (never mutations — non-GET/HEAD
        // rethrows immediately), and only for allowlisted transient
        // connection/transport failures (never SQL, validation,
        // permission or unknown errors). postgres.js evicts the
        // failed connection from its pool, so the retry runs on a
        // fresh connection rather than reusing the stale socket. A
        // second failure falls through as an ordinary error — no
        // false success, no added waiting.
        const eligible =
          (method === "GET" || method === "HEAD") && isTransientConnectionError(error);
        if (!eligible) {
          throw error;
        }
        retry = "failed";
        const response = await handler(handlerContext);
        logTransientReadRecovered({
          error,
          requestId,
          method,
          route: normalizeRoute(new URL(request.url).pathname, params),
        });
        return response;
      }
    } catch (error) {
      // Structured sanitized log for UNEXPECTED failures only —
      // ApiErrors are intentional business responses. The public
      // response stays the generic envelope either way.
      if (!isApiError(error)) {
        logUnexpectedApiError({
          error,
          requestId,
          method,
          route: normalizeRoute(new URL(request.url).pathname, params),
          retry,
        });
      }
      return apiFailure(error, requestId);
    }
  };
}

/** Validates a route param as a UUID; unparseable → VALIDATION_ERROR. */
export function requireUuidParam(
  params: Record<string, string>,
  name: string,
): string {
  const value = params[name];
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) {
    throw new ApiError("VALIDATION_ERROR", `Invalid ${name} parameter.`);
  }
  return parsed.data;
}

/**
 * Parses URL query parameters against a Zod schema. On failure throws
 * a VALIDATION_ERROR ApiError carrying only safe issue details
 * (parameter path + message — never raw values echoed back).
 */
/**
 * Parses a JSON request body against a Zod schema. Non-JSON bodies
 * and schema failures both become VALIDATION_ERROR with safe details.
 */
export async function parseBody<Schema extends z.ZodType>(
  request: Request,
  schema: Schema,
): Promise<z.infer<Schema>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new ApiError("VALIDATION_ERROR", "Request body must be valid JSON.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError("VALIDATION_ERROR", "Invalid request body.", {
      details: parsed.error.issues.map((issue) => ({
        parameter: issue.path.join("."),
        message: issue.message,
      })),
    });
  }
  return parsed.data;
}

export function parseQuery<Schema extends z.ZodType>(
  request: Request,
  schema: Schema,
): z.infer<Schema> {
  const url = new URL(request.url);
  const raw = Object.fromEntries(url.searchParams.entries());
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError("VALIDATION_ERROR", "Invalid query parameters.", {
      details: parsed.error.issues.map((issue) => ({
        parameter: issue.path.join("."),
        message: issue.message,
      })),
    });
  }
  return parsed.data;
}
