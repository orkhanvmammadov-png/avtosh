import { requireAuth } from "@/auth/current-user";
import { createApiHandler } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { myFavoriteCards } from "@/services/favorites";

export const dynamic = "force-dynamic";

export const GET = createApiHandler(async ({ request, requestId }) => {
  const auth = await requireAuth(request);
  const items = await myFavoriteCards(auth);
  return apiSuccess({ items }, { requestId, cacheControl: "no-store" });
});
