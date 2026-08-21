import { requireAuth } from "@/auth/current-user";
import { createApiHandler } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { getListingQuota } from "@/services/listing-submission";

export const dynamic = "force-dynamic";

/** Advisory only — the submit transaction is authoritative. BLOCKED users may read it. */
export const GET = createApiHandler(async ({ request, requestId }) => {
  const auth = await requireAuth(request);
  const quota = await getListingQuota(auth);
  return apiSuccess({ quota }, { requestId });
});
