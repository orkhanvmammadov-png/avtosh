import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeSql, getSql } from "@/lib/server/db/client";
import { setWhatsAppNotificationProviderForTesting } from "@/providers/whatsapp/notification-factory";
import {
  WhatsAppNotificationError,
  type WhatsAppNotificationProvider,
} from "@/providers/whatsapp/notification-types";
import {
  runExpiryReminders,
  runListingExpiry,
  runPromotionHousekeeping,
} from "@/services/lifecycle-jobs";
import { publicDetail } from "@/services/marketplace";
import { createTestUserSession } from "./helpers/session";
import { api, withEnv } from "./helpers/listing";
import { GET as expireRoute } from "@/app/api/jobs/expire-listings/route";
import { GET as remindersRoute } from "@/app/api/jobs/send-reminders/route";
import { GET as reconcileRoute } from "@/app/api/jobs/reconcile-payments/route";
import { GET as promoJobRoute } from "@/app/api/jobs/promotion-housekeeping/route";

/**
 * Phase 4.16 background workers: expiry transitions (exactly-once
 * under overlap), promotion status housekeeping, period-scoped
 * reminder scheduling/dedupe/suppression/retry, notification worker
 * races, and cron endpoint authorization. Clocks are controlled by
 * writing timestamps — never by sleeping.
 */

let seller: { userId: string };
let carCat = "";

interface MemoryProvider {
  provider: WhatsAppNotificationProvider;
  sends: { phoneE164: string; templateCode: string; params: Record<string, string> }[];
  fail: (error: WhatsAppNotificationError | null) => void;
}

function createMemoryProvider(): MemoryProvider {
  const sends: MemoryProvider["sends"] = [];
  let failure: WhatsAppNotificationError | null = null;
  return {
    sends,
    fail: (error) => {
      failure = error;
    },
    provider: {
      async sendTemplate(input) {
        if (failure !== null) throw failure;
        sends.push(input);
        return { providerMessageId: `mem-${sends.length}` };
      },
    },
  };
}

function installProvider(): MemoryProvider {
  const memory = createMemoryProvider();
  setWhatsAppNotificationProviderForTesting(memory.provider);
  return memory;
}

/** ACTIVE listing + its current period, expiring `endsInHours` from now. */
async function insertListingWithPeriod(endsInHours: number): Promise<{
  listingId: string;
  periodId: string;
  publicId: string;
}> {
  const sql = getSql();
  const [listing] = await sql<{ id: string; public_id: string }[]>`
    insert into listings (owner_id, category_id, status, published_at, current_expires_at)
    values (${seller.userId}, ${carCat}, 'ACTIVE', now() - interval '10 days',
            now() + make_interval(hours => ${endsInHours}))
    returning id, public_id::text as public_id
  `;
  const [period] = await sql<{ id: string }[]>`
    insert into listing_periods (listing_id, period_number, source, starts_at, ends_at, status)
    select ${listing.id}, 1, 'INITIAL', now() - interval '10 days', current_expires_at, 'ACTIVE'
    from listings where id = ${listing.id}
    returning id
  `;
  return { listingId: listing.id, periodId: period.id, publicId: listing.public_id };
}

async function expiryEffects(listingId: string) {
  const sql = getSql();
  const [row] = await sql<Record<string, string>[]>`
    select
      (select status::text from listings where id = ${listingId}) as status,
      (select count(*)::text from listing_status_history
        where listing_id = ${listingId} and to_status = 'EXPIRED'
          and reason_code = 'LISTING_EXPIRED') as history,
      (select count(*)::text from outbox_events
        where aggregate_id = ${listingId} and event_type = 'LISTING_EXPIRED') as outbox,
      (select count(*)::text from listing_periods
        where listing_id = ${listingId} and status = 'EXPIRED') as expired_periods
  `;
  return {
    status: row.status,
    history: Number(row.history),
    outbox: Number(row.outbox),
    expiredPeriods: Number(row.expired_periods),
  };
}

async function notificationsFor(periodId: string) {
  const sql = getSql();
  return sql<
    {
      id: string;
      dedupe_key: string;
      status: string;
      attempt_count: number;
      provider_message_id: string | null;
      cancel_reason: string | null;
      next_retry_at: Date | null;
      scheduled_for: Date;
    }[]
  >`
    select id, dedupe_key, status::text as status, attempt_count, provider_message_id,
           cancel_reason, next_retry_at, scheduled_for
    from notifications where listing_period_id = ${periodId}
    order by dedupe_key
  `;
}

