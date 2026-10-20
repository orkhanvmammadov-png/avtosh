import { readGuestToken } from "@/auth/guest-cookies";
import {
  createApiHandler,
  parseBody,
  requireUuidParam,
} from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { assertSameOrigin } from "@/lib/security/origin";
import { resolveGuestSession } from "@/services/guest-drafts";
import { createGuestUploadAuthorization } from "@/services/listing-images";
import { uploadUrlSchema } from "@/validators/listings";

export const dynamic = "force-dynamic";

/** Guest signed-upload issuance — fail-closed behind
    GUEST_DRAFTS_ENABLED, scoped by the capability cookie, same-origin
    enforced, with the per-session hourly issuance brake on top of the
    shared per-listing caps. */
export const POST = createApiHandler(async ({ request, requestId, params }) => {
  assertSameOrigin(request);
  const listingId = requireUuidParam(params, "listingId");
  const session = await resolveGuestSession(readGuestToken(request));
  const body = await parseBody(request, uploadUrlSchema);
  const authorization = await createGuestUploadAuthorization(session, listingId, {
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
