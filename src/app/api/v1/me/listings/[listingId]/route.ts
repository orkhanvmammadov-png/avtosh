import { requireActiveSeller, requireAuth } from "@/auth/current-user";
import {
  createApiHandler,
  parseBody,
  requireUuidParam,
} from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { assertSameOrigin } from "@/lib/security/origin";
import { getOwnedListingDto, updateDraft } from "@/services/listing-drafts";
import { sellerFeedbackFor } from "@/services/my-listings";
import { draftPatchSchema } from "@/validators/listings";

export const dynamic = "force-dynamic";

export const GET = createApiHandler(async ({ request, requestId, params }) => {
  const auth = await requireAuth(request);
  const listingId = requireUuidParam(params, "listingId");
  const listing = await getOwnedListingDto(auth, listingId);
  // Ownership was just proven by the loader (foreign ids 404 above).
  const moderationFeedback = await sellerFeedbackFor(listing.id, listing.status);
  return apiSuccess({ listing, moderation_feedback: moderationFeedback }, { requestId });
});

export const PATCH = createApiHandler(async ({ request, requestId, params }) => {
  assertSameOrigin(request);
  const auth = await requireActiveSeller(request);
  const listingId = requireUuidParam(params, "listingId");
  const body = await parseBody(request, draftPatchSchema);
  const listing = await updateDraft(auth, listingId, body);
  return apiSuccess({ listing }, { requestId });
});
