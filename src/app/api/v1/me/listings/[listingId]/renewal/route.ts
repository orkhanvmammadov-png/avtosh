import { requireActiveSeller } from "@/auth/current-user";
import { createApiHandler, requireUuidParam } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { renewalState } from "@/services/renewals";

export const dynamic = "force-dynamic";

/** Owner renewal state: eligibility + the server-priced offer. */
export const GET = createApiHandler(async ({ request, requestId, params }) => {
  const auth = await requireActiveSeller(request);
  const listingId = requireUuidParam(params, "listingId");
  const state = await renewalState(auth, listingId);
  return apiSuccess({ renewal: state }, { requestId, cacheControl: "no-store" });
});
