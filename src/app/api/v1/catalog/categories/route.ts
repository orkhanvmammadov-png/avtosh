import { createApiHandler } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { getCategories } from "@/services/catalog";

export const dynamic = "force-dynamic";

export const GET = createApiHandler(async ({ requestId }) => {
  const categories = await getCategories();
  return apiSuccess(categories, { requestId });
});
