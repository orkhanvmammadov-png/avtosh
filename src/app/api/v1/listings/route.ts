import { createApiHandler, parseQuery } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { searchMarketplace } from "@/services/marketplace";
import { searchQuerySchema } from "@/validators/marketplace";

export const dynamic = "force-dynamic";

/** Public, anonymous marketplace search. */
export const GET = createApiHandler(async ({ request, requestId }) => {
  const query = parseQuery(request, searchQuerySchema);
  const result = await searchMarketplace(query);
  return apiSuccess(
    { promoted: result.promoted, items: result.items },
    {
      requestId,
      cacheControl: result.cacheControl,
      meta: { next_cursor: result.nextCursor, has_more: result.hasMore },
    },
  );
});
