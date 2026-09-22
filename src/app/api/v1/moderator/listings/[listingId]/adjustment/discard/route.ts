import { requireStaff } from "@/auth/current-user";
import { createApiHandler, parseBody, requireUuidParam } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { assertSameOrigin } from "@/lib/security/origin";
import { discardAdjustment } from "@/services/moderation-adjustments";
import { adjustmentDiscardSchema } from "@/validators/moderation";

export const dynamic = "force-dynamic";

/** O.13 Stage B — terminal discard of the OPEN working adjustment
    (kept in history; seller artifacts untouched; idempotent retry). */
export const POST = createApiHandler(async ({ request, requestId, params }) => {
  assertSameOrigin(request);
  const auth = await requireStaff(request);
  const listingId = requireUuidParam(params, "listingId");
  const body = await parseBody(request, adjustmentDiscardSchema);
  const adjustment = await discardAdjustment(auth, listingId, {
    expectedAdjustmentRevision: body.expected_adjustment_revision,
  });
  return apiSuccess({ adjustment }, { requestId });
});
