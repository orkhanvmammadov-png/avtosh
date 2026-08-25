import { requireAuth } from "@/auth/current-user";
import { ApiError } from "@/lib/api/errors";
import { createApiHandler } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { assertSameOrigin } from "@/lib/security/origin";
import { publicIdParamSchema } from "@/validators/marketplace";
import { addFavoriteByPublicId, removeFavorite } from "@/services/favorites";

export const dynamic = "force-dynamic";

function parsePublicId(params: Record<string, string>): number {
  const parsed = publicIdParamSchema.safeParse(params.publicId);
  if (!parsed.success) {
    throw new ApiError("LISTING_NOT_FOUND", "Listing not found.");
  }
  return parsed.data;
}

export const PUT = createApiHandler(async ({ request, requestId, params }) => {
  assertSameOrigin(request);
  const auth = await requireAuth(request);
  const result = await addFavoriteByPublicId(auth, parsePublicId(params));
  return apiSuccess(result, { requestId, cacheControl: "no-store" });
});

export const DELETE = createApiHandler(async ({ request, requestId, params }) => {
  assertSameOrigin(request);
  const auth = await requireAuth(request);
  const result = await removeFavorite(auth, parsePublicId(params));
  return apiSuccess(result, { requestId, cacheControl: "no-store" });
});
