import { readGuestToken } from "@/auth/guest-cookies";
import { createApiHandler, requireUuidParam } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { assertSameOrigin } from "@/lib/security/origin";
import { resolveGuestSession } from "@/services/guest-drafts";
import { deleteGuestImage } from "@/services/listing-images";

export const dynamic = "force-dynamic";

export const DELETE = createApiHandler(async ({ request, requestId, params }) => {
  assertSameOrigin(request);
  const listingId = requireUuidParam(params, "listingId");
  const imageId = requireUuidParam(params, "imageId");
  const session = await resolveGuestSession(readGuestToken(request));
  const result = await deleteGuestImage(session, listingId, imageId);
  return apiSuccess({ deleted: true, revision: result.revision }, { requestId });
});
