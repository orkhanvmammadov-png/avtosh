import { clearSessionCookie, readSessionToken } from "@/auth/cookies";
import { createApiHandler } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { assertSameOrigin } from "@/lib/security/origin";
import { revokeSessionByToken } from "@/services/auth";

export const dynamic = "force-dynamic";

/**
 * Idempotent logout: revokes the presented session if it exists and
 * always clears the cookie, even when the session is already invalid.
 */
export const POST = createApiHandler(async ({ request, requestId }) => {
  assertSameOrigin(request);
  const token = readSessionToken(request);
  if (token !== null) {
    await revokeSessionByToken(token);
  }
  return apiSuccess(
    { logged_out: true },
    { requestId, setCookie: clearSessionCookie() },
  );
});
