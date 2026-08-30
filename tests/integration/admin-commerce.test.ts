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
import { createTestUserSession } from "./helpers/session";
import { api } from "./helpers/listing";
import { GET as paymentsRoute } from "@/app/api/v1/admin/payments/route";
import { GET as attemptsRoute } from "@/app/api/v1/admin/payments/[paymentId]/attempts/route";
import { POST as verifyRoute } from "@/app/api/v1/admin/payments/[paymentId]/verify/route";
import { GET as packagesRoute, PATCH as packagesPatchRoute } from "@/app/api/v1/admin/promotion-packages/route";
import { GET as settingsRoute, PATCH as settingsPatchRoute } from "@/app/api/v1/admin/settings/route";
import { POST as promoCheckoutRoute } from "@/app/api/v1/me/listings/[listingId]/promotions/checkout/route";

/**
 * Phase 4.15 commercial administration: safe payment projections
 * (no provider secrets), the reused verification path, promotion
 * package pricing/activation with optimistic concurrency, snapshot
 * preservation, and typed system settings.
 */

const BASE = "http://localhost/api/v1/admin";

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
      const id = `ak-${counter}-${randomUUID().slice(0, 8)}`;
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
let admin: { userId: string; cookie: string };
let seller: { userId: string; cookie: string };
let carCat = "";
let originalPackages: { id: string; price_minor: string; is_active: boolean }[] = [];
let originalSettings: { key: string; value: string }[] = [];

function installFake() {
  fake = createFakeKapital();
  setPaymentProviderForTesting(fake.client);
  return fake;
}

async function insertActiveListing(ownerId: string): Promise<{ id: string }> {
  const sql = getSql();
  const [row] = await sql<{ id: string }[]>`
    insert into listings (owner_id, category_id, status, published_at, current_expires_at)
    values (${ownerId}, ${carCat}, 'ACTIVE', now() - interval '1 day', now() + interval '20 days')
    returning id
  `;
  return { id: row.id };
}

async function fetchPackages() {
  const r = await api(packagesRoute, "GET", `${BASE}/promotion-packages`, { cookie: admin.cookie });
  expect(r.status).toBe(200);
  return r.body.data?.packages as {
    id: string;
    type: string;
    durationDays: number;
    priceMinor: number;
    isActive: boolean;
    version: string;
  }[];
}

async function patchPackage(body: Record<string, unknown>) {
  return api(packagesPatchRoute, "PATCH", `${BASE}/promotion-packages`, {
    cookie: admin.cookie,
    body,
  });
}

async function fetchSettings() {
  const r = await api(settingsRoute, "GET", `${BASE}/settings`, { cookie: admin.cookie });
  expect(r.status).toBe(200);
  return r.body.data?.settings as { key: string; value: number; version: string }[];
}

async function patchSetting(body: Record<string, unknown>) {
  return api(settingsPatchRoute, "PATCH", `${BASE}/settings`, { cookie: admin.cookie, body });
}

beforeAll(async () => {
  if (!process.env.DATABASE_URL) throw new Error("run via pnpm test:integration:db");
  const sql = getSql();
  admin = await createTestUserSession("+994523100001", { roles: ["ADMIN"] });
  seller = await createTestUserSession("+994523100002");
  carCat = (await sql<{ id: string }[]>`select id from categories where code = 'CAR'`)[0].id;
  originalPackages = await sql<{ id: string; price_minor: string; is_active: boolean }[]>`
    select id, price_minor::text as price_minor, is_active from promotion_packages
  `;
  originalSettings = await sql<{ key: string; value: string }[]>`
    select key, value::text as value from system_settings
  `;
});

afterEach(() => setPaymentProviderForTesting(null));

afterAll(async () => {
  // restore commercial state so later suites see the accepted seeds
  const sql = getSql();
  // retire this suite's promoted fixtures so public read models
  // (marketplace premium/home suites run later) stay fixture-clean.
  // Status-only updates: promotion time ranges are never rewritten
  // (the GiST exclusion constraint guards overlapping windows).
  await sql`
    update listing_promotions set status = 'EXPIRED'
    where listing_id in (select id from listings where owner_id = ${seller.userId})
  `;
  await sql`
    update listings set status = 'EXPIRED' where owner_id = ${seller.userId} and status = 'ACTIVE'
  `;
  for (const pkg of originalPackages) {
    await sql`
      update promotion_packages
      set price_minor = ${pkg.price_minor}::bigint, is_active = ${pkg.is_active}
      where id = ${pkg.id}
    `;
  }
  for (const setting of originalSettings) {
    await sql`
      update system_settings set value = ${setting.value}::jsonb where key = ${setting.key}
    `;
  }
  await closeSql();
});

