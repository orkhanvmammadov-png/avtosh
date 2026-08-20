export const REQUEST_ID_HEADER = "X-Request-ID";

/**
 * Incoming request IDs are only trusted when they look like a sane,
 * bounded identifier — otherwise a client could inject arbitrary or
 * oversized header content into logs and responses.
 */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,128}$/;

export function isValidRequestId(value: string): boolean {
  return REQUEST_ID_PATTERN.test(value);
}

/**
 * Returns the incoming X-Request-ID when it is acceptable, otherwise
 * generates a new UUID. The resolved ID is echoed on API responses and
 * included in error payloads to support Sentry/logging/payment
 * troubleshooting in later phases.
 */
export function resolveRequestId(request: Request): string {
  const incoming = request.headers.get(REQUEST_ID_HEADER);
  if (incoming !== null && isValidRequestId(incoming)) {
    return incoming;
  }
  return crypto.randomUUID();
}
