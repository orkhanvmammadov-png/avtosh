import { createApiHandler } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { getCities } from "@/services/catalog";

export const dynamic = "force-dynamic";

export const GET = createApiHandler(async ({ requestId }) => {
  const cities = await getCities();
  return apiSuccess(cities, { requestId });
});