describe("admin payments — safe projection", () => {
  it("lists payments with masked owners and never serializes provider secrets", async () => {
    const sql = getSql();
    const listing = await insertActiveListing(seller.userId);
    const secret = `hpp-secret-${randomUUID()}`;
    const idem = `admin-proj:${randomUUID()}`;
    const [payment] = await sql<{ id: string }[]>`
      insert into payments (user_id, listing_id, type, amount_minor, currency, idempotency_key, status, provider)
      values (${seller.userId}, ${listing.id}, 'PREMIUM', 500, 'AZN', ${idem}, 'PENDING', 'KAPITAL')
      returning id
    `;
    await sql`
      insert into payment_provider_attempts
        (payment_id, provider, provider_order_id, hpp_url, hpp_secret, provider_status)
      values (${payment.id}, 'KAPITAL', ${`proj-${randomUUID().slice(0, 8)}`},
        'https://provider.test/flex', ${secret}, 'Preparing')
    `;
    const list = await api(paymentsRoute, "GET", `${BASE}/payments?status=PENDING&type=PREMIUM`, {
      cookie: admin.cookie,
    });
    expect(list.status).toBe(200);
    const listJson = JSON.stringify(list.body);
    const items = (list.body.data as { items: { id: string; status: string; type: string; ownerPhoneMasked: string }[] }).items;
    const row = items.find((item) => item.id === payment.id);
    expect(row).toBeDefined();
    expect(row!.status).toBe("PENDING");
    expect(row!.ownerPhoneMasked).not.toContain("+994523100002");
    expect(listJson).not.toContain(secret);
    expect(listJson).not.toContain(idem);
    expect(listJson).not.toContain("+994523100002");

    const attempts = await api(attemptsRoute, "GET", `${BASE}/payments/${payment.id}/attempts`, {
      cookie: admin.cookie,
      params: { paymentId: payment.id },
    });
    expect(attempts.status).toBe(200);
    const attemptsJson = JSON.stringify(attempts.body);
    const rows = attempts.body.data?.attempts as { provider: string; providerStatus: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].providerStatus).toBe("Preparing");
    expect(attemptsJson).not.toContain(secret); // hpp password never leaves the server
    expect(attemptsJson).not.toContain("hpp_secret");
    expect(attemptsJson).not.toContain("https://provider.test/flex");
  });

  it("verify reuses the ONE accepted provider verification path, fulfillment stays exactly-once", async () => {
    const provider = installFake();
    const sql = getSql();
    await sql`update promotion_packages set is_active = true`;
    const [premium3] = await sql<{ id: string }[]>`
      select id from promotion_packages where type = 'PREMIUM' and duration_days = 3
    `;
    const listing = await insertActiveListing(seller.userId);
    const checkout = await api(
      promoCheckoutRoute,
      "POST",
      `http://localhost/api/v1/me/listings/${listing.id}/promotions/checkout`,
      { cookie: seller.cookie, params: { listingId: listing.id }, body: { type: "PREMIUM", package_id: premium3.id } },
    );
    expect(checkout.status).toBe(200);
    const [payment] = await sql<{ id: string }[]>`
      select id from payments where listing_id = ${listing.id} and type = 'PREMIUM'
    `;
    [...provider.orders.values()][0].status = "FullyPaid";

    const verify = () =>
      api(verifyRoute, "POST", `${BASE}/payments/${payment.id}/verify`, {
        cookie: admin.cookie,
        params: { paymentId: payment.id },
        body: {},
      });
    const first = await verify();
    expect(first.status).toBe(200);
    expect(first.body.data?.outcome).toBe("SUCCESS");
    expect(provider.state.getCalls).toBeGreaterThan(0); // went through the real provider client

    // repeated admin verifies never double-fulfill
    for (let i = 0; i < 3; i += 1) {
      const again = await verify();
      expect(again.status).toBe(200);
      expect(again.body.data?.outcome).toBe("SUCCESS");
    }
    const [periods] = await sql<{ n: string }[]>`
      select count(*)::text as n from listing_promotions
      where listing_id = ${listing.id} and type = 'PREMIUM'
    `;
    expect(Number(periods.n)).toBe(1);
    // an unknown payment id yields a safe non-state-moving outcome
    const unknownId = randomUUID();
    const unknown = await api(verifyRoute, "POST", `${BASE}/payments/${unknownId}/verify`, {
      cookie: admin.cookie,
      params: { paymentId: unknownId },
      body: {},
    });
    expect(unknown.status).toBe(200);
    expect(unknown.body.data?.outcome).toBe("CHECK_FAILED");
  });
});

