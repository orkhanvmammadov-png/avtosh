import { createApiHandler } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { assertCronAuthorized } from "@/lib/jobs/cron-auth";
import { runExpiryReminders } from "@/services/lifecycle-jobs";

export const dynamic = "force-dynamic";

/** Scheduled worker: schedule + deliver WhatsApp expiry reminders. */
export const GET = createApiHandler(async ({ request, requestId }) => {
  assertCronAuthorized(request);
  const summary = await runExpiryReminders();
  return apiSuccess(summary, { requestId, cacheControl: "no-store" });
});
