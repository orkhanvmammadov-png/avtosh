import { requireActiveSeller } from "@/auth/current-user";
import { createApiHandler, parseBody, requireUuidParam } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { assertSameOrigin } from "@/lib/security/origin";
import { reactivateListing } from "@/services/listing-lifecycle";
import { lifecycleActionSchema } from "@/validators/listings";

export const dynamic = "force-dynamic";

/**
 * O.12 seller reactivation. The Stage A service returns a structured
 * outcome (REACTIVATED / EDIT_INCOMPLETE / AWAITING_MODERATION /
 * CORRECTION_REQUIRED / RENEWAL_REQUIRED) — all of them are successful
 * lifecycle answers, not errors; typed refusals (SUSPENDED/SOLD,
 * revision conflicts, anti-oracle not-found) surface through the
 * existing ApiError envelope.
 */
export const POST = createApiHandler(async ({ request, requestId, params }) => {
  assertSameOrigin(request);
  const auth = await requireActiveSeller(request);
  const listingId = requireUuidParam(params, "listingId");
  const body = await parseBody(request, lifecycleActionSchema);
  const result = await reactivateListing(auth, listingId, body.expected_revision);
  return apiSuccess(result, { requestId });
});
