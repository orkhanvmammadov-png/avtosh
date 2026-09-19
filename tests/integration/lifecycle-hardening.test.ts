import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeSql, getSql, withTransaction } from "@/lib/server/db/client";
import {
  createMemoryStorageProvider,
  type MemoryStorageProvider,
} from "@/providers/storage/memory-provider";
import { setStorageProviderForTesting } from "@/providers/storage/factory";
import { setPaymentProviderForTesting } from "@/providers/payments/factory";
import {
  PaymentProviderError,
  type CreateOrderInput,
  type PaymentProviderClient,
  type ProviderOrderDetails,
} from "@/providers/payments/types";
import { listingImageConfig } from "@/lib/config/listing-images";
import type { AuthContext } from "@/auth/current-user";
import { insertEditRevision } from "@/repositories/listing-edit-revisions";
import { lockOwnedListingForLifecycle } from "@/repositories/listing-lifecycle";
import { expireListingsBatch } from "@/repositories/lifecycle-jobs";
import { createRenewalCheckout, renewalState } from "@/services/renewals";
import { verifyProviderPayment } from "@/services/payment-checkout";
import {
  deactivateListing,
  getOrCreateEditRevision,
  tryFinalizeSellerReactivationById,
} from "@/services/listing-lifecycle";
import { submitEditRevision, updateEditRevision } from "@/services/listing-edit";
import { approveEditRevision, rejectEditRevision } from "@/services/moderation-edit";
import { claimListing } from "@/services/moderation";
import { publicDetail } from "@/services/marketplace";
import { createTestUserSession } from "./helpers/session";

