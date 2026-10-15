import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeSql, getSql, withTransaction } from "@/lib/server/db/client";
import { createTestUserSession } from "./helpers/session";
import {
  campaignDryRunCounts,
  createCampaign,
  findOpenPremiumCampaign,
  listUngrantedEligibleListings,
  stopCampaign,
  type PremiumCampaignRow,
} from "@/repositories/premium-campaigns";
import { insertPromotionPeriod } from "@/repositories/promotions";
import {
  enrollApprovedListingInOpenCampaign,
  grantCampaignPremium,
} from "@/services/premium-campaign";
import { premiumFeed } from "@/services/marketplace";

/**
 * O.16 complimentary Premium campaign against a real database:
 * eligibility, exact duration, paid-tail composition, at-most-once
 * under re-runs and concurrency, feed/badge inclusion without
 * duplicate cards, nonpublic exclusion, and controlled shutdown.
 */

const DAY = 86_400_000;
let ownerId = "";
let campaign: PremiumCampaignRow;
const listings: Record<string, string> = {};
let fixtureIds: { cat: string; brand: string; model: string; city: string };

async function insertListing(
  key: string,
  status: string,
  options: { expired?: boolean; deactivated?: boolean } = {},
): Promise<string> {
  const sql = getSql();
  const [row] = await sql<{ id: string }[]>`
    insert into listings (owner_id, category_id, brand_id, model_id, city_id, year,
      price_minor, mileage, description, contact_phone_e164, seller_name,
      status, published_at, current_expires_at, seller_deactivated_at)
    values (${ownerId}, ${fixtureIds.cat}, ${fixtureIds.brand}, ${fixtureIds.model}, ${fixtureIds.city}, 2022,
      2000000, 1000, 'Pc təsvir', '+994501119999', 'Pc Seller',
      ${status}, ${status === "DRAFT" ? null : new Date()},
      ${options.expired ? new Date(Date.now() - DAY) : new Date(Date.now() + 20 * DAY)},
      ${options.deactivated ? new Date() : null})
    returning id
  `;
  listings[key] = row!.id;
  return row!.id;
}

async function premiumPeriods(listingId: string): Promise<
  { source: string; starts_at: Date; ends_at: Date; payment_id: string | null }[]
> {
  const sql = getSql();
  return sql`
    select source, starts_at, ends_at, payment_id from listing_promotions
    where listing_id = ${listingId} and type = 'PREMIUM'
    order by starts_at
  `;
}

beforeAll(async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set — run via: pnpm test:integration:db");
  }
  const sql = getSql();
  const owner = await createTestUserSession("+994519555666");
  ownerId = owner.userId;
  const [cat] = await sql<{ id: string }[]>`select id from categories where code = 'CAR'`;
  const [brand] = await sql<{ id: string }[]>`
    insert into brands (name, slug) values ('PcBrand', 'pc-brand') returning id`;
  await sql`insert into brand_categories (brand_id, category_id) values (${brand!.id}, ${cat!.id})`;
  const [model] = await sql<{ id: string }[]>`
    insert into models (brand_id, category_id, name, slug)
    values (${brand!.id}, ${cat!.id}, 'PcModel', 'pc-model') returning id`;
  const [city] = await sql<{ id: string }[]>`
    insert into cities (name_az, slug) values ('PcBakı', 'pc-baki') returning id`;
  fixtureIds = { cat: cat!.id, brand: brand!.id, model: model!.id, city: city!.id };

  campaign = await createCampaign(sql, {
    code: `PC-TEST-${randomUUID().slice(0, 8)}`,
    grantDays: 30,
    startsAt: new Date(Date.now() - 60_000),
    endsAt: new Date(Date.now() + 30 * DAY),
  });

  await insertListing("plain", "ACTIVE");
  await insertListing("withPaid", "ACTIVE");
  await insertListing("expired", "ACTIVE", { expired: true });
  await insertListing("deactivated", "ACTIVE", { deactivated: true });
  await insertListing("suspended", "SUSPENDED");
  await insertListing("pending", "PENDING_MODERATION");
  await insertListing("approvalCase", "ACTIVE");
  await insertListing("feedCase", "ACTIVE");

  // Existing PAID premium tail on withPaid: ends in 10 days.
  const [payment] = await sql<{ id: string }[]>`
    insert into payments (user_id, listing_id, type, amount_minor, provider, idempotency_key, status)
    values (${ownerId}, ${listings.withPaid}, 'PREMIUM', 500, 'KAPITAL', ${`pc-test:${randomUUID()}`}, 'SUCCESS')
    returning id
  `;
  await insertPromotionPeriod(sql, {
    listingId: listings.withPaid!,
    type: "PREMIUM",
    packageId: null,
    paymentId: payment!.id,
    durationDays: 10,
    priceMinor: 500,
  });
});

