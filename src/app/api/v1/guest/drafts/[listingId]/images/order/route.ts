import { readGuestToken } from "@/auth/guest-cookies";
import {
  createApiHandler,
  parseBody,
  requireUuidParam,
} from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { assertSameOrigin } from "@/lib/security/origin";
import { resolveGuestSession } from "@/services/guest-drafts";
import { reorderGuestImages } from "@/services/listing-images";
import { reorderImagesSchema } from "@/validators/listings";

export const dynamic = "force-dynamic";

export const PATCH = createApiHandler(async ({ request, requestId, params }) => {
  assertSameOrigin(request);
  const listingId = requireUuidParam(params, "listingId");
  const session = await resolveGuestSession(readGuestToken(request));
  const body = await parseBody(request, reorderImagesSchema);
  const result = await reorderGuestImages(session, listingId, body.image_ids);
  return apiSuccess({ reordered: true, revision: result.revision }, { requestId });
});
