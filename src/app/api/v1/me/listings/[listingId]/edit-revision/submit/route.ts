import { requireActiveSeller } from "@/auth/current-user";
import {
  createApiHandler,
  parseBody,
  requireUuidParam,
} from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { assertSameOrigin } from "@/lib/security/origin";
import { submitEditRevision } from "@/services/listing-edit";
import { editSubmitSchema } from "@/validators/listings";

export const dynamic = "force-dynamic";

/** O.12 edit submit/resubmit → PENDING_MODERATION. Never a
    publication, fee, quota, period, renewal, or status change. */
export const POST = createApiHandler(async ({ request, requestId, params }) => {
  assertSameOrigin(request);
  const auth = await requireActiveSeller(request);
  const listingId = requireUuidParam(params, "listingId");
  const body = await parseBody(request, editSubmitSchema);
  const result = await submitEditRevision(auth, listingId, body.expected_revision, {
    activate: body.activate,
  });
  return apiSuccess(result, { requestId });
});
