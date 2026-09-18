import { requireStaff } from "@/auth/current-user";
import { createApiHandler, parseBody, requireUuidParam } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { assertSameOrigin } from "@/lib/security/origin";
import { approveEditRevision } from "@/services/moderation-edit";
import { editApproveSchema } from "@/validators/moderation";

export const dynamic = "force-dynamic";

/** O.12 edit approval — a CONTENT decision (no period/fee/status). */
export const POST = createApiHandler(async ({ request, requestId, params }) => {
  assertSameOrigin(request);
  const auth = await requireStaff(request);
  const listingId = requireUuidParam(params, "listingId");
  const body = await parseBody(request, editApproveSchema);
  const result = await approveEditRevision(auth, listingId, body.expected_edit_revision);
  return apiSuccess(result, { requestId });
});
