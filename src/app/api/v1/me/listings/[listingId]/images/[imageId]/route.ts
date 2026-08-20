import { requireActiveSeller } from "@/auth/current-user";
import { createApiHandler, requireUuidParam } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { assertSameOrigin } from "@/lib/security/origin";
import { deleteImage } from "@/services/listing-images";

export const dynamic = "force-dynamic";

export const DELETE = createApiHandler(async ({ request, requestId, params }) => {
  assertSameOrigin(request);
  const auth = await requireActiveSeller(request);
  const listingId = requireUuidParam(params, "listingId");
  const imageId = requireUuidParam(params, "imageId");
  const result = await deleteImage(auth, listingId, imageId);
  return apiSuccess({ deleted: true, revision: result.revision }, { requestId });
});
