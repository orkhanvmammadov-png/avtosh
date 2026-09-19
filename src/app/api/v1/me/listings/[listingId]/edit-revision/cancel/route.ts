import { requireActiveSeller } from "@/auth/current-user";
import {
  createApiHandler,
  parseBody,
  requireUuidParam,
} from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { assertSameOrigin } from "@/lib/security/origin";
import { cancelOpenEditRevision } from "@/services/listing-lifecycle";
import { lifecycleActionSchema } from "@/validators/listings";

export const dynamic = "force-dynamic";

/** O.12 cancel edit (Stage A core): EDIT_DRAFT / CORRECTION_REQUIRED
    only, history retained, reactivation intent cleared, staged-image
    cleanup candidates enqueued, approved listing untouched. */
export const POST = createApiHandler(async ({ request, requestId, params }) => {
  assertSameOrigin(request);
  const auth = await requireActiveSeller(request);
  const listingId = requireUuidParam(params, "listingId");
  const body = await parseBody(request, lifecycleActionSchema);
  const result = await cancelOpenEditRevision(auth, listingId, body.expected_revision);
  return apiSuccess(result, { requestId });
});