afterAll(async () => {
  await closeSql();
});

describe("eligibility and dry-run", () => {
  it("only ACTIVE, unexpired, non-deactivated listings are backfill candidates", async () => {
    const sql = getSql();
    const candidates = new Set(
      (await listUngrantedEligibleListings(sql, campaign.id, 10_000)).map((r) => r.id),
    );
    expect(candidates.has(listings.plain!)).toBe(true);
    expect(candidates.has(listings.withPaid!)).toBe(true);
    for (const key of ["expired", "deactivated", "suspended", "pending"]) {
      expect(candidates.has(listings[key]!), key).toBe(false);
    }
    const counts = await campaignDryRunCounts(sql, campaign.id);
    expect(counts.alreadyGranted).toBe(0);
    expect(counts.withExistingPremium).toBeGreaterThanOrEqual(1);
    expect(counts.expectedNewGrants).toBe(counts.eligible);
  });
});

describe("grant semantics", () => {
  it("grants exactly 30 days starting now for a listing without Premium", async () => {
    const result = await withTransaction((tx) =>
      grantCampaignPremium(tx, { listingId: listings.plain!, campaign, grantedVia: "BACKFILL" }),
    );
    expect(result.granted).toBe(true);
    const periods = await premiumPeriods(listings.plain!);
    expect(periods).toHaveLength(1);
    expect(periods[0]!.source).toBe("CAMPAIGN");
    expect(periods[0]!.payment_id).toBeNull();
    const duration = periods[0]!.ends_at.getTime() - periods[0]!.starts_at.getTime();
    expect(duration).toBe(30 * DAY);
    expect(Math.abs(periods[0]!.starts_at.getTime() - Date.now())).toBeLessThan(60_000);
  });

  it("appends after an existing paid tail and a later paid purchase queues after the grant", async () => {
    await withTransaction((tx) =>
      grantCampaignPremium(tx, { listingId: listings.withPaid!, campaign, grantedVia: "BACKFILL" }),
    );
    let periods = await premiumPeriods(listings.withPaid!);
    expect(periods.map((p) => p.source)).toEqual(["PAID", "CAMPAIGN"]);
    // complimentary starts exactly where the paid period ends
    expect(periods[1]!.starts_at.getTime()).toBe(periods[0]!.ends_at.getTime());
    expect(periods[1]!.ends_at.getTime() - periods[1]!.starts_at.getTime()).toBe(30 * DAY);
    // paid history untouched
    expect(periods[0]!.payment_id).not.toBeNull();

    // a NEW paid purchase now queues after the complimentary tail
    const sql = getSql();
    const [payment] = await sql<{ id: string }[]>`
      insert into payments (user_id, listing_id, type, amount_minor, provider, idempotency_key, status)
      values (${ownerId}, ${listings.withPaid}, 'PREMIUM', 500, 'KAPITAL', ${`pc-test:${randomUUID()}`}, 'SUCCESS')
      returning id
    `;
    await insertPromotionPeriod(sql, {
      listingId: listings.withPaid!,
      type: "PREMIUM",
      packageId: null,
      paymentId: payment!.id,
      durationDays: 7,
      priceMinor: 500,
    });
    periods = await premiumPeriods(listings.withPaid!);
    expect(periods.map((p) => p.source)).toEqual(["PAID", "CAMPAIGN", "PAID"]);
    expect(periods[2]!.starts_at.getTime()).toBe(periods[1]!.ends_at.getTime());
  });

  it("is at-most-once under re-runs and under concurrent transactions", async () => {
    const repeat = await withTransaction((tx) =>
      grantCampaignPremium(tx, { listingId: listings.plain!, campaign, grantedVia: "BACKFILL" }),
    );
    expect(repeat.granted).toBe(false);
    // Concurrency: two simultaneous grant transactions on a fresh listing.
    const fresh = await insertListing("concurrent", "ACTIVE");
    const results = await Promise.all([
      withTransaction((tx) => grantCampaignPremium(tx, { listingId: fresh, campaign, grantedVia: "BACKFILL" })),
      withTransaction((tx) => grantCampaignPremium(tx, { listingId: fresh, campaign, grantedVia: "APPROVAL" })),
    ]);
    expect(results.filter((r) => r.granted)).toHaveLength(1);
    expect(await premiumPeriods(fresh)).toHaveLength(1);
  });

  it("approval-time enrollment grants once while the window is open", async () => {
    await withTransaction((tx) => enrollApprovedListingInOpenCampaign(tx, listings.approvalCase!));
    await withTransaction((tx) => enrollApprovedListingInOpenCampaign(tx, listings.approvalCase!));
    expect(await premiumPeriods(listings.approvalCase!)).toHaveLength(1);
  });
});

