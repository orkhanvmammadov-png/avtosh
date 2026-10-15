import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeSql, getSql, withTransaction } from "@/lib/server/db/client";
import { createTestUserSession } from "./helpers/session";
import {
  campaignDryRunCounts,
  createCampaign,
  lockOpenPremiumCampaign,
  listUngrantedEligibleListings,
  openCampaignEnrollment,
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
 * DRAFT→ENROLLING→STOPPED lifecycle (no grant before the explicit
 * opening), enrollment-window boundaries inside the grant
 * transaction, stop-vs-grant races via the FOR SHARE row lock,
 * eligibility, exact duration, paid-tail composition, at-most-once,
 * feed inclusion and nonpublic exclusion.
 */

const DAY = 86_400_000;
let ownerId = "";
let campaign: PremiumCampaignRow;
const listings: Record<string, string> = {};
let fixtureIds: { cat: string; brand: string; model: string; city: string };

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

/** ENROLLING campaign with an arbitrary window (boundary fixtures). */
async function enrollingCampaign(startsAt: Date, endsAt: Date): Promise<PremiumCampaignRow> {
  const sql = getSql();
  const created = await createCampaign(sql, {
    code: `PC-B-${randomUUID().slice(0, 8)}`,
    grantDays: 30,
    startsAt,
    endsAt,
  });
  await sql`update premium_campaigns set status = 'ENROLLING', opened_at = now() where id = ${created.id}`;
  return { ...created, status: "ENROLLING" };
}

const grant = (listingId: string, campaignId: string) =>
  withTransaction((tx) => grantCampaignPremium(tx, { listingId, campaignId, grantedVia: "BACKFILL" }));

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

  await insertListing("plain", "ACTIVE");
  await insertListing("withPaid", "ACTIVE");
  await insertListing("expired", "ACTIVE", { expired: true });
  await insertListing("deactivated", "ACTIVE", { deactivated: true });
  await insertListing("suspended", "SUSPENDED");
  await insertListing("pending", "PENDING_MODERATION");
  await insertListing("approvalCase", "ACTIVE");
  await insertListing("feedCase", "ACTIVE");
  await insertListing("draftGap", "ACTIVE");

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

describe("lifecycle: a DRAFT campaign grants nothing until the explicit opening", () => {
  it("prepare → approval in the gap → dry-run → open → enrollment live", async () => {
    const sql = getSql();
    campaign = await createCampaign(sql, {
      code: `PC-MAIN-${randomUUID().slice(0, 8)}`,
      grantDays: 30,
      startsAt: new Date(Date.now() - 60_000),
      endsAt: new Date(Date.now() + 30 * DAY),
    });
    expect(campaign.status).toBe("DRAFT");

    // An approval BETWEEN --prepare and --open grants NOTHING.
    await withTransaction((tx) => enrollApprovedListingInOpenCampaign(tx, listings.draftGap!));
    expect(await premiumPeriods(listings.draftGap!)).toHaveLength(0);
    // Direct grants against a DRAFT campaign refuse too.
    const refused = await grant(listings.draftGap!, campaign.id);
    expect(refused).toMatchObject({ granted: false, reason: "CAMPAIGN_CLOSED" });

    // Dry-run works on DRAFT (read-only preparation review).
    const counts = await campaignDryRunCounts(sql, campaign.id);
    expect(counts.alreadyGranted).toBe(0);
    expect(counts.expectedNewGrants).toBe(counts.eligible);

    // The explicit opening — only valid inside the window, only from DRAFT.
    expect(await openCampaignEnrollment(sql, campaign.code)).toBe("OPENED");
    expect(await openCampaignEnrollment(sql, campaign.code)).toBe("NOT_DRAFT");
    campaign = { ...campaign, status: "ENROLLING" };
  });

  it("opening is rejected outside the configured window", async () => {
    const sql = getSql();
    const future = await createCampaign(sql, {
      code: `PC-FUT-${randomUUID().slice(0, 8)}`,
      grantDays: 30,
      startsAt: new Date(Date.now() + DAY),
      endsAt: new Date(Date.now() + 31 * DAY),
    });
    expect(await openCampaignEnrollment(sql, future.code)).toBe("OUTSIDE_WINDOW");
    const past = await createCampaign(sql, {
      code: `PC-PAST-${randomUUID().slice(0, 8)}`,
      grantDays: 30,
      startsAt: new Date(Date.now() - 31 * DAY),
      endsAt: new Date(Date.now() - DAY),
    });
    expect(await openCampaignEnrollment(sql, past.code)).toBe("OUTSIDE_WINDOW");
    expect(await openCampaignEnrollment(sql, "no-such-code")).toBe("NOT_FOUND");
  });
});

describe("enrollment-window boundaries enforced inside the grant transaction", () => {
  it("refuses immediately before start; grants at start and immediately before end; refuses at/after end", async () => {
    const sql = getSql();
    const target = await insertListing("boundary", "ACTIVE");

    const beforeStart = await enrollingCampaign(
      new Date(Date.now() + 3_600_000),
      new Date(Date.now() + 30 * DAY),
    );
    expect(await grant(target, beforeStart.id)).toMatchObject({ granted: false, reason: "CAMPAIGN_CLOSED" });

    const atOrAfterEnd = await enrollingCampaign(
      new Date(Date.now() - 30 * DAY),
      new Date(Date.now() - 50),
    );
    expect(await grant(target, atOrAfterEnd.id)).toMatchObject({ granted: false, reason: "CAMPAIGN_CLOSED" });

    const atStart = await enrollingCampaign(new Date(Date.now() - 50), new Date(Date.now() + 30 * DAY));
    expect((await grant(target, atStart.id)).granted).toBe(true);
    await stopCampaign(sql, atStart.code);

    const beforeEnd = await enrollingCampaign(new Date(Date.now() - DAY), new Date(Date.now() + 5_000));
    const second = await insertListing("boundary2", "ACTIVE");
    expect((await grant(second, beforeEnd.id)).granted).toBe(true);
    await stopCampaign(sql, beforeEnd.code);
    // zero stray grants beyond the two expected
    expect(await premiumPeriods(target)).toHaveLength(1);
    expect(await premiumPeriods(second)).toHaveLength(1);
  });
});

describe("eligibility and grant semantics", () => {
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
  });

  it("grants exactly 30 days starting now for a listing without Premium", async () => {
    const result = await grant(listings.plain!, campaign.id);
    expect(result.granted).toBe(true);
    const periods = await premiumPeriods(listings.plain!);
    expect(periods).toHaveLength(1);
    expect(periods[0]!.source).toBe("CAMPAIGN");
    expect(periods[0]!.payment_id).toBeNull();
    expect(periods[0]!.ends_at.getTime() - periods[0]!.starts_at.getTime()).toBe(30 * DAY);
    expect(Math.abs(periods[0]!.starts_at.getTime() - Date.now())).toBeLessThan(60_000);
  });

  it("appends after an existing paid tail and a later paid purchase queues after the grant", async () => {
    await grant(listings.withPaid!, campaign.id);
    let periods = await premiumPeriods(listings.withPaid!);
    expect(periods.map((p) => p.source)).toEqual(["PAID", "CAMPAIGN"]);
    expect(periods[1]!.starts_at.getTime()).toBe(periods[0]!.ends_at.getTime());
    expect(periods[1]!.ends_at.getTime() - periods[1]!.starts_at.getTime()).toBe(30 * DAY);
    expect(periods[0]!.payment_id).not.toBeNull();

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
    const repeat = await grant(listings.plain!, campaign.id);
    expect(repeat).toMatchObject({ granted: false, reason: "ALREADY_GRANTED" });
    const fresh = await insertListing("concurrent", "ACTIVE");
    const results = await Promise.all([grant(fresh, campaign.id), grant(fresh, campaign.id)]);
    expect(results.filter((r) => r.granted)).toHaveLength(1);
    expect(await premiumPeriods(fresh)).toHaveLength(1);
  });

  it("approval-time enrollment grants once while the window is open, with the outbox event", async () => {
    await withTransaction((tx) => enrollApprovedListingInOpenCampaign(tx, listings.approvalCase!));
    await withTransaction((tx) => enrollApprovedListingInOpenCampaign(tx, listings.approvalCase!));
    expect(await premiumPeriods(listings.approvalCase!)).toHaveLength(1);
    const sql = getSql();
    const [outbox] = await sql<{ n: string }[]>`
      select count(*)::text as n from outbox_events
      where event_type = 'PROMOTION_ACTIVATED' and aggregate_id = ${listings.approvalCase}
        and payload->>'source' = 'CAMPAIGN'
    `;
    expect(Number(outbox!.n)).toBe(1); // side effects committed exactly once
  });
});