/**
 * O.12 Stage E — lifecycle hardening. Central proofs: the sealed order
 * edit → moderation → renewal is enforced server-side at checkout
 * creation; verified renewal fulfillment completes reactivation ONLY
 * through the central finalizer; pre-existing payment truth is honored
 * without ever publishing unmoderated revision content; no race
 * produces a free period, a suspension bypass, a duplicate period, or
 * a stale-version publication.
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
      const id = `hd-${counter}-${randomUUID().slice(0, 8)}`;
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

let storage: MemoryStorageProvider;
let fake = createFakeKapital();
let carCat: string;
let brand: string;
let model: string;
let city: string;
let phoneCounter = 6_200_000;
type Session = { userId: string; cookie: string };
let seller: Session;
let moderator: Session;

async function newUser(opts: { roles?: string[] } = {}): Promise<Session> {
  phoneCounter += 1;
  return createTestUserSession(`+99451${phoneCounter}`, opts);
}

const sellerAuth = (): AuthContext => ({ user: { id: seller.userId } }) as AuthContext;
const moderatorAuth = (): AuthContext => ({ user: { id: moderator.userId } }) as AuthContext;

async function insertListing(spec: {
  status?: string;
  deactivated?: boolean;
  requested?: boolean;
  expiresOffsetMin?: number;
  periods?: boolean;
}): Promise<{ id: string; publicId: number; revision: number }> {
  const sql = getSql();
  const [row] = await sql<{ id: string; public_id: string; revision: number }[]>`
    insert into listings (owner_id, category_id, brand_id, model_id, city_id, year, price_minor,
      mileage, credit_available, barter_available, description, contact_phone_e164, seller_name,
      status, submitted_at, published_at, current_expires_at,
      seller_deactivated_at, seller_reactivation_requested_at)
    values (${seller.userId}, ${carCat}, ${brand}, ${model}, ${city}, 2021, 2000000,
      50000, false, false, 'HdE əvvəlki təsvir', '+994501234567', 'HdE Satıcı',
      ${spec.status ?? "EXPIRED"}::listing_status, now() - interval '40 days',
      now() - interval '39 days',
      now() + (${spec.expiresOffsetMin ?? -60 * 24 * 5} || ' minutes')::interval,
      ${spec.deactivated === true ? sql`now()` : null},
      ${spec.requested === true ? sql`now()` : null})
    returning id, public_id::text as public_id, revision
  `;
  for (let i = 0; i < 3; i += 1) {
    const path = `listings/${randomUUID()}.webp`;
    storage.objects.set(`${listingImageConfig().imagesBucket}/${path}`, {
      data: Buffer.from("img"),
      contentType: "image/webp",
    });
    await sql`
      insert into listing_images (listing_id, storage_path, sort_order, is_primary, mime_type, file_size_bytes, width, height)
      values (${row.id}, ${path}, ${i}, ${i === 0}, 'image/webp', 1000, 1600, 900)
    `;
  }
  if (spec.periods !== false) {
    await sql`
      insert into listing_periods (listing_id, period_number, source, starts_at, ends_at, status)
      values (${row.id}, 1, 'INITIAL', now() - interval '39 days', now() - interval '9 days', 'EXPIRED')
    `;
  }
  return { id: row.id, publicId: Number(row.public_id), revision: row.revision };
}

async function markPaidAndVerify(listingId: string): Promise<void> {
  const sql = getSql();
  const [payment] = await sql<{ id: string }[]>`
    select id from payments where listing_id = ${listingId} and type = 'RENEWAL'
    order by created_at desc limit 1
  `;
  const [attempt] = await sql<{ provider_order_id: string }[]>`
    select provider_order_id from payment_provider_attempts
    where payment_id = ${payment.id} and not is_terminal
  `;
  fake.orders.get(attempt.provider_order_id)!.status = "FullyPaid";
  const outcome = await verifyProviderPayment(payment.id);
  expect(outcome.state).toBe("SUCCESS");
}

async function snapshot(id: string) {
  const sql = getSql();
  const [row] = await sql<
    {
      status: string;
      price_minor: string;
      current_expires_at: Date | null;
      seller_deactivated_at: Date | null;
      seller_reactivation_requested_at: Date | null;
      public_id: string;
    }[]
  >`select status, price_minor::text as price_minor, current_expires_at,
      seller_deactivated_at, seller_reactivation_requested_at, public_id::text as public_id
    from listings where id = ${id}`;
  const [{ n: periods }] = await sql<{ n: string }[]>`
    select count(*)::text as n from listing_periods where listing_id = ${id}`;
  const [{ n: renewals }] = await sql<{ n: string }[]>`
    select count(*)::text as n from listing_periods where listing_id = ${id} and source = 'RENEWAL'`;
  const [{ n: payments }] = await sql<{ n: string }[]>`
    select count(*)::text as n from payments where listing_id = ${id} and type = 'RENEWAL'`;
  const [{ n: publications }] = await sql<{ n: string }[]>`
    select count(*)::text as n from listing_publications where listing_id = ${id}`;
  return {
    status: row.status,
    price: row.price_minor,
    expires: row.current_expires_at?.getTime() ?? null,
    deactivated: row.seller_deactivated_at !== null,
    requested: row.seller_reactivation_requested_at !== null,
    publicId: row.public_id,
    periods: Number(periods),
    renewalPeriods: Number(renewals),
    renewalPayments: Number(payments),
    publications: Number(publications),
  };
}

beforeAll(async () => {
  if (!process.env.DATABASE_URL) throw new Error("run via pnpm test:integration:db");
  storage = createMemoryStorageProvider();
  setStorageProviderForTesting(storage);
  fake = createFakeKapital();
  setPaymentProviderForTesting(fake.client);
  const sql = getSql();
  seller = await newUser();
  moderator = await newUser({ roles: ["MODERATOR"] });
  carCat = (await sql<{ id: string }[]>`select id from categories where code = 'CAR'`)[0].id;
  brand = (await sql<{ id: string }[]>`insert into brands (name, slug) values ('HdEBrand', 'hde-brand') returning id`)[0].id;
  await sql`insert into brand_categories (brand_id, category_id) values (${brand}, ${carCat})`;
  model = (await sql<{ id: string }[]>`insert into models (brand_id, category_id, name, slug) values (${brand}, ${carCat}, 'HdEModel', 'hde-model') returning id`)[0].id;
  city = (await sql<{ id: string }[]>`insert into cities (name_az, slug, sort_order) values ('HdEŞəhər', 'hde-seher', 94) returning id`)[0].id;
});

afterAll(async () => {
  setStorageProviderForTesting(null);
  setPaymentProviderForTesting(null);
  await closeSql();
});

describe("renewal checkout block (sealed order: edit → moderation → renewal)", () => {
  it("blocks every OPEN revision state before any payment/provider artifact exists", async () => {
    const sql = getSql();
    for (const editStatus of ["EDIT_DRAFT", "PENDING_MODERATION", "CORRECTION_REQUIRED"] as const) {
      const fixture = await insertListing({});
      const created = await getOrCreateEditRevision(sellerAuth(), fixture.id);
      if (editStatus !== "EDIT_DRAFT") {
        await sql`update listing_edit_revisions set status = ${editStatus}::edit_revision_status,
          submitted_at = now() where id = ${created.id}`;
      }
      const createCallsBefore = fake.state.createCalls;
      await expect(createRenewalCheckout(sellerAuth(), fixture.id)).rejects.toMatchObject({
        code: "LISTING_LIFECYCLE_CONFLICT",
      });
      // NOTHING was created: no payment row, no provider order
      const after = await snapshot(fixture.id);
      expect(after.renewalPayments).toBe(0);
      expect(fake.state.createCalls).toBe(createCallsBefore);
      expect(after.status).toBe("EXPIRED");
      // the read model agrees (direct URL lands on the unavailable state)
      const state = await renewalState(sellerAuth(), fixture.id);
      expect(state.eligible).toBe(false);
    }
  });

  it("allows renewal for no-edit, APPROVED, REJECTED and CANCELLED latest revisions", async () => {
    const sql = getSql();
    for (const terminal of [null, "APPROVED", "REJECTED", "CANCELLED"] as const) {
      const fixture = await insertListing({});
      if (terminal !== null) {
        const created = await getOrCreateEditRevision(sellerAuth(), fixture.id);
        await sql`update listing_edit_revisions
          set status = ${terminal}::edit_revision_status, decided_at = now()
          where id = ${created.id}`;
      }
      const checkout = await createRenewalCheckout(sellerAuth(), fixture.id);
      expect(checkout.checkoutUrl).toContain("fake-kapital.test");
      expect((await renewalState(sellerAuth(), fixture.id)).eligible).toBe(true);
    }
  });

  it("deterministic race: a concurrently-created edit wins and the blocked checkout creates nothing", async () => {
    const fixture = await insertListing({});
    const sql = getSql();
    let releaseTx: (() => void) | null = null;
    const held = new Promise<void>((resolve) => {
      releaseTx = resolve;
    });
    let lockedSignal: (() => void) | null = null;
    const locked = new Promise<void>((resolve) => {
      lockedSignal = resolve;
    });

    // tx A: take the listing lock, create the open revision, then hold
    // the transaction open until the checkout is provably WAITING on
    // the same row lock (observed via pg_locks — no sleeps).
    const txA = withTransaction(async (tx) => {
      const row = await lockOwnedListingForLifecycle(tx, fixture.id, seller.userId);
      expect(row).toBeDefined();
      const inserted = await insertEditRevision(tx, {
        listingId: fixture.id,
        data: { category: "CAR" },
      });
      expect(inserted).not.toBeNull();
      lockedSignal!();
      await held;
    });

    await locked;
    const createCallsBefore = fake.state.createCalls;
    const checkout = createRenewalCheckout(sellerAuth(), fixture.id);
    // observable condition: another backend is blocked on a lock for
    // OUR listing tuple — deterministic, no timing assumptions
    await expect
      .poll(
        async () => {
          const rows = await sql<{ n: string }[]>`
            select count(*)::text as n from pg_locks l
            join pg_stat_activity a on a.pid = l.pid
            where not l.granted and a.query ilike '%for update%'
          `;
          return Number(rows[0].n);
        },
        { timeout: 15_000 },
      )
      .toBeGreaterThan(0);
    releaseTx!();
    await txA;
    await expect(checkout).rejects.toMatchObject({ code: "LISTING_LIFECYCLE_CONFLICT" });
    expect(fake.state.createCalls).toBe(createCallsBefore);
    expect((await snapshot(fixture.id)).renewalPayments).toBe(0);
  });

  it("concurrent checkouts converge on ONE intent and one provider order", async () => {
    const fixture = await insertListing({});
    const results = await Promise.allSettled([
      createRenewalCheckout(sellerAuth(), fixture.id),
      createRenewalCheckout(sellerAuth(), fixture.id),
      createRenewalCheckout(sellerAuth(), fixture.id),
    ]);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    expect((await snapshot(fixture.id)).renewalPayments).toBe(1);
  });

  it("SUSPENDED / SOLD / DELETED can never enter renewal", async () => {
    for (const status of ["SUSPENDED", "SOLD"] as const) {
      const fixture = await insertListing({ status });
      await expect(createRenewalCheckout(sellerAuth(), fixture.id)).rejects.toMatchObject({
        code: "PAYMENT_NOT_REQUIRED",
      });
    }
    const deleted = await insertListing({});
    const sql = getSql();
    await sql`update listings set status = 'DELETED', deleted_at = now() where id = ${deleted.id}`;
    await expect(createRenewalCheckout(sellerAuth(), deleted.id)).rejects.toMatchObject({
      code: "LISTING_NOT_FOUND",
    });
  });
});

describe("verified renewal fulfillment + central finalizer", () => {
  it("deactivated+expired, no edit: checkout records the intent; SUCCESS reactivates through the finalizer — no second Aktiv et", async () => {
    const fixture = await insertListing({ deactivated: true });
    await createRenewalCheckout(sellerAuth(), fixture.id);
    // §9: the checkout itself recorded the activation intent
    let after = await snapshot(fixture.id);
    expect(after.requested).toBe(true);
    expect(after.deactivated).toBe(true);

    await markPaidAndVerify(fixture.id);
    after = await snapshot(fixture.id);
    expect(after.status).toBe("ACTIVE");
    expect(after.renewalPeriods).toBe(1);
    expect(after.deactivated).toBe(false); // finalizer cleared BOTH
    expect(after.requested).toBe(false);
    expect(after.publications).toBe(0); // never a publication/quota event
    const detail = await publicDetail(fixture.publicId);
    expect(detail.listing.status).toBe("ACTIVE");

    // repeated verification stays exactly-once (no double period, no
    // second finalizer effect)
    const sql = getSql();
    const [payment] = await sql<{ id: string }[]>`
      select id from payments where listing_id = ${fixture.id} and type = 'RENEWAL'`;
    const again = await verifyProviderPayment(payment.id);
    expect(again.state).toBe("SUCCESS");
    const final = await snapshot(fixture.id);
    expect(final.renewalPeriods).toBe(1);
    const [{ n: reactivations }] = await sql<{ n: string }[]>`
      select count(*)::text as n from audit_logs
      where entity_id = ${fixture.id} and action = 'LISTING_SELLER_REACTIVATED'`;
    expect(Number(reactivations)).toBe(1);
  });

  it("finalizer repeat call is a no-op and nothing else ever clears the flags", async () => {
    const fixture = await insertListing({ deactivated: true, requested: true, status: "ACTIVE", expiresOffsetMin: 60 * 24 * 10 });
    const first = await withTransaction(async (tx) => tryFinalizeSellerReactivationById(tx, fixture.id));
    expect(first).toEqual({ finalized: true, reason: null });
    const second = await withTransaction(async (tx) => tryFinalizeSellerReactivationById(tx, fixture.id));
    expect(second).toEqual({ finalized: false, reason: "NOT_REQUESTED" });
  });

  it("SUSPENDED is never bypassed: fulfillment keeps the status, finalizer refuses", async () => {
    const fixture = await insertListing({ deactivated: true });
    await createRenewalCheckout(sellerAuth(), fixture.id);
    // moderation suspends before the payment verifies (paid time must
    // not be lost, suspension must not be lifted)
    const sql = getSql();
    await sql`update listings set status = 'SUSPENDED' where id = ${fixture.id}`;
    const before = await snapshot(fixture.id);
    await markPaidAndVerify(fixture.id);
    const after = await snapshot(fixture.id);
    expect(after.status).toBe("SUSPENDED"); // no bypass
    expect(after.renewalPeriods).toBe(1); // paid time recorded
    expect(after.expires).toBeGreaterThan(before.expires!);
    expect(after.deactivated).toBe(true); // finalizer never ran its clear
    await expect(publicDetail(fixture.publicId)).rejects.toMatchObject({ code: "LISTING_NOT_FOUND" });
    const finalize = await withTransaction(async (tx) => tryFinalizeSellerReactivationById(tx, fixture.id));
    expect(finalize.finalized).toBe(false);
  });

  it("last serialized visibility intent wins: renew-reactivate then deactivate again", async () => {
    const fixture = await insertListing({ deactivated: true });
    await createRenewalCheckout(sellerAuth(), fixture.id);
    await markPaidAndVerify(fixture.id);
    expect((await snapshot(fixture.id)).deactivated).toBe(false);
    const revision = (await snapshot(fixture.id), await getSql()<{ revision: number }[]>`
      select revision from listings where id = ${fixture.id}`)[0].revision;
    await deactivateListing(sellerAuth(), fixture.id, revision);
    const after = await snapshot(fixture.id);
    expect(after.status).toBe("ACTIVE");
    expect(after.deactivated).toBe(true);
    await expect(publicDetail(fixture.publicId)).rejects.toMatchObject({ code: "LISTING_NOT_FOUND" });
  });
});

describe("pre-existing renewal intent vs newly-opened edit (sealed policy)", () => {
  it("open unpaid intent + new edit: checkout re-entry blocked, verified SUCCESS honors OLD content only", async () => {
    const fixture = await insertListing({});
    // legacy: checkout created BEFORE any edit existed
    await createRenewalCheckout(sellerAuth(), fixture.id);
    // seller then opens and submits an edit (allowed — the intent is
    // not invalidated; provider cancellation is unsupported)
    const revisionDto = await getOrCreateEditRevision(sellerAuth(), fixture.id);
    await updateEditRevision(sellerAuth(), fixture.id, {
      expected_revision: revisionDto.revision,
      price_minor: 9990000,
      description: "Moderasiya olunmamış qaralama",
    });
    await submitEditRevision(sellerAuth(), fixture.id, revisionDto.revision + 1);

    // re-entering checkout with the edit open is blocked with NO new
    // provider order (the pre-existing intent stays untouched)
    const createCallsBefore = fake.state.createCalls;
    await expect(createRenewalCheckout(sellerAuth(), fixture.id)).rejects.toMatchObject({
      code: "LISTING_LIFECYCLE_CONFLICT",
    });
    expect(fake.state.createCalls).toBe(createCallsBefore);

    // provider SUCCESS arrives anyway (paid on the earlier HPP URL):
    // payment truth is honored — period + ACTIVE — but ONLY the old
    // approved content becomes public; the revision stays PENDING
    await markPaidAndVerify(fixture.id);
    const after = await snapshot(fixture.id);
    expect(after.status).toBe("ACTIVE");
    expect(after.renewalPeriods).toBe(1);
    expect(after.price).toBe("2000000"); // approved row untouched
    const detail = await publicDetail(fixture.publicId);
    expect(detail.listing.priceMinor).toBe(2000000); // never 9 990 000
    const sql = getSql();
    const [rev] = await sql<{ status: string }[]>`
      select status from listing_edit_revisions where id = ${revisionDto.id}`;
    expect(rev.status).toBe("PENDING_MODERATION"); // moderation not bypassed
  });

  it("deactivated + requested + open edit: SUCCESS grants validity but the finalizer defers to moderation", async () => {
    const fixture = await insertListing({ deactivated: true });
    await createRenewalCheckout(sellerAuth(), fixture.id); // records request
    const revisionDto = await getOrCreateEditRevision(sellerAuth(), fixture.id);
    await submitEditRevision(sellerAuth(), fixture.id, revisionDto.revision);
    await markPaidAndVerify(fixture.id);
    const after = await snapshot(fixture.id);
    expect(after.status).toBe("ACTIVE"); // validity granted
    expect(after.deactivated).toBe(true); // still hidden — open revision gate
    expect(after.requested).toBe(true); // intent survives for approval
    await expect(publicDetail(fixture.publicId)).rejects.toMatchObject({ code: "LISTING_NOT_FOUND" });
    // moderator approval now completes reactivation via the finalizer
    await claimListing(moderatorAuth(), fixture.id);
    const approved = await approveEditRevision(moderatorAuth(), fixture.id, revisionDto.revision);
    expect(approved.reactivated).toBe(true);
    const final = await snapshot(fixture.id);
    expect(final.deactivated).toBe(false);
    expect((await publicDetail(fixture.publicId)).listing.status).toBe("ACTIVE");
  });
});

describe("renewal after decisions", () => {
  it("EXPIRED + APPROVED edit renews normally and publishes the NEW approved content", async () => {
    const fixture = await insertListing({});
    const revisionDto = await getOrCreateEditRevision(sellerAuth(), fixture.id);
    await updateEditRevision(sellerAuth(), fixture.id, {
      expected_revision: revisionDto.revision,
      price_minor: 2750000,
    });
    await submitEditRevision(sellerAuth(), fixture.id, revisionDto.revision + 1);
    await claimListing(moderatorAuth(), fixture.id);
    const approved = await approveEditRevision(moderatorAuth(), fixture.id, revisionDto.revision + 1);
    expect(approved.reactivated).toBe(false); // §12: approval grants nothing
    let after = await snapshot(fixture.id);
    expect(after.status).toBe("EXPIRED");
    expect(after.periods).toBe(1); // no free validity from approval
    expect(after.price).toBe("2750000"); // content already swapped

    await createRenewalCheckout(sellerAuth(), fixture.id);
    await markPaidAndVerify(fixture.id);
    after = await snapshot(fixture.id);
    expect(after.status).toBe("ACTIVE");
    expect(after.renewalPeriods).toBe(1);
    const detail = await publicDetail(fixture.publicId);
    expect(detail.listing.priceMinor).toBe(2750000); // NEW approved content
    // renewal never copies revision content — approval already did
  });

  it("REJECT clears the intent and reopens renewal of the OLD approved content", async () => {
    const fixture = await insertListing({ deactivated: true, requested: true });
    const revisionDto = await getOrCreateEditRevision(sellerAuth(), fixture.id);
    await submitEditRevision(sellerAuth(), fixture.id, revisionDto.revision);
    await claimListing(moderatorAuth(), fixture.id);
    await rejectEditRevision(moderatorAuth(), fixture.id, {
      expectedEditRevision: revisionDto.revision,
      reasonCode: "MISLEADING_INFO",
      note: null,
    });
    let after = await snapshot(fixture.id);
    expect(after.requested).toBe(false); // stale intent cleared by reject
    // renewal is open again; the seller stays deactivated (no request
    // is auto-recorded... unless they renew, which IS the intent)
    await createRenewalCheckout(sellerAuth(), fixture.id);
    await markPaidAndVerify(fixture.id);
    after = await snapshot(fixture.id);
    expect(after.status).toBe("ACTIVE");
    expect(after.price).toBe("2000000"); // old approved content
    expect(after.deactivated).toBe(false); // renewal-recorded intent finalized
  });
});

describe("§39 full lifecycle journey (the central Stage E proof)", () => {
  it("deactivate → edit → activate-intent submit → expiry → approval → renewal → public approved content", async () => {
    const sql = getSql();
    // 1. ACTIVE listing (valid, with an active PREMIUM promotion)
    const fixture = await insertListing({ status: "ACTIVE", expiresOffsetMin: 60 });
    const [pay] = await sql<{ id: string }[]>`
      insert into payments (user_id, listing_id, type, amount_minor, idempotency_key, status, provider)
      values (${seller.userId}, ${fixture.id}, 'PREMIUM', 0, ${`hde:${fixture.id}`}, 'SUCCESS', 'KAPITAL')
      returning id`;
    await sql`
      insert into listing_promotions (listing_id, type, payment_id, starts_at, ends_at, status, purchased_duration_days, purchased_price_minor)
      values (${fixture.id}, 'PREMIUM', ${pay.id}, now() - interval '1 hour', now() + interval '20 days', 'ACTIVE', 21, 0)`;
    const promoBefore = await sql<{ starts_at: Date; ends_at: Date }[]>`
      select starts_at, ends_at from listing_promotions where listing_id = ${fixture.id}`;

    // 2. seller deactivates
    await deactivateListing(sellerAuth(), fixture.id, fixture.revision);
    // 3-4-5. seller edits and submits WITH the activation intent
    const revisionDto = await getOrCreateEditRevision(sellerAuth(), fixture.id);
    await updateEditRevision(sellerAuth(), fixture.id, {
      expected_revision: revisionDto.revision,
      price_minor: 3100000,
      description: "Təsdiqlənəcək yeni məzmun",
    });
    await submitEditRevision(sellerAuth(), fixture.id, revisionDto.revision + 1, { activate: true });
    expect((await snapshot(fixture.id)).requested).toBe(true);

    // 6. validity lapses through the REAL expiry job
    await sql`update listings set current_expires_at = now() - interval '1 minute' where id = ${fixture.id}`;
    await withTransaction(async (tx) => expireListingsBatch(tx, 100));
    expect((await snapshot(fixture.id)).status).toBe("EXPIRED");

    // 7-8. moderator approves; listing stays EXPIRED/private
    await claimListing(moderatorAuth(), fixture.id);
    const approved = await approveEditRevision(moderatorAuth(), fixture.id, revisionDto.revision + 1);
    expect(approved.reactivated).toBe(false);
    let state = await snapshot(fixture.id);
    expect(state.status).toBe("EXPIRED");
    expect(state.deactivated).toBe(true);
    expect(state.requested).toBe(true); // survives for renewal
    expect(state.price).toBe("3100000"); // content approved
    await expect(publicDetail(fixture.publicId)).rejects.toMatchObject({ code: "LISTING_NOT_FOUND" });

    // 9-10. renewal checkout + verified payment fulfillment
    await createRenewalCheckout(sellerAuth(), fixture.id);
    await markPaidAndVerify(fixture.id);

    // 11-17. finalizer completed; public approved content; identity kept
    state = await snapshot(fixture.id);
    expect(state.status).toBe("ACTIVE");
    expect(state.deactivated).toBe(false);
    expect(state.requested).toBe(false);
    expect(state.publicId).toBe(String(fixture.publicId));
    expect(state.renewalPeriods).toBe(1); // exactly one new period
    expect(state.renewalPayments).toBe(1); // exactly one paid renewal
    expect(state.publications).toBe(0); // no publication/quota consumption
    const detail = await publicDetail(fixture.publicId);
    expect(detail.listing.priceMinor).toBe(3100000);
    expect(detail.listing.status).toBe("ACTIVE");
    // §35: promotion clock never shifted; exposure restored only
    // because its window is still valid
    const promoAfter = await sql<{ starts_at: Date; ends_at: Date }[]>`
      select starts_at, ends_at from listing_promotions where listing_id = ${fixture.id}`;
    expect(promoAfter[0].starts_at.getTime()).toBe(promoBefore[0].starts_at.getTime());
    expect(promoAfter[0].ends_at.getTime()).toBe(promoBefore[0].ends_at.getTime());
    expect(detail.listing.badges?.premium).toBe(true);

    // shared-DB hygiene (established convention): re-hide this premium
    // fixture through the REAL service so the marketplace Premium/Home
    // suites keep their own clean fixture space
    const [{ revision: finalRevision }] = await sql<{ revision: number }[]>`
      select revision from listings where id = ${fixture.id}`;
    await deactivateListing(sellerAuth(), fixture.id, finalRevision);
    await expect(publicDetail(fixture.publicId)).rejects.toMatchObject({ code: "LISTING_NOT_FOUND" });
  });
});