describe("homepage Premium feed", () => {
  it("includes complimentary listings with the badge source, one card each, and never nonpublic listings", async () => {
    await withTransaction((tx) =>
      grantCampaignPremium(tx, { listingId: listings.feedCase!, campaign, grantedVia: "BACKFILL" }),
    );
    // expired listing also gets a grant attempt — must never surface
    const sql = getSql();
    await sql`
      insert into listing_promotions
        (listing_id, type, payment_id, campaign_id, source, starts_at, ends_at, status,
         purchased_duration_days, purchased_price_minor)
      values (${listings.expired}, 'PREMIUM', null, ${campaign.id}, 'CAMPAIGN',
        now(), now() + interval '30 days', 'ACTIVE', 30, 0)
    `;
    // Walk the entire feed (page size is config-capped and the shared
    // integration DB holds other suites' premium fixtures).
    const ids: string[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await premiumFeed(cursor === undefined ? {} : { cursor });
      ids.push(...page.items.map((i) => i.publicId));
      if (!page.hasMore || page.nextCursor === null) break;
      cursor = page.nextCursor;
    }
    const publicIdOf = async (id: string) =>
      (await sql<{ p: string }[]>`select public_id::text as p from listings where id = ${id}`)[0]!.p;
    const feedCasePid = await publicIdOf(listings.feedCase!);
    const withPaidPid = await publicIdOf(listings.withPaid!);
    const expiredPid = await publicIdOf(listings.expired!);
    expect(ids).toContain(feedCasePid);
    // adjacent PAID + CAMPAIGN + PAID periods → exactly one card
    expect(ids.filter((id) => id === withPaidPid)).toHaveLength(1);
    // nonpublic never appears despite its grant
    expect(ids).not.toContain(expiredPid);
  });
});

describe("campaign shutdown", () => {
  it("stop closes enrollment without touching issued grants", async () => {
    const sql = getSql();
    const fresh = await insertListing("afterStop", "ACTIVE");
    expect(await stopCampaign(sql, campaign.code)).toBe(true);
    expect(await findOpenPremiumCampaign(sql)).toBeUndefined();
    await withTransaction((tx) => enrollApprovedListingInOpenCampaign(tx, fresh));
    expect(await premiumPeriods(fresh)).toHaveLength(0);
    // issued grants keep running
    expect(await premiumPeriods(listings.plain!)).toHaveLength(1);
    // double-stop reports honestly
    expect(await stopCampaign(sql, campaign.code)).toBe(false);
  });
});
