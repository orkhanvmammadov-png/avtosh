import { createApiHandler, parseQuery } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { getModels } from "@/services/catalog";
import { modelsQuerySchema } from "@/validators/catalog";

export const dynamic = "force-dynamic";

export const GET = createApiHandler(async ({ request, requestId }) => {
  const query = parseQuery(request, modelsQuerySchema);
  const models = await getModels(query.category, query.brand_id);
  return apiSuccess(models, { requestId });
});