async function forceDue(dedupeKey: string): Promise<void> {
  const sql = getSql();
  await sql`
    update notifications
    set scheduled_for = now() - interval '1 minute', next_retry_at = null
    where dedupe_key = ${dedupeKey}
  `;
}

beforeAll(async () => {
  if (!process.env.DATABASE_URL) throw new Error("run via pnpm test:integration:db");
  const sql = getSql();
  seller = await createTestUserSession("+994524000001");
  carCat = (await sql<{ id: string }[]>`select id from categories where code = 'CAR'`)[0].id;
});

afterEach(() => setWhatsAppNotificationProviderForTesting(null));

afterAll(async () => {
  // Public read-model hygiene for later suites: retire this file's
  // promoted/active fixtures (status-only; time ranges untouched).
  const sql = getSql();
  await sql`
    update listing_promotions set status = 'EXPIRED'
    where listing_id in (select id from listings where owner_id = ${seller.userId})
      and status <> 'EXPIRED'
  `;
  await sql`
    update listings set status = 'EXPIRED'
    where owner_id = ${seller.userId} and status = 'ACTIVE'
  `;
  await closeSql();
});

describe("listing expiry worker", () => {
  it("expires overdue ACTIVE listings exactly once — history, outbox, period sync — and leaves unexpired ones alone", async () => {
    const overdue = await insertListingWithPeriod(-2);
    const stillValid = await insertListingWithPeriod(48);
    // fail-safe visibility check: BEFORE the worker runs, the overdue
    // listing is already publicly gone (time is the read authority)
    const before = await publicDetail(Number(overdue.publicId));
    expect(before.listing.status).toBe("EXPIRED"); // limited view, not active
    expect(before.listing.contactable).toBe(false);

    const summary = await runListingExpiry();
    expect(summary.expired).toBeGreaterThanOrEqual(1);
    expect(await expiryEffects(overdue.listingId)).toEqual({
      status: "EXPIRED",
      history: 1,
      outbox: 1,
      expiredPeriods: 1,
    });
    expect((await expiryEffects(stillValid.listingId)).status).toBe("ACTIVE");

    // idempotent rerun: nothing new for the already-expired listing
    await runListingExpiry();
    expect(await expiryEffects(overdue.listingId)).toEqual({
      status: "EXPIRED",
      history: 1,
      outbox: 1,
      expiredPeriods: 1,
    });
  });

  it("a listing expiring exactly at the boundary transitions; one a second later does not", async () => {
    const sql = getSql();
    const atBoundary = await insertListingWithPeriod(24);
    await sql`update listings set current_expires_at = now() where id = ${atBoundary.listingId}`;
    const ahead = await insertListingWithPeriod(24);
    await sql`update listings set current_expires_at = now() + interval '30 minutes' where id = ${ahead.listingId}`;
    await runListingExpiry();
    expect((await expiryEffects(atBoundary.listingId)).status).toBe("EXPIRED");
    expect((await expiryEffects(ahead.listingId)).status).toBe("ACTIVE");
  });

  it("10 overlapping workers: every overdue listing gets exactly one transition and one history/outbox pair", async () => {
    const fixtures = await Promise.all(
      Array.from({ length: 30 }, () => insertListingWithPeriod(-1)),
    );
    await Promise.all(Array.from({ length: 10 }, () => runListingExpiry()));
    for (const fixture of fixtures) {
      expect(await expiryEffects(fixture.listingId)).toEqual({
        status: "EXPIRED",
        history: 1,
        outbox: 1,
        expiredPeriods: 1,
      });
    }
  });
});

