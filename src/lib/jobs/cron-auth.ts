import { timingSafeEqual } from "node:crypto";
import { ApiError } from "@/lib/api/errors";

/**
 * Authorization for scheduled-job HTTP endpoints. Vercel Cron invokes
 * the routes with `Authorization: Bearer ${CRON_SECRET}`; the same
 * server-only secret gates manual/test invocation. FAIL CLOSED: a
 * missing secret refuses every request (in every environment) — the
 * jobs are simply not executable over HTTP until CRON_SECRET is
 * provisioned. The secret is never exposed client-side and callers
 * get one uniform 401 regardless of the refusal reason.
 */
export function assertCronAuthorized(request: Request): void {
  const secret = process.env.CRON_SECRET;
  const refused = () => new ApiError("AUTH_REQUIRED", "Unauthorized.");
  if (secret === undefined || secret.length < 16) {
    console.error(JSON.stringify({ evt: "job.auth_unconfigured" }));
    throw refused();
  }
  const header = request.headers.get("authorization") ?? "";
  const expected = Buffer.from(`Bearer ${secret}`);
  const provided = Buffer.from(header);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    throw refused();
  }
}