describe("admin promotion packages — pricing, activation, concurrency", () => {
  it("updates a price with the version token and audits it; a stale version is refused", async () => {
    const packages = await fetchPackages();
    const target = packages.find((p) => p.type === "BOOST" && p.durationDays === 1)!;
    const updated = await patchPackage({
      package_id: target.id,
      version: target.version,
      price_minor: target.priceMinor + 50,
    });
    expect(updated.status).toBe(200);
    const dto = updated.body.data?.package as { priceMinor: number; version: string };
    expect(dto.priceMinor).toBe(target.priceMinor + 50);
    expect(dto.version).not.toBe(target.version); // version advanced

    const stale = await patchPackage({
      package_id: target.id,
      version: target.version, // the OLD token
      price_minor: target.priceMinor + 999,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error?.code).toBe("LISTING_REVISION_CONFLICT");
    const after = (await fetchPackages()).find((p) => p.id === target.id)!;
    expect(after.priceMinor).toBe(target.priceMinor + 50); // the stale write changed nothing

    const sql = getSql();
    const [audit] = await sql<{ n: string }[]>`
      select count(*)::text as n from audit_logs
      where action = 'PROMOTION_PACKAGE_UPDATED' and entity_id = ${target.id}
    `;
    expect(Number(audit.n)).toBe(1);
  });

  it("two admins editing the same version: exactly one wins, every round", async () => {
    for (let round = 0; round < 5; round += 1) {
      const packages = await fetchPackages();
      const target = packages.find((p) => p.type === "BOOST" && p.durationDays === 7)!;
      const [a, b] = await Promise.all([
        patchPackage({ package_id: target.id, version: target.version, price_minor: 1000 + round }),
        patchPackage({ package_id: target.id, version: target.version, price_minor: 2000 + round }),
      ]);
      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([200, 409]); // never two silent winners
      const winner = a.status === 200 ? a : b;
      const finalPrice = (await fetchPackages()).find((p) => p.id === target.id)!.priceMinor;
      expect(finalPrice).toBe((winner.body.data?.package as { priceMinor: number }).priceMinor);
    }
  });

  it("activation requires an approved positive price", async () => {
    const sql = getSql();
    const packages = await fetchPackages();
    const target = packages.find((p) => p.type === "PREMIUM" && p.durationDays === 1)!;
    await sql`update promotion_packages set price_minor = 0, is_active = false where id = ${target.id}`;
    const fresh = (await fetchPackages()).find((p) => p.id === target.id)!;
    const refused = await patchPackage({ package_id: target.id, version: fresh.version, is_active: true });
    expect(refused.status).toBe(400);
    expect(refused.body.error?.code).toBe("VALIDATION_ERROR");
    expect((await fetchPackages()).find((p) => p.id === target.id)!.isActive).toBe(false);

    // price and activation together are allowed
    const approved = await patchPackage({
      package_id: target.id,
      version: fresh.version,
      price_minor: 300,
      is_active: true,
    });
    expect(approved.status).toBe(200);
    expect((approved.body.data?.package as { isActive: boolean }).isActive).toBe(true);
  });

  it("price changes apply to FUTURE intents only — existing snapshots and periods keep the old price", async () => {
    const provider = installFake();
    const sql = getSql();
    await sql`update promotion_packages set is_active = true where price_minor > 0`;
    const packages = await fetchPackages();
    const target = packages.find((p) => p.type === "BOOST" && p.durationDays === 3)!;

    // seller buys at the CURRENT price
    const firstListing = await insertActiveListing(seller.userId);
    const checkout = (listingId: string) =>
      api(promoCheckoutRoute, "POST", `http://localhost/api/v1/me/listings/${listingId}/promotions/checkout`, {
        cookie: seller.cookie,
        params: { listingId },
        body: { type: "BOOST", package_id: target.id },
      });
    expect((await checkout(firstListing.id)).status).toBe(200);
    const [firstPayment] = await sql<{ id: string; amount_minor: string }[]>`
      select id, amount_minor::text as amount_minor from payments
      where listing_id = ${firstListing.id} and type = 'BOOST'
    `;
    expect(Number(firstPayment.amount_minor)).toBe(target.priceMinor);

    // admin raises the price AFTER the intent exists (the 5→7 AZN regression)
    const raised = await patchPackage({
      package_id: target.id,
      version: target.version,
      price_minor: target.priceMinor + 200,
    });
    expect(raised.status).toBe(200);

    // the existing intent is untouched and still fulfills at its snapshot
    const [unchanged] = await sql<{ amount_minor: string }[]>`
      select amount_minor::text as amount_minor from payments where id = ${firstPayment.id}
    `;
    expect(Number(unchanged.amount_minor)).toBe(target.priceMinor);
    for (const order of provider.orders.values()) order.status = "FullyPaid";
    const verified = await api(verifyRoute, "POST", `${BASE}/payments/${firstPayment.id}/verify`, {
      cookie: admin.cookie,
      params: { paymentId: firstPayment.id },
      body: {},
    });
    expect(verified.body.data?.outcome).toBe("SUCCESS");
    const [period] = await sql<{ purchased_price_minor: string }[]>`
      select purchased_price_minor::text as purchased_price_minor
      from listing_promotions where listing_id = ${firstListing.id}
    `;
    expect(Number(period.purchased_price_minor)).toBe(target.priceMinor);

    // a NEW purchase pays the new price
    const secondListing = await insertActiveListing(seller.userId);
    expect((await checkout(secondListing.id)).status).toBe(200);
    const [secondPayment] = await sql<{ amount_minor: string }[]>`
      select amount_minor::text as amount_minor from payments
      where listing_id = ${secondListing.id} and type = 'BOOST'
    `;
    expect(Number(secondPayment.amount_minor)).toBe(target.priceMinor + 200);
  });
});

describe("admin settings — typed allowlist", () => {
  it("returns exactly the allowlisted keys and updates one within bounds (audited)", async () => {
    const settings = await fetchSettings();
    expect(settings.map((s) => s.key).sort()).toEqual(
      [
        "boost.first_view_slots_desktop",
        "boost.first_view_slots_mobile",
        "boost.first_view_slots_tablet",
        "listing.free_publication_limit",
        "listing.image_max",
        "listing.image_min",
        "listing.publication_fee_minor",
        "listing.renewal_duration_days",
        "listing.renewal_fee_minor",
        "listing.validity_days",
      ].sort(),
    );
    const target = settings.find((s) => s.key === "boost.first_view_slots_desktop")!;
    const updated = await patchSetting({ key: target.key, value: 6, version: target.version });
    expect(updated.status).toBe(200);
    expect((updated.body.data?.setting as { value: number }).value).toBe(6);
    const sql = getSql();
    const [audit] = await sql<{ n: string }[]>`
      select count(*)::text as n from audit_logs
      where action = 'SETTING_UPDATED' and entity_id = ${target.key}
    `;
    expect(Number(audit.n)).toBe(1);
  });

  it("rejects out-of-bounds values, unknown keys, and stale versions", async () => {
    const settings = await fetchSettings();
    const validity = settings.find((s) => s.key === "listing.validity_days")!;
    const tooHigh = await patchSetting({ key: validity.key, value: 9999, version: validity.version });
    expect(tooHigh.status).toBe(400);
    const tooLow = await patchSetting({ key: validity.key, value: 0, version: validity.version });
    expect(tooLow.status).toBe(400);
    const notAdministrable = await patchSetting({
      key: "auth.otp_secret",
      value: 1,
      version: validity.version,
    });
    expect(notAdministrable.status).toBe(400);
    expect((await fetchSettings()).find((s) => s.key === validity.key)!.value).toBe(validity.value);

    const ok = await patchSetting({ key: validity.key, value: 45, version: validity.version });
    expect(ok.status).toBe(200);
    const stale = await patchSetting({ key: validity.key, value: 60, version: validity.version });
    expect(stale.status).toBe(409);
    expect(stale.body.error?.code).toBe("LISTING_REVISION_CONFLICT");
    expect((await fetchSettings()).find((s) => s.key === validity.key)!.value).toBe(45);
  });

  it("two admins editing the same setting version: exactly one wins, every round", async () => {
    for (let round = 0; round < 5; round += 1) {
      const settings = await fetchSettings();
      const target = settings.find((s) => s.key === "boost.first_view_slots_mobile")!;
      const [a, b] = await Promise.all([
        patchSetting({ key: target.key, value: 2, version: target.version }),
        patchSetting({ key: target.key, value: 3, version: target.version }),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
    }
  });

  it("fee changes never rewrite existing payment amounts", async () => {
    const sql = getSql();
    const [payment] = await sql<{ id: string }[]>`
      insert into payments (user_id, type, amount_minor, currency, idempotency_key, status)
      values (${seller.userId}, 'LISTING_FEE', 200, 'AZN', ${`fee-snap:${randomUUID()}`}, 'CREATED')
      returning id
    `;
    const settings = await fetchSettings();
    const fee = settings.find((s) => s.key === "listing.publication_fee_minor")!;
    const updated = await patchSetting({ key: fee.key, value: 300, version: fee.version });
    expect(updated.status).toBe(200);
    const [row] = await sql<{ amount_minor: string }[]>`
      select amount_minor::text as amount_minor from payments where id = ${payment.id}
    `;
    expect(Number(row.amount_minor)).toBe(200); // the intent snapshot is immutable
  });
});
