import { requireAdmin } from "@/auth/current-user";
import { createApiHandler, requireUuidParam } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { adminUserDetail } from "@/services/admin";

export const dynamic = "force-dynamic";

export const GET = createApiHandler(async ({ request, requestId, params }) => {
  await requireAdmin(request);
  const userId = requireUuidParam(params, "userId");
  return apiSuccess({ user: await adminUserDetail(userId) }, { requestId, cacheControl: "no-store" });
});
