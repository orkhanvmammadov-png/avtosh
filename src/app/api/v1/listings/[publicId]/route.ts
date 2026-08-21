import { ApiError } from "@/lib/api/errors";
import { createApiHandler } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { publicDetail } from "@/services/marketplace";
import { publicIdParamSchema } from "@/validators/marketplace";

export const dynamic = "force-dynamic";

/** Public listing detail by public_id (never by internal UUID). */
export const GET = createApiHandler(async ({ requestId, params }) => {
  const parsed = publicIdParamSchema.safeParse(params.publicId);
  if (!parsed.success) {
    throw new ApiError("LISTING_NOT_FOUND", "Listing not found.");
  }
  const { listing, cacheControl } = await publicDetail(parsed.data);
  return apiSuccess({ listing }, { requestId, cacheControl });
});
