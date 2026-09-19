import { requireActiveSeller } from "@/auth/current-user";
import { createApiHandler, parseBody, requireUuidParam } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { assertSameOrigin } from "@/lib/security/origin";
import { deactivateListing } from "@/services/listing-lifecycle";
import { lifecycleActionSchema } from "@/validators/listings";

export const dynamic = "force-dynamic";

/** O.12 seller deactivation — visibility only; validity, periods,
    promotions and any edit revision are untouched (Stage A core). */
export const POST = createApiHandler(async ({ request, requestId, params }) => {
  assertSameOrigin(request);
  const auth = await requireActiveSeller(request);
  const listingId = requireUuidParam(params, "listingId");
  const body = await parseBody(request, lifecycleActionSchema);
  const result = await deactivateListing(auth, listingId, body.expected_revision);
  return apiSuccess(result, { requestId });
});
