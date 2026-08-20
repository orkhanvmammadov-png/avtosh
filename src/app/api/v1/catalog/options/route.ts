import { createApiHandler, parseQuery } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { getReferenceOptions } from "@/services/catalog";
import { optionsQuerySchema } from "@/validators/catalog";

export const dynamic = "force-dynamic";

export const GET = createApiHandler(async ({ request, requestId }) => {
  const query = parseQuery(request, optionsQuerySchema);
  const options = await getReferenceOptions(query.group, query.category);
  return apiSuccess(options, { requestId });
});
