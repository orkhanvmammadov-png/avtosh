import { clientIpHash } from "@/auth/ip";
import { ApiError } from "@/lib/api/errors";
import { createApiHandler } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { revealListingContact } from "@/services/marketplace";
import { publicIdParamSchema } from "@/validators/marketplace";

export const dynamic = "force-dynamic";

/** Explicit, anonymous contact reveal for a publicly visible listing. Never cached. */
export const POST = createApiHandler(async ({ request, requestId, params }) => {
  const parsed = publicIdParamSchema.safeParse(params.publicId);
  if (!parsed.success) {
    throw new ApiError("LISTING_NOT_FOUND", "Listing not found.");
  }
  const contact = await revealListingContact(parsed.data, clientIpHash(request));
  return apiSuccess({ contact }, { requestId, cacheControl: "no-store" });
});
