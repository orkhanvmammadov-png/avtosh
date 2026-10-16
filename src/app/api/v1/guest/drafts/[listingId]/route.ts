import { readGuestToken } from "@/auth/guest-cookies";
import {
  createApiHandler,
  parseBody,
  requireUuidParam,
} from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { assertSameOrigin } from "@/lib/security/origin";
import {
  getGuestDraftDto,
  resolveGuestSession,
  updateGuestDraft,
} from "@/services/guest-drafts";
import { draftPatchSchema } from "@/validators/listings";

export const dynamic = "force-dynamic";

/**
 * Guest draft read/PATCH, scoped purely by the server-owned capability
 * cookie — a client-supplied listing id is never proof of ownership.
 * Foreign, expired and unknown all answer the same LISTING_NOT_FOUND.
 */
export const GET = createApiHandler(async ({ request, requestId, params }) => {
  const listingId = requireUuidParam(params, "listingId");
  const session = await resolveGuestSession(readGuestToken(request));
  const listing = await getGuestDraftDto(session, listingId);
  return apiSuccess({ listing }, { requestId, cacheControl: "no-store" });
});

export const PATCH = createApiHandler(async ({ request, requestId, params }) => {
  assertSameOrigin(request);
  const listingId = requireUuidParam(params, "listingId");
  const session = await resolveGuestSession(readGuestToken(request));
  const body = await parseBody(request, draftPatchSchema);
  const listing = await updateGuestDraft(session, listingId, body);
  return apiSuccess({ listing }, { requestId });
});