describe("homepage Premium feed", () => {
  it("includes complimentary listings, one card each, and never nonpublic listings", async () => {
    await grant(listings.feedCase!, campaign.id);
    const sql = getSql();
    await sql`
      insert into listing_promotions
        (listing_id, type, payment_id, campaign_id, source, starts_at, ends_at, status,
         purchased_duration_days, purchased_price_minor)
      values (${listings.expired}, 'PREMIUM', null, ${campaign.id}, 'CAMPAIGN',
        now(), now() + interval '30 days', 'ACTIVE', 30, 0)
    `;
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
    expect(ids).toContain(await publicIdOf(listings.feedCase!));
    const withPaidPid = await publicIdOf(listings.withPaid!);
    expect(ids.filter((id) => id === withPaidPid)).toHaveLength(1);
    expect(ids).not.toContain(await publicIdOf(listings.expired!));
  });
});

describe("stop is race-safe against in-flight grants", () => {
  it("a stop waits for a grant transaction holding the FOR SHARE lock, then blocks all later grants", async () => {
    const sql = getSql();
    const raceCampaign = await enrollingCampaign(
      new Date(Date.now() - 60_000),
      new Date(Date.now() + 30 * DAY),
    );
    const inFlight = await insertListing("raceInFlight", "ACTIVE");
    const afterStop = await insertListing("raceAfter", "ACTIVE");

    let grantCommittedAt = 0;
    const grantTx = withTransaction(async (tx) => {
      const result = await grantCampaignPremium(tx, {
        listingId: inFlight,
        campaignId: raceCampaign.id,
        grantedVia: "BACKFILL",
      });
      await delay(400); // hold the FOR SHARE lock across the stop attempt
      grantCommittedAt = Date.now();
      return result;
    });
    await delay(100); // the grant tx is inside its transaction now
    const stopStartedAt = Date.now();
    const stopPromise = stopCampaign(sql, raceCampaign.code).then((stopped) => ({
      stopped,
      at: Date.now(),
    }));
    const [grantResult, stopResult] = await Promise.all([grantTx, stopPromise]);

    // The in-flight grant succeeded; the stop WAITED for its commit.
    expect(grantResult.granted).toBe(true);
    expect(stopResult.stopped).toBe(true);
    expect(stopResult.at).toBeGreaterThanOrEqual(grantCommittedAt);
    expect(stopResult.at - stopStartedAt).toBeGreaterThanOrEqual(250);

    // After the committed stop, no grant can pass the locked read.
    const late = await grant(afterStop, raceCampaign.id);
    expect(late).toMatchObject({ granted: false, reason: "CAMPAIGN_CLOSED" });
    expect(await premiumPeriods(inFlight)).toHaveLength(1); // preserved
    expect(await premiumPeriods(afterStop)).toHaveLength(0);
  });
});

describe("campaign shutdown", () => {
  it("stop closes enrollment without touching issued grants", async () => {
    const sql = getSql();
    const fresh = await insertListing("afterMainStop", "ACTIVE");
    expect(await stopCampaign(sql, campaign.code)).toBe(true);
    expect(await lockOpenPremiumCampaign(sql)).toBeUndefined();
    await withTransaction((tx) => enrollApprovedListingInOpenCampaign(tx, fresh));
    expect(await premiumPeriods(fresh)).toHaveLength(0);
    expect(await premiumPeriods(listings.plain!)).toHaveLength(1);
    expect(await stopCampaign(sql, campaign.code)).toBe(false);
  });
});
