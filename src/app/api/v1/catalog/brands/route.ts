import { createApiHandler, parseQuery } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { getBrands } from "@/services/catalog";
import { brandsQuerySchema } from "@/validators/catalog";

export const dynamic = "force-dynamic";

export const GET = createApiHandler(async ({ request, requestId }) => {
  const query = parseQuery(request, brandsQuerySchema);
  const brands = await getBrands(query.category);
  return apiSuccess(brands, { requestId });
});
