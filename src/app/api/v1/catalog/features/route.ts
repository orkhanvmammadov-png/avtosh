import { createApiHandler, parseQuery } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { getFeatures } from "@/services/catalog";
import { featuresQuerySchema } from "@/validators/catalog";

export const dynamic = "force-dynamic";

export const GET = createApiHandler(async ({ request, requestId }) => {
  const query = parseQuery(request, featuresQuerySchema);
  const features = await getFeatures(query.category);
  return apiSuccess(features, { requestId });
});
