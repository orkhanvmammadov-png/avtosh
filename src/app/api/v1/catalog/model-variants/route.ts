import { createApiHandler, parseQuery } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { getModelVariants } from "@/services/catalog";
import { variantsQuerySchema } from "@/validators/catalog";

export const dynamic = "force-dynamic";

export const GET = createApiHandler(async ({ request, requestId }) => {
  const query = parseQuery(request, variantsQuerySchema);
  const variants = await getModelVariants(
    query.category,
    query.brand_id,
    query.model_id,
  );
  return apiSuccess(variants, { requestId });
});
