import { requireActiveSeller } from "@/auth/current-user";
import {
  createApiHandler,
  parseBody,
  requireUuidParam,
} from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { assertSameOrigin } from "@/lib/security/origin";
import { reorderStagedImages } from "@/services/listing-edit-images";
import { reorderImagesSchema } from "@/validators/listings";

export const dynamic = "force-dynamic";

export const PATCH = createApiHandler(async ({ request, requestId, params }) => {
  assertSameOrigin(request);
  const auth = await requireActiveSeller(request);
  const listingId = requireUuidParam(params, "listingId");
  const body = await parseBody(request, reorderImagesSchema);
  const result = await reorderStagedImages(auth, listingId, body.image_ids);
  return apiSuccess({ reordered: true, revision: result.revision }, { requestId });
});
