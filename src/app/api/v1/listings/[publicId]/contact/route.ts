import { clientIpHash } from "@/auth/ip";
import { getCurrentAuth } from "@/auth/current-user";
import { ApiError } from "@/lib/api/errors";
import { createApiHandler } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { revealListingContact } from "@/services/marketplace";
import { publicIdParamSchema } from "@/validators/marketplace";

export const dynamic = "force-dynamic";

/**
 * Explicit contact reveal for a publicly visible listing — anonymous
 * in public FULL; during the Owner pilot only an authenticated
 * allowlisted session may reveal (anyone else gets the launch 503).
 * Never cached.
 */
export const POST = createApiHandler(async ({ request, requestId, params }) => {
  const parsed = publicIdParamSchema.safeParse(params.publicId);
  if (!parsed.success) {
    throw new ApiError("LISTING_NOT_FOUND", "Listing not found.");
  }
  // Non-null only for allowlisted phones while the pilot is active
  // (the session resolver nullifies everyone else).
  const auth = await getCurrentAuth(request);
  const contact = await revealListingContact(parsed.data, clientIpHash(request), {
    pilotAuthenticated: auth !== null,
  });
  return apiSuccess({ contact }, { requestId, cacheControl: "no-store" });
});
