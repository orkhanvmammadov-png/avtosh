import { createApiHandler } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { assertCronAuthorized } from "@/lib/jobs/cron-auth";
import { runPaymentReconciliation } from "@/services/lifecycle-jobs";

export const dynamic = "force-dynamic";

/** Scheduled worker: verify stale pending Kapital payments (4.12 core). */
export const GET = createApiHandler(async ({ request, requestId }) => {
  assertCronAuthorized(request);
  const summary = await runPaymentReconciliation();
  return apiSuccess(summary, { requestId, cacheControl: "no-store" });
});
