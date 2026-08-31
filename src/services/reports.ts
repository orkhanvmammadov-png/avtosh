import { ApiError } from "@/lib/api/errors";
import { marketplaceConfig } from "@/lib/config/marketplace";
import { getSql } from "@/lib/server/db/client";
import {
  countAnonymousActions,
  recordAnonymousAction,
} from "@/repositories/marketplace";

/**
 * Buyer-side listing report intake (Phase 4.16 MVP). Anonymous
 * reporting with layered abuse protection over the accepted
 * anonymous_action_events infrastructure (privacy-preserving keyed IP
 * hash — raw IPs are never stored). The response NEVER returns report
 * ids, reporter data, or staff metadata; sellers cannot learn who
 * reported them. Reports land as OPEN listing_reports rows managed by
 * the Phase 4.15 admin workflow.
 */

/** Controlled server reason codes (also DB-constrained, migration 019). */
export const REPORT_REASON_CODES = [
  "WRONG_INFORMATION",
  "DUPLICATE",
  "FRAUD_SUSPECTED",
  "SOLD_OR_UNAVAILABLE",
  "PROHIBITED_CONTENT",
  "OTHER",
] as const;
export type ReportReasonCode = (typeof REPORT_REASON_CODES)[number];

export const LISTING_REPORT_ACTION = "LISTING_REPORT";

export async function submitListingReport(
  publicId: number,
  sourceHash: string | null,
  input: { reasonCode: ReportReasonCode; note: string | null },
): Promise<void> {
  const sql = getSql();
  // Reportable = exactly the publicly reachable detail statuses
  // (Phase 4.8: full/limited views). Anything else — SUSPENDED,
  // DELETED, pre-publication — answers with the same uniform 404 the
  // detail page gives, so the endpoint cannot be used as an oracle
  // for hidden listings.
  const rows = await sql<{ id: string }[]>`
    select id from listings
    where public_id = ${publicId}
      and status in ('ACTIVE', 'SOLD', 'EXPIRED')
  `;
  const listing = rows[0];
  if (listing === undefined) {
    throw new ApiError("LISTING_NOT_FOUND", "Listing not found.");
  }

  // Technical anti-abuse windows (config): one report per source per
  // listing, and a bounded number of reports per source overall.
  // Without a trustworthy client IP (local dev) limiting is skipped
  // rather than trusting fabrication — production platforms always
  // provide one. Small concurrent overshoot is acceptable for an
  // abuse threshold (not a business rule).
  if (sourceHash !== null) {
    const config = marketplaceConfig();
    const since = new Date(Date.now() - config.reportWindowSeconds * 1000);
    const rateLimited = (): never => {
      throw new ApiError("REPORT_RATE_LIMITED", "Too many reports. Try again later.", {
        details: { retry_after_seconds: config.reportWindowSeconds },
      });
    };
    const perListing = await countAnonymousActions(sql, {
      action: LISTING_REPORT_ACTION,
      sourceHash,
      subjectId: listing.id,
      since,
    });
    if (perListing >= config.reportPerListing) rateLimited();
    const perSource = await countAnonymousActions(sql, {
      action: LISTING_REPORT_ACTION,
      sourceHash,
      since,
    });
    if (perSource >= config.reportPerSource) rateLimited();
    await recordAnonymousAction(sql, {
      action: LISTING_REPORT_ACTION,
      sourceHash,
      subjectId: listing.id,
    });
  }

  // Anonymous MVP: no reporter identity is stored on the report row
  // itself — the seller/public can never learn a reporter, and staff
  // metadata stays in the admin domain.
  await sql`
    insert into listing_reports (listing_id, reason_code, note, status)
    values (${listing.id}, ${input.reasonCode}, ${input.note}, 'OPEN')
  `;
}