describe("promotion status housekeeping", () => {
  it("synchronizes SCHEDULED→ACTIVE and →EXPIRED without touching windows or listing expiry", async () => {
    const sql = getSql();
    const { listingId } = await insertListingWithPeriod(72);
    const [expiresBefore] = await sql<{ v: string }[]>`
      select current_expires_at::text as v from listings where id = ${listingId}
    `;
    const insertPromo = async (type: string, startOffsetH: number, endOffsetH: number) => {
      const [payment] = await sql<{ id: string }[]>`
        insert into payments (user_id, listing_id, type, amount_minor, currency, idempotency_key, status, provider)
        values (${seller.userId}, ${listingId}, ${type}::payment_type, 100, 'AZN',
                ${`hk:${randomUUID()}`}, 'SUCCESS', 'KAPITAL')
        returning id
      `;
      const [row] = await sql<{ id: string }[]>`
        insert into listing_promotions (listing_id, type, payment_id, starts_at, ends_at, status,
          purchased_duration_days, purchased_price_minor)
        values (${listingId}, ${type}::promotion_type, ${payment.id},
          now() + make_interval(hours => ${startOffsetH}),
          now() + make_interval(hours => ${endOffsetH}), 'SCHEDULED', 1, 100)
        returning id
      `;
      return row.id;
    };
    const started = await insertPromo("PREMIUM", -1, 24); // should become ACTIVE
    const lapsed = await insertPromo("BOOST", -48, -24); // should become EXPIRED
    const future = await insertPromo("PREMIUM", 48, 72); // stays SCHEDULED

    await runPromotionHousekeeping();
    const statusOf = async (id: string) =>
      (await sql<{ s: string }[]>`select status::text as s from listing_promotions where id = ${id}`)[0].s;
    expect(await statusOf(started)).toBe("ACTIVE");
    expect(await statusOf(lapsed)).toBe("EXPIRED");
    expect(await statusOf(future)).toBe("SCHEDULED");

    // idempotent rerun; listing publication expiry untouched
    await runPromotionHousekeeping();
    expect(await statusOf(started)).toBe("ACTIVE");
    const [expiresAfter] = await sql<{ v: string }[]>`
      select current_expires_at::text as v from listings where id = ${listingId}
    `;
    expect(expiresAfter.v).toBe(expiresBefore.v);
  });
});

