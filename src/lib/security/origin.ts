import { ApiError } from "@/lib/api/errors";

/**
 * Same-origin guard for state-changing, session-authenticated
 * requests (the reusable CSRF convention for logout today and
 * listing/payment/admin mutations later). SameSite=Lax already blocks
 * cross-site cookie sends for POST; this adds Origin verification as
 * defense in depth. Requests without an Origin header (non-browser
 * clients, same-origin GETs) pass — the cookie's SameSite attribute
 * is the primary browser control.
 */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (origin === null) {
    return;
  }
  const host = request.headers.get("host");
  if (host !== null) {
    try {
      if (new URL(origin).host === host) {
        return;
      }
    } catch {
      // fall through to rejection
    }
  }
  throw new ApiError("FORBIDDEN_ORIGIN", "Cross-origin request rejected.");
}
