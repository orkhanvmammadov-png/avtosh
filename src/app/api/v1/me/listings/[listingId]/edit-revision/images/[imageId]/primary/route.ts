import { requireActiveSeller } from "@/auth/current-user";
import { createApiHandler, requireUuidParam } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { assertSameOrigin } from "@/lib/security/origin";
import { setStagedPrimary } from "@/services/listing-edit-images";

export const dynamic = "force-dynamic";

export const PATCH = createApiHandler(async ({ request, requestId, params }) => {
  assertSameOrigin(request);
  const auth = await requireActiveSeller(request);
  const listingId = requireUuidParam(params, "listingId");
  const imageId = requireUuidParam(params, "imageId");
  const result = await setStagedPrimary(auth, listingId, imageId);
  return apiSuccess({ primary: true, revision: result.revision }, { requestId });
});
