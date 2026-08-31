import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeSql, getSql } from "@/lib/server/db/client";
import { setPaymentProviderForTesting } from "@/providers/payments/factory";
import {
  PaymentProviderError,
  type CreateOrderInput,
  type PaymentProviderClient,
  type ProviderOrderDetails,
} from "@/providers/payments/types";
import {
  handleKapitalCallback,
  verifyProviderPayment,
} from "@/services/payment-checkout";
import { runPaymentReconciliation } from "@/services/lifecycle-jobs";
import { publicDetail } from "@/services/marketplace";
import { createTestUserSession } from "./helpers/session";
import { api, withEnv } from "./helpers/listing";
import { GET as renewalStateRoute } from "@/app/api/v1/me/listings/[listingId]/renewal/route";
import { POST as renewalCheckoutRoute } from "@/app/api/v1/me/listings/[listingId]/renewal/checkout/route";

/**
 * Phase 4.16 renewal: eligibility, settings-snapshot pricing, single
 * open intent under concurrency, Kapital-core reuse, exactly-once
 * fulfillment (new sequential period, EXPIRED → ACTIVE), and the
 * scheduled reconciliation path.
 */

interface FakeOrder {
  id: string;
  amountMajor: string;
  currency: string;
  status: string;
}

function createFakeKapital() {
  const orders = new Map<string, FakeOrder>();
  let counter = 0;
  const state = { createCalls: 0, getCalls: 0 };
  const client: PaymentProviderClient = {
    async createOrder(input: CreateOrderInput) {
      state.createCalls += 1;
      counter += 1;
      const id = `rn-${counter}-${randomUUID().slice(0, 8)}`;
      orders.set(id, { id, amountMajor: input.amountMajor, currency: input.currency, status: "Preparing" });
      return { providerOrderId: id, hppUrl: "https://fake-kapital.test/flex", hppSecret: `pw-${id}`, status: "Preparing" };
    },
    async getOrderDetails(providerOrderId: string): Promise<ProviderOrderDetails> {
      state.getCalls += 1;
      const order = orders.get(providerOrderId);
      if (order === undefined) throw new PaymentProviderError("CONTRACT", "OrderNotFound");
      return {
        providerOrderId: order.id,
        status: order.status,
        amountMinor: Number(order.amountMajor.replace(".", "")),
        currency: order.currency,
        providerTransactionId: null,
      };
    },
  };
  return { client, orders, state };
}

let fake = createFakeKapital();
let seller: { userId: string; cookie: string };
let otherSeller: { userId: string; cookie: string };
let blockedSeller: { userId: string; cookie: string };
let carCat = "";
let originalSettings: { key: string; value: string }[] = [];

function installFake() {
  fake = createFakeKapital();
  setPaymentProviderForTesting(fake.client);
  return fake;
}

const stateUrl = (id: string) => `http://localhost/api/v1/me/listings/${id}/renewal`;
const checkoutUrl = (id: string) => `http://localhost/api/v1/me/listings/${id}/renewal/checkout`;

async function renewalGet(listingId: string, cookie?: string) {
  return api(renewalStateRoute, "GET", stateUrl(listingId), { cookie, params: { listingId } });
}

async function renewalCheckout(listingId: string, cookie?: string) {
  return api(renewalCheckoutRoute, "POST", checkoutUrl(listingId), {
    cookie,
    params: { listingId },
    body: {},
  });
}

/** EXPIRED listing with its lapsed initial period. */
async function insertExpiredListing(ownerId = seller.userId): Promise<{ id: string; publicId: string }> {
  const sql = getSql();
  const [listing] = await sql<{ id: string; public_id: string }[]>`
    insert into listings (owner_id, category_id, status, published_at, current_expires_at)
    values (${ownerId}, ${carCat}, 'EXPIRED', now() - interval '40 days', now() - interval '10 days')
    returning id, public_id::text as public_id
  `;
  await sql`
    insert into listing_periods (listing_id, period_number, source, starts_at, ends_at, status)
    values (${listing.id}, 1, 'INITIAL', now() - interval '40 days', now() - interval '10 days', 'EXPIRED')
  `;
  return { id: listing.id, publicId: listing.public_id };
}

async function insertListing(status: string): Promise<{ id: string }> {
  const sql = getSql();
  const published = ["ACTIVE", "SOLD", "EXPIRED", "SUSPENDED"].includes(status);
  const [row] = await sql<{ id: string }[]>`
    insert into listings (owner_id, category_id, status, published_at, current_expires_at)
    values (${seller.userId}, ${carCat}, ${status}::listing_status,
      ${published ? sql`now() - interval '1 day'` : null},
      ${published ? sql`now() + interval '20 days'` : null})
    returning id
  `;
  return { id: row.id };
}

