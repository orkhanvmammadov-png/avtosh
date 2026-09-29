import { errorChain, isTransientConnectionError } from "@/lib/server/db/transient-error";

/**
 * Sanitized structured server-side logging for unexpected API
 * failures. Emitted as one JSON line on stderr so platform log
 * drains (Vercel Logs) can index it by request_id.
 *
 * SANITIZATION CONTRACT — the log line only ever contains:
 * request id, HTTP method, the NORMALIZED route (param values
 * replaced by :name), error names, allowlisted short error codes,
 * and the retry outcome. It never contains error messages, stack
 * traces, addresses, connection strings, secrets, request bodies,
 * SQL parameter values or PII: postgres.js connection errors embed
 * host:port in `message`/`address`, so raw error fields are never
 * serialized.
 */

// Short machine codes only (Node errno, postgres.js lifecycle codes,
// SQLSTATE). Anything else — including free text — is dropped.
const SAFE_CODE = /^[A-Z0-9_]{2,40}$/;

export type RetryOutcome = "not_attempted" | "failed";

interface ChainEntry {
  name: string;
  code?: string;
}

function describeChain(error: unknown): ChainEntry[] {
  return errorChain(error).map((entry) => {
    const name =
      typeof entry === "object" && entry !== null && typeof (entry as { name?: unknown }).name === "string"
        ? ((entry as { name: string }).name.slice(0, 64) || "Error")
        : typeof entry;
    const rawCode =
      typeof entry === "object" && entry !== null ? (entry as { code?: unknown }).code : undefined;
    const code = typeof rawCode === "string" && SAFE_CODE.test(rawCode) ? rawCode : undefined;
    return code === undefined ? { name } : { name, code };
  });
}

/** Replaces dynamic param VALUES in the path with :name placeholders. */
export function normalizeRoute(pathname: string, params: Record<string, string>): string {
  const byValue = new Map(Object.entries(params).map(([name, value]) => [value, name]));
  return pathname
    .split("/")
    .map((segment) => {
      const name = byValue.get(decodeURIComponent(segment));
      return name === undefined ? segment : `:${name}`;
    })
    .join("/");
}

export function logUnexpectedApiError(input: {
  error: unknown;
  requestId: string;
  method: string;
  route: string;
  retry: RetryOutcome;
}): void {
  const chain = describeChain(input.error);
  console.error(
    JSON.stringify({
      level: "error",
      event: "api_unexpected_error",
      request_id: input.requestId,
      method: input.method,
      route: input.route,
      error_name: chain[0]?.name ?? "unknown",
      error_code: chain[0]?.code,
      cause_chain: chain.slice(1),
      transient_connection: isTransientConnectionError(input.error),
      retry: input.retry,
    }),
  );
}

/**
 * A transient failure inside an explicitly opted-in pure read that
 * succeeded on its single retry. Keyed by operation name (the
 * service-level retry has no request context); the operation label
 * is a static code identifier, never derived from data.
 */
export function logTransientReadRecovered(input: { operation: string; error: unknown }): void {
  const chain = describeChain(input.error);
  console.warn(
    JSON.stringify({
      level: "warn",
      event: "api_transient_read_recovered",
      operation: input.operation,
      error_name: chain[0]?.name ?? "unknown",
      error_code: chain[0]?.code,
      cause_chain: chain.slice(1),
      retry: "succeeded",
    }),
  );
}