describe("expiry reminders — scheduling & dedupe", () => {
  it("schedules period-scoped 7/5/3/1 reminders (future send times only) exactly once", async () => {
    installProvider();
    const { periodId } = await insertListingWithPeriod(6 * 24); // ends in 6 days
    await runExpiryReminders();
    const first = await notificationsFor(periodId);
    // D7 send time (expiry day − 7 at 10:00 Baku) is already in the
    // past → never inserted; D5/D3/D1 are future-dated.
    expect(first.map((n) => n.dedupe_key)).toEqual([
      `LISTING_EXPIRY_REMINDER:${periodId}:D1`,
      `LISTING_EXPIRY_REMINDER:${periodId}:D3`,
      `LISTING_EXPIRY_REMINDER:${periodId}:D5`,
    ]);
    for (const n of first) {
      expect(n.status).toBe("SCHEDULED");
      expect(n.scheduled_for.getTime()).toBeGreaterThan(Date.now());
    }
    // cron running twice never duplicates a business notification
    await runExpiryReminders();
    expect((await notificationsFor(periodId)).length).toBe(3);
  });

  it("a listing outside the reminder horizon gets no rows yet", async () => {
    installProvider();
    const { periodId } = await insertListingWithPeriod(30 * 24);
    await runExpiryReminders();
    expect(await notificationsFor(periodId)).toHaveLength(0);
  });

  it("delivers a due reminder once — reruns and 10 overlapping workers never double-send", async () => {
    const memory = installProvider();
    const fixtures = await Promise.all(
      Array.from({ length: 20 }, () => insertListingWithPeriod(6 * 24)),
    );
    await runExpiryReminders(); // schedule only (nothing due yet)
    for (const fixture of fixtures) {
      await forceDue(`LISTING_EXPIRY_REMINDER:${fixture.periodId}:D3`);
    }
    await Promise.all(Array.from({ length: 10 }, () => runExpiryReminders()));
    // each business notification delivered exactly once
    const perKey = new Map<string, number>();
    for (const send of memory.sends) {
      const key = `${send.params.listing_public_id}:${send.params.days_left}`;
      perKey.set(key, (perKey.get(key) ?? 0) + 1);
    }
    for (const fixture of fixtures) {
      const rows = await notificationsFor(fixture.periodId);
      const due = rows.find((n) => n.dedupe_key.endsWith(":D3"))!;
      expect(due.status).toBe("SENT");
      expect(due.provider_message_id).not.toBeNull();
      expect(perKey.get(`${fixture.publicId}:3`)).toBe(1);
    }
    // another run resends nothing
    const sentBefore = memory.sends.length;
    await runExpiryReminders();
    expect(memory.sends.length).toBe(sentBefore);
  });

  it("renewal supersedes old-period reminders: stale rows cancel, the new period gets a fresh identity set", async () => {
    installProvider();
    const sql = getSql();
    const { listingId, periodId: oldPeriod } = await insertListingWithPeriod(4 * 24);
    await runExpiryReminders();
    expect((await notificationsFor(oldPeriod)).length).toBe(2); // D3, D1
    // a renewal-like transition: new period, new expiry
    const [newPeriod] = await sql<{ id: string }[]>`
      insert into listing_periods (listing_id, period_number, source, starts_at, ends_at, status)
      values (${listingId}, 2, 'RENEWAL', now(), now() + interval '6 days', 'ACTIVE')
      returning id
    `;
    await sql`
      update listings
      set current_expires_at = (select ends_at from listing_periods where id = ${newPeriod.id})
      where id = ${listingId}
    `;
    await sql`
      update listing_periods set status = 'EXPIRED' where id = ${oldPeriod}
    `;
    // old rows must never send against the NEW expiry date
    await forceDue(`LISTING_EXPIRY_REMINDER:${oldPeriod}:D3`);
    await runExpiryReminders();
    const oldRows = await notificationsFor(oldPeriod);
    expect(oldRows.find((n) => n.dedupe_key.endsWith(":D3"))!.status).toBe("CANCELLED");
    // the new period got its own fresh reminder identities
    const newRows = await notificationsFor(newPeriod.id);
    expect(newRows.map((n) => n.dedupe_key)).toEqual([
      `LISTING_EXPIRY_REMINDER:${newPeriod.id}:D1`,
      `LISTING_EXPIRY_REMINDER:${newPeriod.id}:D3`,
      `LISTING_EXPIRY_REMINDER:${newPeriod.id}:D5`,
    ]);
  });

  it("suppression: SOLD cancels, SUSPENDED defers without burning the identity", async () => {
    installProvider();
    const sql = getSql();
    const sold = await insertListingWithPeriod(6 * 24);
    const suspended = await insertListingWithPeriod(6 * 24);
    await runExpiryReminders();
    await sql`update listings set status = 'SOLD', sold_at = now() where id = ${sold.listingId}`;
    await sql`update listings set status = 'SUSPENDED' where id = ${suspended.listingId}`;
    await forceDue(`LISTING_EXPIRY_REMINDER:${sold.periodId}:D3`);
    await forceDue(`LISTING_EXPIRY_REMINDER:${suspended.periodId}:D3`);
    await runExpiryReminders();

    const soldRow = (await notificationsFor(sold.periodId)).find((n) => n.dedupe_key.endsWith(":D3"))!;
    expect(soldRow.status).toBe("CANCELLED");
    expect(soldRow.cancel_reason).toBe("NO_LONGER_ELIGIBLE");

    const suspendedRow = (await notificationsFor(suspended.periodId)).find((n) =>
      n.dedupe_key.endsWith(":D3"),
    )!;
    expect(suspendedRow.status).toBe("SCHEDULED"); // deferred, not cancelled
    expect(suspendedRow.next_retry_at).not.toBeNull();
    expect(suspendedRow.attempt_count).toBe(0);

    // restored listing: the deferred reminder still delivers
    await sql`update listings set status = 'ACTIVE' where id = ${suspended.listingId}`;
    await sql`
      update notifications set next_retry_at = now() - interval '1 second'
      where dedupe_key = ${`LISTING_EXPIRY_REMINDER:${suspended.periodId}:D3`}
    `;
    await runExpiryReminders();
    expect(
      (await notificationsFor(suspended.periodId)).find((n) => n.dedupe_key.endsWith(":D3"))!.status,
    ).toBe("SENT");
  });

  it("transient failures retry with backoff under the same identity; permanent and exhausted fail terminally", async () => {
    const memory = installProvider();
    const sql = getSql();
    const fixture = await insertListingWithPeriod(6 * 24);
    await runExpiryReminders();
    const key = `LISTING_EXPIRY_REMINDER:${fixture.periodId}:D3`;
    await forceDue(key);

    memory.fail(new WhatsAppNotificationError("TRANSIENT", "bsp 503"));
    await runExpiryReminders();
    let row = (await notificationsFor(fixture.periodId)).find((n) => n.dedupe_key === key)!;
    expect(row.status).toBe("SCHEDULED"); // same row, same identity
    expect(row.attempt_count).toBe(1);
    expect(row.next_retry_at!.getTime()).toBeGreaterThan(Date.now());
    expect((await notificationsFor(fixture.periodId)).length).toBe(3); // no duplicate rows

    // backoff elapses, provider recovers → delivered under the same key
    memory.fail(null);
    await forceDue(key);
    await runExpiryReminders();
    row = (await notificationsFor(fixture.periodId)).find((n) => n.dedupe_key === key)!;
    expect(row.status).toBe("SENT");
    expect(row.attempt_count).toBe(2);

    // permanent failure → FAILED immediately
    const permanent = await insertListingWithPeriod(6 * 24);
    await runExpiryReminders();
    const permanentKey = `LISTING_EXPIRY_REMINDER:${permanent.periodId}:D3`;
    await forceDue(permanentKey);
    memory.fail(new WhatsAppNotificationError("PERMANENT", "template rejected"));
    await runExpiryReminders();
    const permanentRow = (await notificationsFor(permanent.periodId)).find(
      (n) => n.dedupe_key === permanentKey,
    )!;
    expect(permanentRow.status).toBe("FAILED");

    // retry budget exhausted → FAILED, no infinite loop
    const exhausted = await insertListingWithPeriod(6 * 24);
    await runExpiryReminders();
    const exhaustedKey = `LISTING_EXPIRY_REMINDER:${exhausted.periodId}:D3`;
    await forceDue(exhaustedKey);
    await sql`update notifications set attempt_count = 5 where dedupe_key = ${exhaustedKey}`;
    memory.fail(new WhatsAppNotificationError("TRANSIENT", "bsp 503"));
    await runExpiryReminders();
    expect(
      (await notificationsFor(exhausted.periodId)).find((n) => n.dedupe_key === exhaustedKey)!.status,
    ).toBe("FAILED");
  });

  it("without a configured provider the job schedules but never claims or fabricates delivery", async () => {
    setWhatsAppNotificationProviderForTesting(null, { active: true }); // simulate production-unconfigured
    const fixture = await insertListingWithPeriod(6 * 24);
    const summary = await runExpiryReminders();
    expect(summary.providerConfigured).toBe(false);
    expect(summary.sent).toBe(0);
    const rows = await notificationsFor(fixture.periodId);
    expect(rows.length).toBe(3); // scheduling still happened
    for (const row of rows) {
      expect(row.status).toBe("SCHEDULED");
      expect(row.provider_message_id).toBeNull();
    }
  });
});

