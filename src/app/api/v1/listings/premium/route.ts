import { createApiHandler, parseQuery } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { premiumFeed } from "@/services/marketplace";
import { premiumQuerySchema } from "@/validators/marketplace";

export const dynamic = "force-dynamic";

/** Lazy/cursor pagination over ALL current Premium listings (no slot cap). */
export const GET = createApiHandler(async ({ request, requestId }) => {
  const query = parseQuery(request, premiumQuerySchema);
  const result = await premiumFeed({ limit: query.limit, cursor: query.cursor });
  return apiSuccess(
    { items: result.items },
    {
      requestId,
      cacheControl: result.cacheControl,
      meta: { next_cursor: result.nextCursor, has_more: result.hasMore },
    },
  );
});
