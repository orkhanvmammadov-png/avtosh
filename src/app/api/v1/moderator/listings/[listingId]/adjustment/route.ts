import { requireStaff } from "@/auth/current-user";
import { createApiHandler, parseBody, requireUuidParam } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { assertSameOrigin } from "@/lib/security/origin";
import { saveAdjustment } from "@/services/moderation-adjustments";
import { adjustmentSaveSchema } from "@/validators/moderation";

export const dynamic = "force-dynamic";

/**
 * O.13 Stage B — document-level moderator adjustment save. Staff-only,
 * same-origin, claim-owned, guarded by the moderation-subject identity
 * AND the adjustment's own optimistic counter. Persists PRIVATE
 * working state only: no seller artifact, lifecycle, payment, or
 * storage effect. The strict schema means lifecycle/admin/payment keys
 * cannot even parse.
 */
export const PUT = createApiHandler(async ({ request, requestId, params }) => {
  assertSameOrigin(request);
  const auth = await requireStaff(request);
  const listingId = requireUuidParam(params, "listingId");
  const body = await parseBody(request, adjustmentSaveSchema);
  const adjustment = await saveAdjustment(auth, listingId, body);
  return apiSuccess({ adjustment }, { requestId });
});
