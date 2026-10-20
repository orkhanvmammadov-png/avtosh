import { createApiHandler } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { assertCronAuthorized } from "@/lib/jobs/cron-auth";
import { runGuestDraftCleanup } from "@/services/guest-draft-cleanup";

export const dynamic = "force-dynamic";

/** Expired guest-draft cleanup worker (deferred-login PR A). Prepared
    but deliberately NOT scheduled in vercel.json yet — it is invoked
    manually/tests-only until the guest journey ships. Condemn-first:
    the row is deleted together with a durable storage-cleanup record
    in one transaction; objects are deleted afterwards from that
    record, with lease-based reclaim so an interrupted worker's events
    are recovered on a later run. */
export const GET = createApiHandler(async ({ request, requestId }) => {
  assertCronAuthorized(request);
  const summary = await runGuestDraftCleanup();
  return apiSuccess(summary, { requestId, cacheControl: "no-store" });
});
