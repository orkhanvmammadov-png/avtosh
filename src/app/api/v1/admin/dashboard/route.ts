import { requireAdmin } from "@/auth/current-user";
import { createApiHandler } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { adminDashboard } from "@/services/admin";

export const dynamic = "force-dynamic";

export const GET = createApiHandler(async ({ request, requestId }) => {
  await requireAdmin(request);
  return apiSuccess(await adminDashboard(), { requestId, cacheControl: "no-store" });
});
