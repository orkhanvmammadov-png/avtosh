import type { Sql } from "@/lib/server/db/client";
import { publicVisible } from "@/repositories/marketplace";

/** Complimentary Premium campaign rows (O.16). */

export interface PremiumCampaignRow {
  id: string;
  code: string;
  grant_days: number;
  enrollment_starts_at: Date;
  enrollment_ends_at: Date;
  status: "ACTIVE" | "STOPPED";
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
 * The campaign whose enrollment window is open RIGHT NOW (status
 * ACTIVE, now within [starts, ends)). At most one is expected; the
 * newest wins deterministically if operators ever overlap two.
 */
export async function findOpenPremiumCampaign(
  sql: Sql,
): Promise<PremiumCampaignRow | undefined> {
  const rows = await sql<PremiumCampaignRow[]>`
    select id, code, grant_days, enrollment_starts_at, enrollment_ends_at, status
    from premium_campaigns
    where status = 'ACTIVE'
      and enrollment_starts_at <= now()
      and enrollment_ends_at > now()
    order by enrollment_starts_at desc
    limit 1
  `;
  return rows[0];
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

/** Controlled stop: enrollment closes; issued grants are untouched. */
export async function stopCampaign(sql: Sql, code: string): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    update premium_campaigns
    set status = 'STOPPED', stopped_at = now()
    where code = ${code} and status = 'ACTIVE'
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
