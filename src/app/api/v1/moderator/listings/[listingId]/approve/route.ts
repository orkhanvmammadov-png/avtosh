import { requireStaff } from "@/auth/current-user";
import { createApiHandler, parseBody, requireUuidParam } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { assertSameOrigin } from "@/lib/security/origin";
import { approveListing } from "@/services/moderation";
import { approveSchema } from "@/validators/moderation";

export const dynamic = "force-dynamic";

export const POST = createApiHandler(async ({ request, requestId, params }) => {
  assertSameOrigin(request);
  const auth = await requireStaff(request);
  const listingId = requireUuidParam(params, "listingId");
  const body = await parseBody(request, approveSchema);
  const result = await approveListing(auth, listingId, body.expected_revision);
  return apiSuccess(result, { requestId });
});
