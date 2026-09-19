import { createApiHandler } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { assertCronAuthorized } from "@/lib/jobs/cron-auth";
import { runImageCleanup } from "@/services/lifecycle-jobs";

export const dynamic = "force-dynamic";

/** Scheduled worker: reference-checked storage-orphan cleanup for
    O.12 edit-image candidates (idempotent, grace-gated, bounded). */
export const GET = createApiHandler(async ({ request, requestId }) => {
  assertCronAuthorized(request);
  const summary = await runImageCleanup();
  return apiSuccess(summary, { requestId, cacheControl: "no-store" });
});
