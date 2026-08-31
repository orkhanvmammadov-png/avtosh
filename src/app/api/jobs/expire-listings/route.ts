import { createApiHandler } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { assertCronAuthorized } from "@/lib/jobs/cron-auth";
import { runListingExpiry } from "@/services/lifecycle-jobs";

export const dynamic = "force-dynamic";

/** Scheduled worker: overdue ACTIVE listings → EXPIRED (idempotent). */
export const GET = createApiHandler(async ({ request, requestId }) => {
  assertCronAuthorized(request);
  const summary = await runListingExpiry();
  return apiSuccess(summary, { requestId, cacheControl: "no-store" });
});
