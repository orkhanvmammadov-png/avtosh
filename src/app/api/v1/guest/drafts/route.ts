import { readGuestToken, serializeGuestCookie } from "@/auth/guest-cookies";
import { clientIpHash } from "@/auth/ip";
import { createApiHandler, parseBody } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { assertSameOrigin } from "@/lib/security/origin";
import { createGuestDraft } from "@/services/guest-drafts";
import { createDraftSchema } from "@/validators/listings";

export const dynamic = "force-dynamic";

/**
 * Guest draft creation (deferred-login PR A). FAIL-CLOSED behind
 * GUEST_DRAFTS_ENABLED (a disabled feature answers LISTING_NOT_FOUND).
 * Mints the opaque guest capability (HttpOnly cookie, hash-at-rest)
 * when the caller has none. Same-origin enforced like every other
 * state-changing route — SameSite+JSON alone are not the origin
 * policy. The /api/v1/me surface is untouched and stays strictly
 * authenticated.
 */
export const POST = createApiHandler(async ({ request, requestId }) => {
  assertSameOrigin(request);
  const body = await parseBody(request, createDraftSchema);
  const result = await createGuestDraft({
    presentedToken: readGuestToken(request),
    ipHash: clientIpHash(request),
    categoryCode: body.category,
  });
  return apiSuccess(
    { listing: result.listing },
    {
      requestId,
      status: 201,
      ...(result.issuedToken !== null
        ? { setCookie: serializeGuestCookie(result.issuedToken) }
        : {}),
    },
  );
});