async function renewalEffects(listingId: string) {
  const sql = getSql();
  const [row] = await sql<Record<string, string>[]>`
    select
      (select status::text from listings where id = ${listingId}) as status,
      (select current_expires_at::text from listings where id = ${listingId}) as expires,
      (select count(*)::text from listing_periods
        where listing_id = ${listingId} and source = 'RENEWAL') as renewal_periods,
      (select count(*)::text from listing_periods where listing_id = ${listingId}) as periods,
      (select count(*)::text from listing_status_history
        where listing_id = ${listingId} and from_status = 'EXPIRED' and to_status = 'ACTIVE'
          and reason_code = 'RENEWAL') as history,
      (select count(*)::text from outbox_events
        where aggregate_id = ${listingId} and event_type = 'LISTING_RENEWED') as outbox,
      (select count(*)::text from listing_publications where listing_id = ${listingId}) as publications
  `;
  return {
    status: row.status,
    expires: row.expires,
    renewalPeriods: Number(row.renewal_periods),
    periods: Number(row.periods),
    history: Number(row.history),
    outbox: Number(row.outbox),
    publications: Number(row.publications),
  };
}

async function paymentFor(listingId: string) {
  const sql = getSql();
  return sql<{ id: string; status: string; amount_minor: string; renewal_duration_days: number | null }[]>`
    select id, status::text as status, amount_minor::text as amount_minor, renewal_duration_days
    from payments where listing_id = ${listingId} and type = 'RENEWAL'
    order by created_at desc
  `;
}

async function payAndVerify(listingId: string): Promise<void> {
  const [payment] = await paymentFor(listingId);
  const sql = getSql();
  const [attempt] = await sql<{ provider_order_id: string }[]>`
    select provider_order_id from payment_provider_attempts
    where payment_id = ${payment.id} and not is_terminal
  `;
  fake.orders.get(attempt.provider_order_id)!.status = "FullyPaid";
  const outcome = await verifyProviderPayment(payment.id);
  expect(outcome.state).toBe("SUCCESS");
}

beforeAll(async () => {
  if (!process.env.DATABASE_URL) throw new Error("run via pnpm test:integration:db");
  const sql = getSql();
  seller = await createTestUserSession("+994525000001");
  otherSeller = await createTestUserSession("+994525000002");
  blockedSeller = await createTestUserSession("+994525000003", { blocked: true });
  carCat = (await sql<{ id: string }[]>`select id from categories where code = 'CAR'`)[0].id;
  originalSettings = await sql<{ key: string; value: string }[]>`
    select key, value::text as value from system_settings
    where key in ('listing.renewal_fee_minor', 'listing.renewal_duration_days')
  `;
});

afterEach(() => setPaymentProviderForTesting(null));

afterAll(async () => {
  const sql = getSql();
  for (const setting of originalSettings) {
    await sql`update system_settings set value = ${setting.value}::jsonb where key = ${setting.key}`;
  }
  await closeSql();
});

describe("renewal eligibility", () => {
  it("requires the authenticated unblocked owner of an EXPIRED listing", async () => {
    const listing = await insertExpiredListing();
    expect((await renewalCheckout(listing.id)).status).toBe(401);
    const foreign = await renewalCheckout(listing.id, otherSeller.cookie);
    expect(foreign.status).toBe(404); // indistinguishable from missing
    const blocked = await renewalCheckout(listing.id, blockedSeller.cookie);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error?.code).toBe("USER_BLOCKED");
    expect((await renewalCheckout(randomUUID(), seller.cookie)).status).toBe(404);
  });

  it.each([
    "DRAFT",
    "PAYMENT_REQUIRED",
    "PAYMENT_COMPLETED",
    "PENDING_MODERATION",
    "CORRECTION_REQUIRED",
    "REJECTED",
    "ACTIVE",
    "SOLD",
    "SUSPENDED",
  ])("rejects renewal for %s listings", async (status) => {
    installFake();
    const listing = await insertListing(status);
    const r = await renewalCheckout(listing.id, seller.cookie);
    expect(r.status).toBe(409);
    expect(r.body.error?.code).toBe("PAYMENT_NOT_REQUIRED");
    expect(fake.state.createCalls).toBe(0);
  });

  it("DELETED listings are indistinguishable from missing", async () => {
    const sql = getSql();
    const listing = await insertListing("ACTIVE");
    await sql`update listings set status = 'DELETED' where id = ${listing.id}`;
    expect((await renewalCheckout(listing.id, seller.cookie)).status).toBe(404);
  });

  it("state endpoint reports the server-priced offer for the owner", async () => {
    const listing = await insertExpiredListing();
    const r = await renewalGet(listing.id, seller.cookie);
    expect(r.status).toBe(200);
    const renewal = r.body.data?.renewal as {
      eligible: boolean;
      offer: { amountMinor: number; currency: string; durationDays: number };
      openIntent: unknown;
    };
    expect(renewal.eligible).toBe(true);
    expect(renewal.offer).toEqual({ amountMinor: 200, currency: "AZN", durationDays: 30 });
    expect(renewal.openIntent).toBeNull();
    expect((await renewalGet(listing.id, otherSeller.cookie)).status).toBe(404);
  });
});

