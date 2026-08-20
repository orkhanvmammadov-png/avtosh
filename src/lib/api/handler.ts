import { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import { apiFailure } from "@/lib/api/response";
import { resolveRequestId } from "@/lib/api/request-id";

export interface ApiHandlerContext {
  request: Request;
  requestId: string;
}

/**
 * Wraps a route handler with the standard request-ID resolution and
 * safe error envelope, so individual routes never duplicate the
 * try/catch or leak internal errors.
 */
export function createApiHandler(
  handler: (context: ApiHandlerContext) => Promise<Response>,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const requestId = resolveRequestId(request);
    try {
      return await handler({ request, requestId });
    } catch (error) {
      return apiFailure(error, requestId);
    }
  };
}

/**
 * Parses URL query parameters against a Zod schema. On failure throws
 * a VALIDATION_ERROR ApiError carrying only safe issue details
 * (parameter path + message — never raw values echoed back).
 */
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
