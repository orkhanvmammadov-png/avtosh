import { requireAdmin } from "@/auth/current-user";
import { createApiHandler, requireUuidParam } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { adminPaymentAttemptHistory } from "@/services/admin";

export const dynamic = "force-dynamic";

export const GET = createApiHandler(async ({ request, requestId, params }) => {
  await requireAdmin(request);
  const paymentId = requireUuidParam(params, "paymentId");
  return apiSuccess(
    { attempts: await adminPaymentAttemptHistory(paymentId) },
    { requestId, cacheControl: "no-store" },
  );
});
