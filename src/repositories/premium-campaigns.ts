import type { Sql } from "@/lib/server/db/client";
import { publicVisible } from "@/repositories/marketplace";

/** Complimentary Premium campaign rows (O.16). */

export interface PremiumCampaignRow {
  id: string;
  code: string;
  grant_days: number;
  enrollment_starts_at: Date;
  enrollment_ends_at: Date;
  status: "DRAFT" | "ENROLLING" | "STOPPED";
}

const CAMPAIGN_SELECT = `id, code, grant_days,
  enrollment_starts_at, enrollment_ends_at, status`;

export async function findCampaignByCode(
  sql: Sql,
  code: string,
): Promise<PremiumCampaignRow | undefined> {
  const rows = await sql<PremiumCampaignRow[]>`
    select id, code, grant_days, enrollment_starts_at, enrollment_ends_at, status
    from premium_campaigns where code = ${code}
  `;
  return rows[0];
}

/**
 * The campaign that may grant RIGHT NOW: status ENROLLING and now
 * within [starts, ends). Locked FOR SHARE so a concurrent --stop
 * (an UPDATE on the row) blocks until this grant transaction
 * commits, and once a stop has committed no later grant transaction
 * can pass this predicate — the enforcement is the database's row
 * lock, never a status read before a long-running loop. MUST be
 * called inside the transaction that inserts the grant. At most one
 * open campaign is expected; the newest wins deterministically.
 */
export async function lockOpenPremiumCampaign(
  sql: Sql,
): Promise<PremiumCampaignRow | undefined> {
  const rows = await sql<PremiumCampaignRow[]>`
    select id, code, grant_days, enrollment_starts_at, enrollment_ends_at, status
    from premium_campaigns
    where status = 'ENROLLING'
      and enrollment_starts_at <= now()
      and enrollment_ends_at > now()
    order by enrollment_starts_at desc
    limit 1
    for share
  `;
  return rows[0];
}

/** Same locked read for ONE specific campaign (backfill path). */
export async function lockCampaignForGrant(
  sql: Sql,
  campaignId: string,
): Promise<PremiumCampaignRow | undefined> {
  const rows = await sql<PremiumCampaignRow[]>`
    select id, code, grant_days, enrollment_starts_at, enrollment_ends_at, status
    from premium_campaigns
    where id = ${campaignId}
      and status = 'ENROLLING'
      and enrollment_starts_at <= now()
      and enrollment_ends_at > now()
    for share
  `;
  return rows[0];
}

/**
 * The ONE explicit opening operation (DRAFT → ENROLLING). Rejected
 * unless now is inside the configured window — opening outside the
 * window has no meaningful semantics and would otherwise create a
 * campaign that silently never (or retroactively) grants.
 */
export async function openCampaignEnrollment(
  sql: Sql,
  code: string,
): Promise<"OPENED" | "NOT_DRAFT" | "OUTSIDE_WINDOW" | "NOT_FOUND"> {
  const campaign = await findCampaignByCode(sql, code);
  if (campaign === undefined) return "NOT_FOUND";
  if (campaign.status !== "DRAFT") return "NOT_DRAFT";
  const rows = await sql<{ id: string }[]>`
    update premium_campaigns
    set status = 'ENROLLING', opened_at = now()
    where code = ${code} and status = 'DRAFT'
      and enrollment_starts_at <= now()
      and enrollment_ends_at > now()
    returning id
  `;
  return rows.length > 0 ? "OPENED" : "OUTSIDE_WINDOW";
}

export async function createCampaign(
  sql: Sql,
  input: { code: string; grantDays: number; startsAt: Date; endsAt: Date },
): Promise<PremiumCampaignRow> {
  const rows = await sql<PremiumCampaignRow[]>`
    insert into premium_campaigns (code, grant_days, enrollment_starts_at, enrollment_ends_at)
    values (${input.code}, ${input.grantDays}, ${input.startsAt}, ${input.endsAt})
    returning id, code, grant_days, enrollment_starts_at, enrollment_ends_at, status
  `;
  return rows[0]!;
}

/**
 * Controlled stop: enrollment closes; issued grants are untouched.
 * The UPDATE waits for in-flight grant transactions (they hold the
 * row FOR SHARE) and, once committed, every later grant transaction
 * fails the locked ENROLLING read — database-enforced, race-safe.
 */
export async function stopCampaign(sql: Sql, code: string): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    update premium_campaigns
    set status = 'STOPPED', stopped_at = now()
    where code = ${code} and status in ('DRAFT', 'ENROLLING')
    returning id
  `;
  return rows.length > 0;
}

export interface CampaignDryRunCounts {
  eligible: number;
  withExistingPremium: number;
  alreadyGranted: number;
  expectedNewGrants: number;
}

/** Read-only backfill preview over the public-visibility invariant. */
export async function campaignDryRunCounts(
  sql: Sql,
  campaignId: string,
): Promise<CampaignDryRunCounts> {
  const rows = await sql<
    { eligible: string; with_premium: string; already_granted: string; expected: string }[]
  >`
    with eligible as (
      select l.id from listings l where ${publicVisible(sql)}
    )
    select
      (select count(*) from eligible)::text as eligible,
      (select count(distinct p.listing_id) from listing_promotions p
        join eligible e on e.id = p.listing_id
        where p.type = 'PREMIUM' and p.source = 'PAID'
          and p.status in ('SCHEDULED','ACTIVE') and p.ends_at > now())::text as with_premium,
      (select count(*) from listing_promotions p
        join eligible e on e.id = p.listing_id
        where p.campaign_id = ${campaignId})::text as already_granted,
      (select count(*) from eligible e
        where not exists (
          select 1 from listing_promotions p
          where p.listing_id = e.id and p.campaign_id = ${campaignId}
        ))::text as expected
  `;
  const row = rows[0]!;
  return {
    eligible: Number(row.eligible),
    withExistingPremium: Number(row.with_premium),
    alreadyGranted: Number(row.already_granted),
    expectedNewGrants: Number(row.expected),
  };
}

/** Bounded, resumable batch: eligible listings WITHOUT a grant yet. */
export async function listUngrantedEligibleListings(
  sql: Sql,
  campaignId: string,
  limit: number,
): Promise<{ id: string }[]> {
  return sql<{ id: string }[]>`
    select l.id from listings l
    where ${publicVisible(sql)}
      and not exists (
        select 1 from listing_promotions p
        where p.listing_id = l.id and p.campaign_id = ${campaignId}
      )
    order by l.id
    limit ${limit}
  `;
}
