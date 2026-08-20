import { requireActiveSeller } from "@/auth/current-user";
import {
  createApiHandler,
  parseBody,
  requireUuidParam,
} from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { assertSameOrigin } from "@/lib/security/origin";
import { createUploadAuthorization } from "@/services/listing-images";
import { uploadUrlSchema } from "@/validators/listings";

export const dynamic = "force-dynamic";

export const POST = createApiHandler(async ({ request, requestId, params }) => {
  assertSameOrigin(request);
  const auth = await requireActiveSeller(request);
  const listingId = requireUuidParam(params, "listingId");
  const body = await parseBody(request, uploadUrlSchema);
  const authorization = await createUploadAuthorization(auth, listingId, {
    mimeType: body.declared_mime_type,
    sizeBytes: body.declared_size_bytes,
  });
  return apiSuccess(
    {
      upload_id: authorization.uploadId,
      upload_url: authorization.uploadUrl,
      upload_token: authorization.uploadToken,
      expires_in_seconds: authorization.expiresInSeconds,
      max_size_bytes: authorization.maxSizeBytes,
    },
    { requestId },
  );
});
