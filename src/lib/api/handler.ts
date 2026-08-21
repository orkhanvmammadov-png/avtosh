import { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import { apiFailure } from "@/lib/api/response";
import { resolveRequestId } from "@/lib/api/request-id";

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
    try {
      const params = context === undefined ? {} : await context.params;
      return await handler({ request, requestId, params });
    } catch (error) {
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
