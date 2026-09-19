import { requireActiveSeller } from "@/auth/current-user";
import { createApiHandler, requireUuidParam } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { assertSameOrigin } from "@/lib/security/origin";
import { deleteStagedImage } from "@/services/listing-edit-images";

export const dynamic = "force-dynamic";

/** O.12 staged image removal — row reference only; storage objects are
    cleanup CANDIDATES for a reference-checking worker, never deleted
    here (they may back the approved public gallery). */
export const DELETE = createApiHandler(async ({ request, requestId, params }) => {
  assertSameOrigin(request);
  const auth = await requireActiveSeller(request);
  const listingId = requireUuidParam(params, "listingId");
  const imageId = requireUuidParam(params, "imageId");
  const result = await deleteStagedImage(auth, listingId, imageId);
  return apiSuccess({ deleted: true, revision: result.revision }, { requestId });
});
