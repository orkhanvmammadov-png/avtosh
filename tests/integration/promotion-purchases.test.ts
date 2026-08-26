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
  reconcileProviderPayments,
  verifyProviderPayment,
} from "@/services/payment-checkout";
import { premiumFeed, publicDetail } from "@/services/marketplace";
import { createTestUserSession } from "./helpers/session";
import { api } from "./helpers/listing";
import { GET as packagesRoute } from "@/app/api/v1/me/promotion-packages/route";
import { POST as promoCheckoutRoute } from "@/app/api/v1/me/listings/[listingId]/promotions/checkout/route";

const PACKAGES = "http://localhost/api/v1/me/promotion-packages";
const checkoutUrl = (id: string) =>
  `http://localhost/api/v1/me/listings/${id}/promotions/checkout`;

interface FakeOrder {
  id: string;
  amountMajor: string;
  currency: string;
  status: string;
}

function createFakeKapital() {
  const orders = new Map<string, FakeOrder>();
  let counter = 0;
  const state = { failCreate: null as PaymentProviderError | null, createCalls: 0, getCalls: 0 };
  const client: PaymentProviderClient = {
    async createOrder(input: CreateOrderInput) {
      state.createCalls += 1;
      if (state.failCreate !== null) throw state.failCreate;
      counter += 1;
      const id = `pk-${counter}-${randomUUID().slice(0, 8)}`;
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
let packagesByKey = new Map<string, { id: string; priceMinor: number; durationDays: number }>();

function installFake() {
  fake = createFakeKapital();
  setPaymentProviderForTesting(fake.client);
  return fake;
}

async function insertActiveListing(
  ownerId: string,
  options: { status?: string; expiresOffsetDays?: number } = {},
): Promise<{ id: string; publicId: string }> {
  const sql = getSql();
  const status = options.status ?? "ACTIVE";
  const published = ["ACTIVE", "SOLD", "EXPIRED", "SUSPENDED"].includes(status);
  const [row] = await sql<{ id: string; public_id: string }[]>`
    insert into listings (owner_id, category_id, status, published_at, current_expires_at)
    values (${ownerId}, ${carCat}, ${status}::listing_status,
      ${published ? sql`now() - interval '1 day'` : null},
      ${published ? sql`now() + (${options.expiresOffsetDays ?? 20} || ' days')::interval` : null})
    returning id, public_id::text as public_id
  `;
  return { id: row.id, publicId: row.public_id };
}

async function promoCheckout(
  listingId: string,
  body: unknown,
  cookie?: string,
) {
  return api(promoCheckoutRoute, "POST", checkoutUrl(listingId), {
    cookie,
    params: { listingId },
    body,
  });
}

function pkg(type: string, days: number) {
  const found = packagesByKey.get(`${type}:${days}`);
  if (found === undefined) throw new Error(`missing package ${type}:${days}`);
  return found;
}

async function promotionRows(listingId: string, type: string) {
  const sql = getSql();
  return sql<{ starts_at: Date; ends_at: Date; status: string; payment_id: string }[]>`
    select starts_at, ends_at, status::text as status, payment_id
    from listing_promotions
    where listing_id = ${listingId} and type = ${type}::promotion_type
    order by starts_at asc
  `;
}

async function paymentFor(listingId: string, type: string, status?: string) {
  const sql = getSql();
  const rows = await sql<{ id: string; status: string; amount_minor: string }[]>`
    select id, status::text as status, amount_minor::text as amount_minor
    from payments
    where listing_id = ${listingId} and type = ${type}::payment_type
      ${status === undefined ? sql`` : sql`and status = ${status}::payment_status`}
    order by created_at desc
  `;
  return rows;
}

async function fulfillLatest(provider: ReturnType<typeof createFakeKapital>, listingId: string, type: string) {
  const [payment] = await paymentFor(listingId, type, "PENDING");
  const sql = getSql();
  const [attempt] = await sql<{ provider_order_id: string }[]>`
    select provider_order_id from payment_provider_attempts
    where payment_id = ${payment.id} and not is_terminal
  `;
  provider.orders.get(attempt.provider_order_id)!.status = "FullyPaid";
  const outcome = await verifyProviderPayment(payment.id);
  return { payment, outcome };
}

beforeAll(async () => {
  if (!process.env.DATABASE_URL) throw new Error("run via pnpm test:integration:db");
  const sql = getSql();
  seller = await createTestUserSession("+994521000001");
  otherSeller = await createTestUserSession("+994521000002");
  blockedSeller = await createTestUserSession("+994521000003", { blocked: true });
  carCat = (await sql<{ id: string }[]>`select id from categories where code = 'CAR'`)[0].id;
  const rows = await sql<{ id: string; type: string; duration_days: number; price_minor: string }[]>`
    select id, type::text as type, duration_days, price_minor::text as price_minor
    from promotion_packages where is_active
  `;
  packagesByKey = new Map(
    rows.map((row) => [
      `${row.type}:${row.duration_days}`,
      { id: row.id, priceMinor: Number(row.price_minor), durationDays: row.duration_days },
    ]),
  );
});

afterEach(() => setPaymentProviderForTesting(null));
afterAll(async () => {
  await closeSql();
});

describe("promotion packages API", () => {
  it("requires auth and returns the seeded server-priced packages", async () => {
    const anonymous = await api(packagesRoute, "GET", PACKAGES);
    expect(anonymous.status).toBe(401);
    const r = await api(packagesRoute, "GET", PACKAGES, { cookie: seller.cookie });
    expect(r.status).toBe(200);
    const packages = r.body.data?.packages as { type: string; durationDays: number; priceMinor: number; currency: string }[];
    expect(packages).toHaveLength(6);
    for (const type of ["PREMIUM", "BOOST"]) {
      for (const days of [1, 3, 7]) {
        const found = packages.find((p) => p.type === type && p.durationDays === days);
        expect(found).toBeDefined();
        expect(found!.priceMinor).toBeGreaterThan(0);
        expect(found!.currency).toBe("AZN");
      }
    }
    expect(r.response.headers.get("cache-control")).toContain("no-store");
  });
});

describe("promotion checkout — eligibility", () => {
  it("enforces auth, ownership, blocked status, and package validity", async () => {
    installFake();
    const listing = await insertActiveListing(seller.userId);
    const premium3 = pkg("PREMIUM", 3);
    const body = { type: "PREMIUM", package_id: premium3.id };
    expect((await promoCheckout(listing.id, body)).status).toBe(401);
    const foreign = await promoCheckout(listing.id, body, otherSeller.cookie);
    expect(foreign.status).toBe(404);
    const blocked = await promoCheckout(listing.id, body, blockedSeller.cookie);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error?.code).toBe("USER_BLOCKED");
    // wrong-type package pairing → indistinguishable 404
    const boost3 = pkg("BOOST", 3);
    const wrongType = await promoCheckout(listing.id, { type: "PREMIUM", package_id: boost3.id }, seller.cookie);
    expect(wrongType.status).toBe(404);
    expect(wrongType.body.error?.code).toBe("PROMOTION_PACKAGE_NOT_FOUND");
    const unknownPkg = await promoCheckout(listing.id, { type: "PREMIUM", package_id: randomUUID() }, seller.cookie);
    expect(unknownPkg.status).toBe(404);
    // price from browser is rejected by the strict schema
    const priced = await promoCheckout(listing.id, { ...body, amount_minor: 1 }, seller.cookie);
    expect(priced.status).toBe(400);
    expect(fake.state.createCalls).toBe(0);
  });

  it.each(["DRAFT", "PENDING_MODERATION", "CORRECTION_REQUIRED", "REJECTED", "SOLD", "SUSPENDED"])(
    "rejects promotion purchase for %s listings",
    async (status) => {
      installFake();
      const listing = await insertActiveListing(seller.userId, { status });
      const r = await promoCheckout(
        listing.id,
        { type: "BOOST", package_id: pkg("BOOST", 1).id },
        seller.cookie,
      );
      expect(r.status).toBe(409);
      expect(r.body.error?.code).toBe("PROMOTION_NOT_AVAILABLE");
    },
  );

  it("rejects an ACTIVE listing whose publication already expired", async () => {
    installFake();
    const listing = await insertActiveListing(seller.userId, { expiresOffsetDays: -1 });
    const r = await promoCheckout(
      listing.id,
      { type: "PREMIUM", package_id: pkg("PREMIUM", 1).id },
      seller.cookie,
    );
    expect(r.status).toBe(409);
  });
});

describe("promotion checkout — pricing authority and idempotency", () => {
  it("creates the provider order at the server package price; later price changes never touch the intent", async () => {
    const provider = installFake();
    const listing = await insertActiveListing(seller.userId);
    const premium3 = pkg("PREMIUM", 3);
    const r = await promoCheckout(listing.id, { type: "PREMIUM", package_id: premium3.id }, seller.cookie);
    expect(r.status).toBe(200);
    const order = [...provider.orders.values()][0];
    expect(Number(order.amountMajor.replace(".", ""))).toBe(premium3.priceMinor);
    expect(order.currency).toBe("AZN");
    // the configured price rises AFTER the intent exists
    const sql = getSql();
    try {
      await sql`update promotion_packages set price_minor = price_minor + 100 where id = ${premium3.id}`;
      const { outcome } = await fulfillLatest(provider, listing.id, "PREMIUM");
      expect(outcome.state).toBe("SUCCESS"); // verified against the SNAPSHOT amount
      const [payment] = await paymentFor(listing.id, "PREMIUM", "SUCCESS");
      expect(Number(payment.amount_minor)).toBe(premium3.priceMinor);
      const [period] = await promotionRows(listing.id, "PREMIUM");
      expect(Number(period.ends_at.getTime() - period.starts_at.getTime())).toBe(3 * 86_400_000);
    } finally {
      await sql`update promotion_packages set price_minor = price_minor - 100 where id = ${premium3.id}`;
    }
  });

  it("double-click / repeated POSTs reuse one intent and one provider order", async () => {
    const provider = installFake();
    const listing = await insertActiveListing(seller.userId);
    const body = { type: "BOOST", package_id: pkg("BOOST", 3).id };
    const first = await promoCheckout(listing.id, body, seller.cookie);
    const second = await promoCheckout(listing.id, body, seller.cookie);
    expect(second.body.data?.checkout_url).toBe(first.body.data?.checkout_url);
    expect(provider.state.createCalls).toBe(1);
    expect(await paymentFor(listing.id, "BOOST")).toHaveLength(1);
  });

  it("10 simultaneous purchase POSTs settle into one intent and ONE provider createOrder", async () => {
    const provider = installFake();
    const listing = await insertActiveListing(seller.userId);
    const body = { type: "PREMIUM", package_id: pkg("PREMIUM", 7).id };
    const responses = await Promise.all(
      Array.from({ length: 10 }, () => promoCheckout(listing.id, body, seller.cookie)),
    );
    const urls = new Set(responses.map((r) => r.body.data?.checkout_url as string));
    for (const r of responses) expect(r.status).toBe(200);
    expect(urls.size).toBe(1);
    expect(provider.state.createCalls).toBe(1);
    expect(await paymentFor(listing.id, "PREMIUM")).toHaveLength(1);
  });

  it("switching packages replaces an UNSTARTED intent (cancelled, never paid)", async () => {
    const provider = installFake();
    provider.state.failCreate = new PaymentProviderError("NETWORK", "down");
    const listing = await insertActiveListing(seller.userId);
    const p1 = pkg("PREMIUM", 1);
    const p7 = pkg("PREMIUM", 7);
    const first = await promoCheckout(listing.id, { type: "PREMIUM", package_id: p1.id }, seller.cookie);
    expect(first.status).toBe(503); // provider down → intent stays CREATED
    provider.state.failCreate = null;
    const second = await promoCheckout(listing.id, { type: "PREMIUM", package_id: p7.id }, seller.cookie);
    expect(second.status).toBe(200);
    const payments = await paymentFor(listing.id, "PREMIUM");
    expect(payments.map((p) => p.status).sort()).toEqual(["CANCELLED", "PENDING"]);
    const pending = payments.find((p) => p.status === "PENDING")!;
    expect(Number(pending.amount_minor)).toBe(p7.priceMinor);
    // once a checkout is in flight, the package cannot be switched —
    // the open HPP could still be paid
    const blocked = await promoCheckout(listing.id, { type: "PREMIUM", package_id: p1.id }, seller.cookie);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error?.code).toBe("PROMOTION_PAYMENT_PENDING");
  });
});

describe("promotion fulfillment", () => {
  it("verified PREMIUM success activates the period without touching listing lifecycle", async () => {
    const provider = installFake();
    const listing = await insertActiveListing(seller.userId);
    const sql = getSql();
    const before = (await sql<{ e: string }[]>`
      select current_expires_at::text as e from listings where id = ${listing.id}
    `)[0].e;
    await promoCheckout(listing.id, { type: "PREMIUM", package_id: pkg("PREMIUM", 3).id }, seller.cookie);
    const { outcome, payment } = await fulfillLatest(provider, listing.id, "PREMIUM");
    expect(outcome.state).toBe("SUCCESS");
    const periods = await promotionRows(listing.id, "PREMIUM");
    expect(periods).toHaveLength(1);
    expect(periods[0].status).toBe("ACTIVE");
    expect(periods[0].starts_at.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    expect(periods[0].ends_at.getTime() - periods[0].starts_at.getTime()).toBe(3 * 86_400_000);
    // listing publication window is untouched (§20)
    const after = (await sql<{ e: string; s: string }[]>`
      select current_expires_at::text as e, status::text as s from listings where id = ${listing.id}
    `)[0];
    expect(after.e).toBe(before);
    expect(after.s).toBe("ACTIVE");
    const [audit] = await sql<{ n: string }[]>`
      select count(*)::text as n from audit_logs
      where entity_id = ${listing.id} and action = 'PROMOTION_ACTIVATED'
    `;
    expect(audit.n).toBe("1");
    const [outbox] = await sql<{ n: string }[]>`
      select count(*)::text as n from outbox_events
      where aggregate_id = ${listing.id} and event_type = 'PROMOTION_ACTIVATED'
    `;
    expect(outbox.n).toBe("1");
    // public regression: appears in the Premium feed and carries the badge
    const feed = await premiumFeed({ limit: 48 });
    expect(feed.items.map((i) => i.publicId)).toContain(listing.publicId);
    const detail = await publicDetail(Number(listing.publicId));
    expect(detail.listing.badges.premium).toBe(true);
    void payment;
  });

  it.each(["PREMIUM", "BOOST"] as const)(
    "%s sequential purchases extend from the current end, never from now",
    async (type) => {
      const provider = installFake();
      const listing = await insertActiveListing(seller.userId);
      const p3 = pkg(type, 3);
      await promoCheckout(listing.id, { type, package_id: p3.id }, seller.cookie);
      await fulfillLatest(provider, listing.id, type);
      const [first] = await promotionRows(listing.id, type);
      // second purchase while the first is still running
      await promoCheckout(listing.id, { type, package_id: p3.id }, seller.cookie);
      await fulfillLatest(provider, listing.id, type);
      const periods = await promotionRows(listing.id, type);
      expect(periods).toHaveLength(2);
      expect(periods[1].starts_at.getTime()).toBe(first.ends_at.getTime());
      expect(periods[1].ends_at.getTime()).toBe(first.ends_at.getTime() + 3 * 86_400_000);
      expect(periods[1].status).toBe("SCHEDULED"); // queued after remaining time
    },
  );

  it("an expired prior period never extends — the new period starts at fulfillment", async () => {
    const provider = installFake();
    const listing = await insertActiveListing(seller.userId);
    const sql = getSql();
    // stale expired period (status flip lagging — window is truth)
    await sql`
      insert into listing_promotions
        (listing_id, type, payment_id, starts_at, ends_at, status,
         purchased_duration_days, purchased_price_minor)
      values (${listing.id}, 'PREMIUM',
        (select id from payments limit 1),
        now() - interval '10 days', now() - interval '3 days', 'ACTIVE', 7, 0)
    `;
    await promoCheckout(listing.id, { type: "PREMIUM", package_id: pkg("PREMIUM", 1).id }, seller.cookie);
    await fulfillLatest(provider, listing.id, "PREMIUM");
    const periods = await promotionRows(listing.id, "PREMIUM");
    const fresh = periods[periods.length - 1];
    expect(fresh.starts_at.getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(fresh.status).toBe("ACTIVE");
  });

  it("PREMIUM and BOOST coexist on one listing", async () => {
    const provider = installFake();
    const listing = await insertActiveListing(seller.userId);
    await promoCheckout(listing.id, { type: "PREMIUM", package_id: pkg("PREMIUM", 3).id }, seller.cookie);
    await fulfillLatest(provider, listing.id, "PREMIUM");
    await promoCheckout(listing.id, { type: "BOOST", package_id: pkg("BOOST", 3).id }, seller.cookie);
    await fulfillLatest(provider, listing.id, "BOOST");
    const detail = await publicDetail(Number(listing.publicId));
    expect(detail.listing.badges.premium).toBe(true);
    expect(detail.listing.badges.boosted).toBe(true);
  });

  it("promotion expiry removes public promotion behavior (window is truth)", async () => {
    const provider = installFake();
    const listing = await insertActiveListing(seller.userId);
    await promoCheckout(listing.id, { type: "PREMIUM", package_id: pkg("PREMIUM", 1).id }, seller.cookie);
    await fulfillLatest(provider, listing.id, "PREMIUM");
    const sql = getSql();
    await sql`
      update listing_promotions set starts_at = now() - interval '2 days', ends_at = now() - interval '1 day'
      where listing_id = ${listing.id}
    `;
    const feed = await premiumFeed({ limit: 48 });
    expect(feed.items.map((i) => i.publicId)).not.toContain(listing.publicId);
    const detail = await publicDetail(Number(listing.publicId));
    expect(detail.listing.badges.premium).toBe(false);
  });
});

describe("promotion exactly-once and concurrency", () => {
  it("repeated + 10-way concurrent verification adds the duration exactly once", async () => {
    const provider = installFake();
    const listing = await insertActiveListing(seller.userId);
    await promoCheckout(listing.id, { type: "BOOST", package_id: pkg("BOOST", 3).id }, seller.cookie);
    const { payment } = await fulfillLatest(provider, listing.id, "BOOST");
    const outcomes = await Promise.all(
      Array.from({ length: 10 }, () => verifyProviderPayment(payment.id)),
    );
    for (const outcome of outcomes) expect(outcome.state).toBe("SUCCESS");
    for (let i = 0; i < 10; i += 1) {
      await verifyProviderPayment(payment.id); // callback refresh storm
    }
    const periods = await promotionRows(listing.id, "BOOST");
    expect(periods).toHaveLength(1); // 3 days once — not 60
    const sql = getSql();
    const [outbox] = await sql<{ n: string }[]>`
      select count(*)::text as n from outbox_events
      where aggregate_id = ${listing.id} and event_type = 'PROMOTION_ACTIVATED'
    `;
    expect(outbox.n).toBe("1");
  });

  it.each(["PREMIUM", "BOOST"] as const)(
    "two concurrent %s period fulfillments (+3d and +7d) queue to the full total — no lost update",
    async (type) => {
      // The API model makes two same-type UNPAID intents structurally
      // impossible (open-intent index), so this exercises the deeper
      // layers directly: two already-paid promotion payments fulfilled
      // concurrently through the listing lock + SQL-computed base +
      // GiST exclusion — exactly what fulfillment executes.
      installFake();
      const listing = await insertActiveListing(seller.userId);
      const sql = getSql();
      const mkPaid = async (days: number) => (await sql<{ id: string }[]>`
        insert into payments (user_id, listing_id, type, amount_minor, currency,
          idempotency_key, status, provider, package_duration_days, package_price_minor)
        values (${seller.userId}, ${listing.id}, ${type}::payment_type, 100, 'AZN',
          ${`promo-conc:${type}:${listing.id}:${days}:${randomUUID()}`}, 'SUCCESS', 'KAPITAL', ${days}, 100)
        returning id
      `)[0].id;
      const [payA, payB] = await Promise.all([mkPaid(3), mkPaid(7)]);
      const { withTransaction } = await import("@/lib/server/db/client");
      const { lockListingForPromotion, insertPromotionPeriod } = await import("@/repositories/promotions");
      await Promise.all(
        [
          { paymentId: payA, days: 3 },
          { paymentId: payB, days: 7 },
        ].map(({ paymentId, days }) =>
          withTransaction(async (tx) => {
            await lockListingForPromotion(tx, listing.id);
            await insertPromotionPeriod(tx, {
              listingId: listing.id,
              type,
              packageId: null,
              paymentId,
              durationDays: days,
              priceMinor: 100,
            });
          }),
        ),
      );
      const periods = await promotionRows(listing.id, type);
      expect(periods).toHaveLength(2);
      // abutting, in either fulfillment order: total exactly 10 days
      expect(periods[1].starts_at.getTime()).toBe(periods[0].ends_at.getTime());
      const total = periods[1].ends_at.getTime() - periods[0].starts_at.getTime();
      expect(total).toBe(10 * 86_400_000);
    },
  );

  it("a Preparing promotion order never activates anything (callback STATUS impotence)", async () => {
    const provider = installFake();
    const listing = await insertActiveListing(seller.userId);
    await promoCheckout(listing.id, { type: "PREMIUM", package_id: pkg("PREMIUM", 3).id }, seller.cookie);
    const [payment] = await paymentFor(listing.id, "PREMIUM", "PENDING");
    const outcome = await verifyProviderPayment(payment.id); // provider truth: Preparing
    expect(outcome.state).toBe("PENDING");
    expect(await promotionRows(listing.id, "PREMIUM")).toHaveLength(0);
    void provider;
  });

  it("FullyPaid with a wrong amount never activates a promotion", async () => {
    const provider = installFake();
    const listing = await insertActiveListing(seller.userId);
    await promoCheckout(listing.id, { type: "BOOST", package_id: pkg("BOOST", 3).id }, seller.cookie);
    const [payment] = await paymentFor(listing.id, "BOOST", "PENDING");
    const sql = getSql();
    const [attempt] = await sql<{ provider_order_id: string }[]>`
      select provider_order_id from payment_provider_attempts
      where payment_id = ${payment.id} and not is_terminal
    `;
    const order = provider.orders.get(attempt.provider_order_id)!;
    order.status = "FullyPaid";
    order.amountMajor = "99.00";
    const outcome = await verifyProviderPayment(payment.id);
    expect(outcome.state).toBe("MISMATCH");
    expect(await promotionRows(listing.id, "BOOST")).toHaveLength(0);
  });

  it("reconciliation fulfills a stale pending promotion payment through the same path", async () => {
    const provider = installFake();
    const listing = await insertActiveListing(seller.userId);
    await promoCheckout(listing.id, { type: "PREMIUM", package_id: pkg("PREMIUM", 1).id }, seller.cookie);
    const [payment] = await paymentFor(listing.id, "PREMIUM", "PENDING");
    const sql = getSql();
    const [attempt] = await sql<{ provider_order_id: string }[]>`
      select provider_order_id from payment_provider_attempts
      where payment_id = ${payment.id} and not is_terminal
    `;
    provider.orders.get(attempt.provider_order_id)!.status = "FullyPaid";
    await sql`update payments set created_at = now() - interval '1 hour' where id = ${payment.id}`;
    const summary = await reconcileProviderPayments({ olderThanSeconds: 60 });
    expect(summary.succeeded).toBeGreaterThanOrEqual(1);
    expect(await promotionRows(listing.id, "PREMIUM")).toHaveLength(1);
  });
});
