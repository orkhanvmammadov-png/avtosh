import { requireAuth } from "@/auth/current-user";
import { createApiHandler } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { myFavoritePublicIds } from "@/services/favorites";

export const dynamic = "force-dynamic";

/** Lightweight heart-state bootstrap for the current buyer. */
export const GET = createApiHandler(async ({ request, requestId }) => {
  const auth = await requireAuth(request);
  const publicIds = await myFavoritePublicIds(auth);
  return apiSuccess({ publicIds }, { requestId, cacheControl: "no-store" });
});