describe("renewal checkout — snapshot & concurrency", () => {
  it("creates the intent at the settings-resolved fee/duration and one provider order", async () => {
    const provider = installFake();
    const listing = await insertExpiredListing();
    const r = await renewalCheckout(listing.id, seller.cookie);
    expect(r.status).toBe(200);
    expect(typeof r.body.data?.checkout_url).toBe("string");
    const payments = await paymentFor(listing.id);
    expect(payments).toHaveLength(1);
    expect(Number(payments[0].amount_minor)).toBe(200); // 2 AZN from settings
    expect(payments[0].renewal_duration_days).toBe(30);
    const order = [...provider.orders.values()][0];
    expect(order.amountMajor).toBe("2.00"); // exact integer conversion
    expect(order.currency).toBe("AZN");

    // double click: same intent, same order, same URL
    const again = await renewalCheckout(listing.id, seller.cookie);
    expect(again.body.data?.checkout_url).toBe(r.body.data?.checkout_url);
    expect((await paymentFor(listing.id)).length).toBe(1);
    expect(provider.state.createCalls).toBe(1);
  });

  it("10 simultaneous renewal requests converge to one intent and ONE provider createOrder", async () => {
    const provider = installFake();
    const listing = await insertExpiredListing();
    const responses = await Promise.all(
      Array.from({ length: 10 }, () => renewalCheckout(listing.id, seller.cookie)),
    );
    for (const r of responses) expect(r.status).toBe(200);
    const urls = new Set(responses.map((r) => r.body.data?.checkout_url as string));
    expect(urls.size).toBe(1);
    expect((await paymentFor(listing.id)).length).toBe(1);
    expect(provider.state.createCalls).toBe(1);
  });

  it("price is never accepted from the browser", async () => {
    const listing = await insertExpiredListing();
    const r = await api(renewalCheckoutRoute, "POST", checkoutUrl(listing.id), {
      cookie: seller.cookie,
      params: { listingId: listing.id },
      body: { amount_minor: 1 },
    });
    expect(r.status).toBe(400); // strict empty schema
  });
});

