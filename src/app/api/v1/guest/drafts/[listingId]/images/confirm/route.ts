import { readGuestToken } from "@/auth/guest-cookies";
import {
  createApiHandler,
  parseBody,
  requireUuidParam,
} from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { assertSameOrigin } from "@/lib/security/origin";
import { resolveGuestSession } from "@/services/guest-drafts";
import { confirmGuestUpload } from "@/services/listing-images";
import { confirmUploadSchema } from "@/validators/listings";

export const dynamic = "force-dynamic";

export const POST = createApiHandler(async ({ request, requestId, params }) => {
  assertSameOrigin(request);
  const listingId = requireUuidParam(params, "listingId");
  const session = await resolveGuestSession(readGuestToken(request));
  const body = await parseBody(request, confirmUploadSchema);
  const result = await confirmGuestUpload(session, listingId, body.upload_id);
  return apiSuccess(
    { image: result.image, revision: result.revision },
    { requestId, status: 201 },
  );
});
