import { requireStaff } from "@/auth/current-user";
import { createApiHandler, requireUuidParam } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { assertSameOrigin } from "@/lib/security/origin";
import { claimListing } from "@/services/moderation";

export const dynamic = "force-dynamic";

export const POST = createApiHandler(async ({ request, requestId, params }) => {
  assertSameOrigin(request);
  const auth = await requireStaff(request);
  const listingId = requireUuidParam(params, "listingId");
  const claim = await claimListing(auth, listingId);
  return apiSuccess({ claim }, { requestId });
});
