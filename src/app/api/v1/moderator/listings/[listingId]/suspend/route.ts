import { requireStaff } from "@/auth/current-user";
import { createApiHandler, parseBody, requireUuidParam } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { assertSameOrigin } from "@/lib/security/origin";
import { suspendListing } from "@/services/moderation";
import { decisionWithReasonSchema } from "@/validators/moderation";

export const dynamic = "force-dynamic";

/** Staff suspension of an ACTIVE listing (see services/moderation). */
export const POST = createApiHandler(async ({ request, requestId, params }) => {
  assertSameOrigin(request);
  const auth = await requireStaff(request);
  const listingId = requireUuidParam(params, "listingId");
  const body = await parseBody(request, decisionWithReasonSchema);
  const result = await suspendListing(auth, listingId, {
    expectedRevision: body.expected_revision,
    reasonCode: body.reason_code,
    note: body.note ?? null,
  });
  return apiSuccess(result, { requestId });
});
