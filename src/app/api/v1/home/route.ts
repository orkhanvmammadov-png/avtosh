import { createApiHandler } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { homeData } from "@/services/marketplace";

export const dynamic = "force-dynamic";

/** Public Home bootstrap: last-24h activation count, categories, first Premium page. */
export const GET = createApiHandler(async ({ requestId }) => {
  const { home, cacheControl } = await homeData();
  return apiSuccess({ home }, { requestId, cacheControl });
});
