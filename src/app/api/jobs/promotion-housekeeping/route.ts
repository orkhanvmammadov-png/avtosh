import { createApiHandler } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { assertCronAuthorized } from "@/lib/jobs/cron-auth";
import { runPromotionHousekeeping } from "@/services/lifecycle-jobs";

export const dynamic = "force-dynamic";

/** Scheduled worker: durable promotion status sync (time windows rule). */
export const GET = createApiHandler(async ({ request, requestId }) => {
  assertCronAuthorized(request);
  const summary = await runPromotionHousekeeping();
  return apiSuccess(summary, { requestId, cacheControl: "no-store" });
});