describe("cron endpoint security", () => {
  const routes: [string, typeof expireRoute, string][] = [
    ["expire", expireRoute, "http://localhost/api/jobs/expire-listings"],
    ["reminders", remindersRoute, "http://localhost/api/jobs/send-reminders"],
    ["reconcile", reconcileRoute, "http://localhost/api/jobs/reconcile-payments"],
    ["promotions", promoJobRoute, "http://localhost/api/jobs/promotion-housekeeping"],
  ];

  it("refuses missing/wrong credentials and a missing secret (fail closed); accepts the real secret", async () => {
    installProvider();
    await withEnv({ CRON_SECRET: "integration-cron-secret-0123456789" }, async () => {
      for (const [, route, url] of routes) {
        expect((await api(route, "GET", url)).status).toBe(401);
        const wrong = await api(route, "GET", url, {
          headers: { authorization: "Bearer wrong-secret-wrong-secret" },
        });
        expect(wrong.status).toBe(401);
        const ok = await api(route, "GET", url, {
          headers: { authorization: "Bearer integration-cron-secret-0123456789" },
        });
        expect(ok.status).toBe(200);
      }
    });
    // no secret configured at all → nothing is executable
    const saved = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    try {
      for (const [, route, url] of routes) {
        const refused = await api(route, "GET", url, {
          headers: { authorization: "Bearer integration-cron-secret-0123456789" },
        });
        expect(refused.status).toBe(401);
      }
    } finally {
      if (saved !== undefined) process.env.CRON_SECRET = saved;
    }
  });
});
