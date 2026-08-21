import { requireActiveSeller } from "@/auth/current-user";
import { createApiHandler, parseBody, requireUuidParam } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { assertSameOrigin } from "@/lib/security/origin";
import { resubmitListing } from "@/services/listing-submission";
import { resubmitListingSchema } from "@/validators/listings";

export const dynamic = "force-dynamic";

export const POST = createApiHandler(async ({ request, requestId, params }) => {
  assertSameOrigin(request);
  const auth = await requireActiveSeller(request);
  const listingId = requireUuidParam(params, "listingId");
  const body = await parseBody(request, resubmitListingSchema);
  const result = await resubmitListing(auth, listingId, body.expected_revision);
  return apiSuccess(result, { requestId });
});