describe("renewal fulfillment", () => {
  it("verified success creates period #2, reactivates the SAME listing, and consumes no publication quota", async () => {
    installFake();
    const listing = await insertExpiredListing();
    const before = await renewalEffects(listing.id);
    expect((await renewalCheckout(listing.id, seller.cookie)).status).toBe(200);
    await payAndVerify(listing.id);
    const after = await renewalEffects(listing.id);
    expect(after.status).toBe("ACTIVE");
    expect(after.periods).toBe(2);
    expect(after.renewalPeriods).toBe(1);
    expect(after.history).toBe(1);
    expect(after.outbox).toBe(1);
    expect(after.publications).toBe(before.publications); // renewal ≠ publication
    // ~30 days ahead (snapshot duration)
    const sql = getSql();
    const [win] = await sql<{ ok: boolean }[]>`
      select current_expires_at between now() + interval '29 days' and now() + interval '31 days' as ok
      from listings where id = ${listing.id}
    `;
    expect(win.ok).toBe(true);
    // the renewal period carries the payment id
    const [payment] = await paymentFor(listing.id);
    const [period] = await sql<{ payment_id: string; period_number: number }[]>`
      select payment_id, period_number from listing_periods
      where listing_id = ${listing.id} and source = 'RENEWAL'
    `;
    expect(period.payment_id).toBe(payment.id);
    expect(period.period_number).toBe(2);
    // publicly live again with the SAME public id
    const detail = await publicDetail(Number(listing.publicId));
    expect(detail.listing.status).toBe("ACTIVE");
    // once ACTIVE, another renewal is refused
    expect((await renewalCheckout(listing.id, seller.cookie)).status).toBe(409);
    // owner callback view reports the new expiry
    const [attempt] = await sql<{ provider_order_id: string }[]>`
      select provider_order_id from payment_provider_attempts
      where payment_id = ${payment.id}
    `;
    const auth = { user: { id: seller.userId } } as unknown as Parameters<typeof handleKapitalCallback>[0];
    const view = await handleKapitalCallback(auth, attempt.provider_order_id);
    expect(view.view).toBe("OWNER");
    if (view.view === "OWNER") {
      expect(view.purpose).toBe("RENEWAL");
      expect(view.renewalExpiresAt).not.toBeNull();
    }
  });

  it("callback ×20 and 10 concurrent verifications never grant more than one period", async () => {
    installFake();
    const listing = await insertExpiredListing();
    expect((await renewalCheckout(listing.id, seller.cookie)).status).toBe(200);
    await payAndVerify(listing.id);
    const [payment] = await paymentFor(listing.id);
    for (let i = 0; i < 20; i += 1) {
      const outcome = await verifyProviderPayment(payment.id);
      expect(outcome.state).toBe("SUCCESS");
    }
    await Promise.all(
      Array.from({ length: 10 }, () => verifyProviderPayment(payment.id)),
    );
    const after = await renewalEffects(listing.id);
    expect(after.periods).toBe(2); // never 21 × 30 days
    expect(after.renewalPeriods).toBe(1);
    expect(after.history).toBe(1);
    expect(after.outbox).toBe(1);
  });

  it("10 overlapping reconciliation runs fulfill a stale paid renewal exactly once", async () => {
    installFake();
    const sql = getSql();
    const listing = await insertExpiredListing();
    expect((await renewalCheckout(listing.id, seller.cookie)).status).toBe(200);
    const [payment] = await paymentFor(listing.id);
    // seller paid on the HPP but never returned; the payment went stale
    const [attempt] = await sql<{ provider_order_id: string }[]>`
      select provider_order_id from payment_provider_attempts
      where payment_id = ${payment.id} and not is_terminal
    `;
    fake.orders.get(attempt.provider_order_id)!.status = "FullyPaid";
    await sql`
      update payments set status = 'PENDING', created_at = now() - interval '1 hour'
      where id = ${payment.id}
    `;
    await withEnv({ PAYMENT_RECONCILE_OLDER_THAN_SECONDS: "60" }, async () => {
      const summaries = await Promise.all(
        Array.from({ length: 10 }, () => runPaymentReconciliation()),
      );
      expect(summaries.reduce((n, s) => n + s.succeeded, 0)).toBeGreaterThanOrEqual(1);
    });
    const after = await renewalEffects(listing.id);
    expect(after.status).toBe("ACTIVE");
    expect(after.renewalPeriods).toBe(1);
    expect(after.history).toBe(1);
  });
});

describe("renewal setting snapshot", () => {
  it("an open intent keeps 2 AZN / 30 days after settings change; a NEW purchase gets 3 AZN / 45 days", async () => {
    installFake();
    const sql = getSql();
    const first = await insertExpiredListing();
    expect((await renewalCheckout(first.id, seller.cookie)).status).toBe(200);
    const [intent] = await paymentFor(first.id);
    expect(Number(intent.amount_minor)).toBe(200);
    expect(intent.renewal_duration_days).toBe(30);

    await sql`update system_settings set value = '300'::jsonb where key = 'listing.renewal_fee_minor'`;
    await sql`update system_settings set value = '45'::jsonb where key = 'listing.renewal_duration_days'`;
    try {
      // the existing intent is untouched and fulfills at ITS snapshot
      const [unchanged] = await paymentFor(first.id);
      expect(Number(unchanged.amount_minor)).toBe(200);
      expect(unchanged.renewal_duration_days).toBe(30);
      await payAndVerify(first.id);
      const [win30] = await sql<{ ok: boolean }[]>`
        select current_expires_at between now() + interval '29 days' and now() + interval '31 days' as ok
        from listings where id = ${first.id}
      `;
      expect(win30.ok).toBe(true); // 30 days, not 45

      // a NEW renewal snapshots the new settings
      const second = await insertExpiredListing();
      const offer = await renewalGet(second.id, seller.cookie);
      expect((offer.body.data?.renewal as { offer: { amountMinor: number; durationDays: number } }).offer)
        .toEqual({ amountMinor: 300, currency: "AZN", durationDays: 45 });
      expect((await renewalCheckout(second.id, seller.cookie)).status).toBe(200);
      const [fresh] = await paymentFor(second.id);
      expect(Number(fresh.amount_minor)).toBe(300);
      expect(fresh.renewal_duration_days).toBe(45);
      await payAndVerify(second.id);
      const [win45] = await sql<{ ok: boolean }[]>`
        select current_expires_at between now() + interval '44 days' and now() + interval '46 days' as ok
        from listings where id = ${second.id}
      `;
      expect(win45.ok).toBe(true);
    } finally {
      await sql`update system_settings set value = '200'::jsonb where key = 'listing.renewal_fee_minor'`;
      await sql`update system_settings set value = '30'::jsonb where key = 'listing.renewal_duration_days'`;
    }
  });
});
