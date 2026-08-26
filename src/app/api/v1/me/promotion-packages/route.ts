import { requireAuth } from "@/auth/current-user";
import { createApiHandler } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { promotionPackages } from "@/services/promotion-purchases";

export const dynamic = "force-dynamic";

/** Active promotion packages with server-authoritative prices. */
export const GET = createApiHandler(async ({ request, requestId }) => {
  await requireAuth(request);
  const packages = await promotionPackages();
  return apiSuccess({ packages }, { requestId, cacheControl: "no-store" });
});
