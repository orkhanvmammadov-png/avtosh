import { requireStaff } from "@/auth/current-user";
import { createApiHandler, requireUuidParam } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { getModerationDetail } from "@/services/moderation";

export const dynamic = "force-dynamic";

export const GET = createApiHandler(async ({ request, requestId, params }) => {
  await requireStaff(request);
  const listingId = requireUuidParam(params, "listingId");
  const listing = await getModerationDetail(listingId);
  return apiSuccess({ listing }, { requestId });
});
