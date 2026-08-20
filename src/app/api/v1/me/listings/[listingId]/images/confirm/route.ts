import { requireActiveSeller } from "@/auth/current-user";
import {
  createApiHandler,
  parseBody,
  requireUuidParam,
} from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { assertSameOrigin } from "@/lib/security/origin";
import { confirmUpload } from "@/services/listing-images";
import { confirmUploadSchema } from "@/validators/listings";

export const dynamic = "force-dynamic";

export const POST = createApiHandler(async ({ request, requestId, params }) => {
  assertSameOrigin(request);
  const auth = await requireActiveSeller(request);
  const listingId = requireUuidParam(params, "listingId");
  const body = await parseBody(request, confirmUploadSchema);
  const result = await confirmUpload(auth, listingId, body.upload_id);
  return apiSuccess(
    { image: result.image, revision: result.revision },
    { requestId, status: 201 },
  );
});
