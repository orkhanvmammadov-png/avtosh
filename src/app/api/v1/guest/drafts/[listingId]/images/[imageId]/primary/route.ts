import { readGuestToken } from "@/auth/guest-cookies";
import { createApiHandler, requireUuidParam } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { assertSameOrigin } from "@/lib/security/origin";
import { resolveGuestSession } from "@/services/guest-drafts";
import { setGuestPrimary } from "@/services/listing-images";

export const dynamic = "force-dynamic";

export const PATCH = createApiHandler(async ({ request, requestId, params }) => {
  assertSameOrigin(request);
  const listingId = requireUuidParam(params, "listingId");
  const imageId = requireUuidParam(params, "imageId");
  const session = await resolveGuestSession(readGuestToken(request));
  const result = await setGuestPrimary(session, listingId, imageId);
  return apiSuccess({ primary: true, revision: result.revision }, { requestId });
});
