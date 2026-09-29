import { logTransientReadRecovered } from "@/lib/api/error-log";
import { isTransientConnectionError } from "@/lib/server/db/transient-error";

/**
 * Bounded transient-read retry — EXPLICIT OPT-IN ONLY.
 *
 * HTTP method is not an idempotency boundary in this codebase (the
 * /api/jobs/* routes are mutating GETs; detail GETs can count views
 * and authenticated GETs touch last_seen_at in FULL mode), so no
 * request-level layer retries anything. The only retryable unit is a
 * PURE database read wrapped in this helper at the service level:
 * the wrapped function must be side-effect free, because it may run
 * twice.
 *
 * Bounds: exactly one retry; only for the closed allowlist of
 * transient connection/transport codes (see transient-error.ts) —
 * never PostgresError/SQLSTATE, ApiError, validation or unknown
 * errors. The failed connection is not reused: postgres.js evicts a
 * connection whose socket died, so the retry acquires a fresh one.
 * A second failure rethrows (marked, for the central error log) —
 * no false success, no delays, no reconnection loop.
 */

const retryFailedErrors = new WeakSet<object>();

/** True when this error already consumed its single read retry. */
export function didTransientReadRetryFail(error: unknown): boolean {
  return typeof error === "object" && error !== null && retryFailedErrors.has(error);
}

export async function withTransientReadRetry<T>(
  operation: string,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (!isTransientConnectionError(error)) {
      throw error;
    }
    try {
      const result = await fn();
      logTransientReadRecovered({ operation, error });
      return result;
    } catch (retryError) {
      if (typeof retryError === "object" && retryError !== null) {
        retryFailedErrors.add(retryError);
      }
      throw retryError;
    }
  }
}
